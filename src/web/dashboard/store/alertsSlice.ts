import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { alertsApi } from '../api/client';

interface Alert {
  id: string;
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'cost' | 'performance' | 'security' | 'system';
  status: 'active' | 'acknowledged' | 'resolved';
  createdAt: string;
  updatedAt: string;
  source: string;
  metadata?: Record<string, any>;
}

interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: number;
  enabled: boolean;
}

interface AlertsState {
  alerts: Alert[];
  activeCount: number;
  loading: boolean;
  error: string | null;
  filters: {
    severity?: string;
    type?: string;
    status?: string;
  };
  rules: AlertRule[];
}

const initialState: AlertsState = {
  alerts: [],
  activeCount: 0,
  loading: false,
  error: null,
  filters: {},
  rules: [],
};

export const fetchAlerts = createAsyncThunk(
  'alerts/fetchAlerts',
  async (params?: any) => {
    const response = await alertsApi.getAlerts(params);
    return response.data;
  }
);

export const acknowledgeAlert = createAsyncThunk(
  'alerts/acknowledgeAlert',
  async (id: string) => {
    const response = await alertsApi.acknowledgeAlert(id);
    return response.data;
  }
);

export const dismissAlert = createAsyncThunk(
  'alerts/dismissAlert',
  async (id: string) => {
    const response = await alertsApi.dismissAlert(id);
    return response.data;
  }
);

export const createAlertRule = createAsyncThunk(
  'alerts/createRule',
  async (data: any) => {
    const response = await alertsApi.createAlertRule(data);
    return response.data;
  }
);

const alertsSlice = createSlice({
  name: 'alerts',
  initialState,
  reducers: {
    setFilters: (state, action: PayloadAction<AlertsState['filters']>) => {
      state.filters = action.payload;
    },
    clearFilters: (state) => {
      state.filters = {};
    },
    clearError: (state) => {
      state.error = null;
    },
    addAlert: (state, action: PayloadAction<Alert>) => {
      state.alerts.unshift(action.payload);
      if (action.payload.status === 'active') {
        state.activeCount += 1;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch alerts
      .addCase(fetchAlerts.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAlerts.fulfilled, (state, action) => {
        state.loading = false;
        state.alerts = action.payload.alerts;
        state.activeCount = action.payload.activeCount;
      })
      .addCase(fetchAlerts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch alerts';
      })
      // Acknowledge alert
      .addCase(acknowledgeAlert.fulfilled, (state, action) => {
        const alert = state.alerts.find(a => a.id === action.payload.id);
        if (alert) {
          alert.status = 'acknowledged';
          state.activeCount -= 1;
        }
      })
      // Dismiss alert
      .addCase(dismissAlert.fulfilled, (state, action) => {
        const alert = state.alerts.find(a => a.id === action.payload.id);
        if (alert) {
          alert.status = 'resolved';
          if (alert.status === 'active') {
            state.activeCount -= 1;
          }
        }
      });
  },
});

export const {
  setFilters,
  clearFilters,
  clearError,
  addAlert,
} = alertsSlice.actions;

export default alertsSlice.reducer;