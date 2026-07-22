// ─── Mocks ────────────────────────────────────────────────────────────────────
// Mirrors the technique used in websocket-client.test.ts: stub out
// baseApi.injectEndpoints so `build.query`/`build.mutation` pass configs through
// unchanged, and capture every updateQueryData(endpoint, arg, recipe) call so
// the optimistic-patch recipes can be exercised directly without a real store.

const mockUpdateQueryData = jest.fn(
  (endpoint: string, arg: unknown, recipe: (draft: unknown) => unknown) =>
    ({ type: 'MOCK_PATCH', endpoint, arg, recipe }),
);

jest.mock('./base.api', () => ({
  baseApi: {
    injectEndpoints: ({ endpoints }: { endpoints: (build: unknown) => Record<string, unknown> }) => {
      const build = {
        query:    (config: unknown) => config,
        mutation: (config: unknown) => config,
      };
      return {
        ...endpoints(build),
        // Deferred forward — avoids referencing mockUpdateQueryData at factory-eval
        // time, which runs before its `const` declaration below (jest hoists
        // jest.mock calls, and this factory executes as soon as './notification.api'
        // is imported).
        util: {
          updateQueryData: (endpoint: string, arg: unknown, recipe: (draft: unknown) => unknown) =>
            mockUpdateQueryData(endpoint, arg, recipe),
        },
      };
    },
  },
}));

import { notificationApi as notificationApiImport } from './notification.api';

interface EndpointUnderTest {
  onQueryStarted: (
    arg: unknown,
    api: { dispatch: jest.Mock; queryFulfilled: Promise<unknown> },
  ) => Promise<void>;
}

// The real notificationApi type (RTK Query's `Api<...>`) doesn't expose endpoint
// configs as direct properties — only hooks/`.endpoints`. The mocked
// injectEndpoints above returns the raw config objects flattened onto the
// object instead, so re-shape the type to match what actually comes back.
const notificationApi = notificationApiImport as unknown as {
  markNotificationRead:      EndpointUnderTest;
  markAllNotificationsRead:  EndpointUnderTest;
};

type Patch = { endpoint: string; arg: unknown; recipe: (draft: unknown) => unknown };

function findPatch(endpointName: string): Patch {
  const call = mockUpdateQueryData.mock.calls.find((c) => c[0] === endpointName);
  if (!call) throw new Error(`no updateQueryData call for ${endpointName}`);
  return { endpoint: call[0] as string, arg: call[1], recipe: call[2] as Patch['recipe'] };
}

describe('notificationApi optimistic patches', () => {
  beforeEach(() => {
    mockUpdateQueryData.mockClear();
  });

  describe('markNotificationRead', () => {
    const endpoint = notificationApi.markNotificationRead;

    async function runOnQueryStarted() {
      const dispatch = jest.fn((patch: unknown) => patch);
      await endpoint.onQueryStarted('notif-1', { dispatch, queryFulfilled: Promise.resolve() });
      return dispatch;
    }

    test('listNotifications patch marks the matching item read when the cache is a populated array', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('listNotifications');

      const draft = [{ id: 'notif-1', read: false }, { id: 'notif-2', read: false }];
      recipe(draft);

      expect(draft[0].read).toBe(true);
      expect(draft[1].read).toBe(false);
    });

    test('listNotifications patch does not throw when the cache is uninitialized (undefined)', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('listNotifications');

      expect(() => recipe(undefined)).not.toThrow();
    });

    test('listNotifications patch does not throw when the cache is not an array', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('listNotifications');

      expect(() => recipe({ notAnArray: true })).not.toThrow();
    });

    test('getUnreadCount patch decrements a finite cached count', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('getUnreadCount');

      expect(recipe(5)).toBe(4);
    });

    test('getUnreadCount patch floors at 0', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('getUnreadCount');

      expect(recipe(0)).toBe(0);
    });

    test('getUnreadCount patch leaves an undefined cached count untouched (no NaN)', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('getUnreadCount');

      expect(recipe(undefined)).toBeUndefined();
    });

    test('getUnreadCount patch leaves a non-finite cached count untouched (no NaN propagation)', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('getUnreadCount');

      expect(recipe(NaN)).toBeNaN();
      expect(recipe(Infinity)).toBe(Infinity);
    });

    test('undoes both patches when the request fails', async () => {
      const dispatch = jest.fn((patch: unknown) => patch);
      const undoListNotifications = jest.fn();
      const undoUnreadCount = jest.fn();
      let call = 0;
      mockUpdateQueryData.mockImplementationOnce((endpoint, arg, recipe) => {
        call += 1;
        return { type: 'MOCK_PATCH', endpoint, arg, recipe, undo: undoListNotifications };
      });
      mockUpdateQueryData.mockImplementationOnce((endpoint, arg, recipe) => {
        call += 1;
        return { type: 'MOCK_PATCH', endpoint, arg, recipe, undo: undoUnreadCount };
      });

      await endpoint.onQueryStarted('notif-1', {
        dispatch,
        queryFulfilled: Promise.reject(new Error('network error')),
      });

      expect(call).toBe(2);
      expect(undoListNotifications).toHaveBeenCalled();
      expect(undoUnreadCount).toHaveBeenCalled();
    });
  });

  describe('markAllNotificationsRead', () => {
    const endpoint = notificationApi.markAllNotificationsRead;

    async function runOnQueryStarted() {
      const dispatch = jest.fn((patch: unknown) => patch);
      await endpoint.onQueryStarted(undefined, { dispatch, queryFulfilled: Promise.resolve() });
      return dispatch;
    }

    test('listNotifications patch marks every item read when the cache is a populated array', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('listNotifications');

      const draft = [{ id: 'notif-1', read: false }, { id: 'notif-2', read: false }];
      recipe(draft);

      expect(draft.every((n) => n.read)).toBe(true);
    });

    test('listNotifications patch does not throw when the cache is uninitialized (undefined)', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('listNotifications');

      expect(() => recipe(undefined)).not.toThrow();
    });

    test('listNotifications patch does not throw when the cache is not an array', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('listNotifications');

      expect(() => recipe(null)).not.toThrow();
    });

    test('getUnreadCount patch resets the cache to 0', async () => {
      await runOnQueryStarted();
      const { recipe } = findPatch('getUnreadCount');

      expect(recipe(7)).toBe(0);
      expect(recipe(undefined)).toBe(0);
    });
  });
});
