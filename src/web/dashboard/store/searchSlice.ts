import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { searchApi } from '../api/client';

interface SearchResult {
  id: string;
  title: string;
  content: string;
  source: string;
  score: number;
  highlights: string[];
  metadata?: Record<string, any>;
}

interface SearchState {
  query: string;
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  totalResults: number;
  searchTime: number;
  filters: {
    sources?: string[];
    dateRange?: {
      start: Date | null;
      end: Date | null;
    };
    minScore?: number;
  };
  analytics: {
    popularSearches: string[];
    searchTrends: any[];
  };
}

const initialState: SearchState = {
  query: '',
  results: [],
  loading: false,
  error: null,
  totalResults: 0,
  searchTime: 0,
  filters: {},
  analytics: {
    popularSearches: [],
    searchTrends: [],
  },
};

export const performSearch = createAsyncThunk(
  'search/performSearch',
  async ({ query, filters }: { query: string; filters?: any }) => {
    const response = await searchApi.search(query, filters);
    return response.data;
  }
);

export const fetchSearchAnalytics = createAsyncThunk(
  'search/fetchAnalytics',
  async (timeRange: string) => {
    const response = await searchApi.getSearchAnalytics(timeRange);
    return response.data;
  }
);

export const fetchPopularSearches = createAsyncThunk(
  'search/fetchPopularSearches',
  async () => {
    const response = await searchApi.getPopularSearches();
    return response.data;
  }
);

const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    setQuery: (state, action: PayloadAction<string>) => {
      state.query = action.payload;
    },
    setFilters: (state, action: PayloadAction<SearchState['filters']>) => {
      state.filters = action.payload;
    },
    clearSearch: (state) => {
      state.query = '';
      state.results = [];
      state.totalResults = 0;
      state.searchTime = 0;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Perform search
      .addCase(performSearch.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(performSearch.fulfilled, (state, action) => {
        state.loading = false;
        state.results = action.payload.results;
        state.totalResults = action.payload.totalResults;
        state.searchTime = action.payload.searchTime;
      })
      .addCase(performSearch.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Search failed';
      })
      // Fetch analytics
      .addCase(fetchSearchAnalytics.fulfilled, (state, action) => {
        state.analytics.searchTrends = action.payload.trends;
      })
      // Fetch popular searches
      .addCase(fetchPopularSearches.fulfilled, (state, action) => {
        state.analytics.popularSearches = action.payload.searches;
      });
  },
});

export const {
  setQuery,
  setFilters,
  clearSearch,
  clearError,
} = searchSlice.actions;

export default searchSlice.reducer;