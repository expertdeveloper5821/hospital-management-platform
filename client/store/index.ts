import { configureStore } from '@reduxjs/toolkit';
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

export type RootState   = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
