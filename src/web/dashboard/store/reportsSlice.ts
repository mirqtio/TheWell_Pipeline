import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { reportsApi } from '../api/client';

interface Report {
  id: string;
  name: string;
  type: 'cost' | 'performance' | 'usage' | 'custom';
  format: 'pdf' | 'excel' | 'csv';
  status: 'pending' | 'generating' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  fileSize?: number;
  downloadUrl?: string;
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    nextRun: string;
  };
}

interface ReportsState {
  reports: Report[];
  selectedReport: Report | null;
  loading: boolean;
  error: string | null;
  generating: boolean;
  filters: {
    type?: string;
    status?: string;
    dateRange?: {
      start: Date | null;
      end: Date | null;
    };
  };
}

const initialState: ReportsState = {
  reports: [],
  selectedReport: null,
  loading: false,
  error: null,
  generating: false,
  filters: {},
};

export const fetchReports = createAsyncThunk(
  'reports/fetchReports',
  async (params?: any) => {
    const response = await reportsApi.getReports(params);
    return response.data;
  }
);

export const generateReport = createAsyncThunk(
  'reports/generateReport',
  async (data: any) => {
    const response = await reportsApi.generateReport(data);
    return response.data;
  }
);

export const scheduleReport = createAsyncThunk(
  'reports/scheduleReport',
  async (data: any) => {
    const response = await reportsApi.scheduleReport(data);
    return response.data;
  }
);

export const downloadReport = createAsyncThunk(
  'reports/downloadReport',
  async ({ id, format }: { id: string; format: string }) => {
    const response = await reportsApi.downloadReport(id, format);
    // Create blob URL for download
    const blob = new Blob([response.data]);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report-${id}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    return { id, downloaded: true };
  }
);

const reportsSlice = createSlice({
  name: 'reports',
  initialState,
  reducers: {
    setFilters: (state, action: PayloadAction<ReportsState['filters']>) => {
      state.filters = action.payload;
    },
    clearFilters: (state) => {
      state.filters = {};
    },
    clearError: (state) => {
      state.error = null;
    },
    selectReport: (state, action: PayloadAction<Report | null>) => {
      state.selectedReport = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch reports
      .addCase(fetchReports.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchReports.fulfilled, (state, action) => {
        state.loading = false;
        state.reports = action.payload.reports;
      })
      .addCase(fetchReports.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch reports';
      })
      // Generate report
      .addCase(generateReport.pending, (state) => {
        state.generating = true;
        state.error = null;
      })
      .addCase(generateReport.fulfilled, (state, action) => {
        state.generating = false;
        state.reports.unshift(action.payload);
      })
      .addCase(generateReport.rejected, (state, action) => {
        state.generating = false;
        state.error = action.error.message || 'Failed to generate report';
      });
  },
});

export const {
  setFilters,
  clearFilters,
  clearError,
  selectReport,
} = reportsSlice.actions;

export default reportsSlice.reducer;