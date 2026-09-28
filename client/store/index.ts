import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import authReducer from './slices/auth.slice';
import notificationReducer from './slices/notification.slice';
import { baseApi } from './api/base.api';

export const store = configureStore({
  reducer: {
    auth:         authReducer,
    notification: notificationReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(baseApi.middleware),
});

// Enables the per-query refetchOnReconnect / refetchOnFocus options (opt-in
// per hook — no query refetches on these events unless it asks to).
setupListeners(store.dispatch);

export type RootState   = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
