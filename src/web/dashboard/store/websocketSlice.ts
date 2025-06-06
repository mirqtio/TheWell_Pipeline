import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { io, Socket } from 'socket.io-client';
import { AppDispatch } from './index';
import { updateMetrics } from './dashboardSlice';

// Simple logger wrapper for browser environment
const logger = {
  info: (...args: any[]) => console.info('[INFO]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args)
};

interface WebSocketState {
  connected: boolean;
  reconnecting: boolean;
  error: string | null;
  socket: Socket | null;
}

const initialState: WebSocketState = {
  connected: false,
  reconnecting: false,
  error: null,
  socket: null,
};

const websocketSlice = createSlice({
  name: 'websocket',
  initialState,
  reducers: {
    setConnected: (state, action: PayloadAction<boolean>) => {
      state.connected = action.payload;
      state.error = null;
    },
    setReconnecting: (state, action: PayloadAction<boolean>) => {
      state.reconnecting = action.payload;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
    },
    setSocket: (state, action: PayloadAction<Socket | null>) => {
      state.socket = action.payload as any; // Type workaround for non-serializable
    },
  },
});

export const { setConnected, setReconnecting, setError, setSocket } = websocketSlice.actions;

// Thunk to initialize WebSocket connection
export const initializeWebSocket = () => (dispatch: AppDispatch) => {
  const socket = io(process.env.REACT_APP_WS_URL || '/', {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
  });

  socket.on('connect', () => {
    logger.info('WebSocket connected');
    dispatch(setConnected(true));
    dispatch(setReconnecting(false));
  });

  socket.on('disconnect', () => {
    logger.info('WebSocket disconnected');
    dispatch(setConnected(false));
  });

  socket.on('reconnecting', () => {
    dispatch(setReconnecting(true));
  });

  socket.on('connect_error', (error) => {
    logger.error('WebSocket connection error:', error);
    dispatch(setError(error.message));
  });

  // Listen for real-time metric updates
  socket.on('metrics:update', (data) => {
    dispatch(updateMetrics(data));
  });

  // Listen for alerts
  socket.on('alert:new', (alert) => {
    // Handle new alert
    logger.info('New alert:', alert);
  });

  // Listen for document updates
  socket.on('document:update', (document) => {
    // Handle document update
    logger.info('Document updated:', document);
  });

  dispatch(setSocket(socket));

  // Cleanup function
  return () => {
    socket.disconnect();
  };
};

export default websocketSlice.reducer;