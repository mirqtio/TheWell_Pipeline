import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../api/client';
import { DashboardData, MetricTrend, TimeRange } from '../types/dashboard';

interface DashboardState {
  overview: DashboardData | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  timeRange: TimeRange;
  autoRefresh: boolean;
  refreshInterval: number; // in seconds
}

const initialState: DashboardState = {
  overview: null,
  loading: false,
  error: null,
  lastUpdated: null,
  timeRange: '24h',
  autoRefresh: true,
  refreshInterval: 30,
};

export const fetchInitialData = createAsyncThunk(
  'dashboard/fetchInitial',
  async () => {
    const response = await api.get('/dashboard/overview');
    return response.data;
  }
);

export const fetchDashboardData = createAsyncThunk(
  'dashboard/fetchData',
  async (timeRange: TimeRange) => {
    const response = await api.get('/dashboard/overview', {
      params: { timeRange }
    });
    return response.data;
  }
);

export const fetchCostData = createAsyncThunk(
  'dashboard/fetchCost',
  async ({ timeRange, granularity }: { timeRange: TimeRange; granularity: string }) => {
    const response = await api.get('/dashboard/cost', {
      params: { timeRange, granularity }
    });
    return response.data;
  }
);

export const fetchQualityData = createAsyncThunk(
  'dashboard/fetchQuality',
  async ({ timeRange, granularity }: { timeRange: TimeRange; granularity: string }) => {
    const response = await api.get('/dashboard/quality', {
      params: { timeRange, granularity }
    });
    return response.data;
  }
);

export const fetchOperationalData = createAsyncThunk(
  'dashboard/fetchOperational',
  async () => {
    const response = await api.get('/dashboard/operational');
    return response.data;
  }
);

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    setTimeRange: (state, action: PayloadAction<TimeRange>) => {
      state.timeRange = action.payload;
    },
    setAutoRefresh: (state, action: PayloadAction<boolean>) => {
      state.autoRefresh = action.payload;
    },
    setRefreshInterval: (state, action: PayloadAction<number>) => {
      state.refreshInterval = action.payload;
    },
    updateMetrics: (state, action: PayloadAction<Partial<DashboardData>>) => {
      if (state.overview) {
        state.overview = { ...state.overview, ...action.payload };
        state.lastUpdated = new Date().toISOString();
      }
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchInitialData
      .addCase(fetchInitialData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchInitialData.fulfilled, (state, action) => {
        state.loading = false;
        state.overview = action.payload;
        state.lastUpdated = new Date().toISOString();
      })
      .addCase(fetchInitialData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch dashboard data';
      })
      // fetchDashboardData
      .addCase(fetchDashboardData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDashboardData.fulfilled, (state, action) => {
        state.loading = false;
        state.overview = action.payload;
        state.lastUpdated = new Date().toISOString();
      })
      .addCase(fetchDashboardData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch dashboard data';
      });
  },
});

export const {
  setTimeRange,
  setAutoRefresh,
  setRefreshInterval,
  updateMetrics,
  clearError,
} = dashboardSlice.actions;

export default dashboardSlice.reducer;