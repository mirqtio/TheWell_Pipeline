import { configureStore } from '@reduxjs/toolkit';
import dashboardReducer from './dashboardSlice';
import documentsReducer from './documentsSlice';
import searchReducer from './searchSlice';
import alertsReducer from './alertsSlice';
import reportsReducer from './reportsSlice';
import websocketReducer from './websocketSlice';

export const store = configureStore({
  reducer: {
    dashboard: dashboardReducer,
    documents: documentsReducer,
    search: searchReducer,
    alerts: alertsReducer,
    reports: reportsReducer,
    websocket: websocketReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types for WebSocket
        ignoredActions: ['websocket/connect', 'websocket/disconnect'],
        ignoredPaths: ['websocket.socket'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;