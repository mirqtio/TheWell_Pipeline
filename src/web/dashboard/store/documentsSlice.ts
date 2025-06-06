import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { documentsApi } from '../api/client';

interface Document {
  id: string;
  title: string;
  content: string;
  source: string;
  type: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

interface DocumentsState {
  documents: Document[];
  selectedDocument: Document | null;
  loading: boolean;
  error: string | null;
  totalCount: number;
  page: number;
  pageSize: number;
  filters: {
    search?: string;
    status?: string;
    source?: string;
    dateRange?: {
      start: Date | null;
      end: Date | null;
    };
  };
}

const initialState: DocumentsState = {
  documents: [],
  selectedDocument: null,
  loading: false,
  error: null,
  totalCount: 0,
  page: 0,
  pageSize: 10,
  filters: {},
};

export const fetchDocuments = createAsyncThunk(
  'documents/fetchDocuments',
  async (params: any) => {
    const response = await documentsApi.getDocuments(params);
    return response.data;
  }
);

export const fetchDocument = createAsyncThunk(
  'documents/fetchDocument',
  async (id: string) => {
    const response = await documentsApi.getDocument(id);
    return response.data;
  }
);

export const createDocument = createAsyncThunk(
  'documents/createDocument',
  async (data: any) => {
    const response = await documentsApi.createDocument(data);
    return response.data;
  }
);

export const updateDocument = createAsyncThunk(
  'documents/updateDocument',
  async ({ id, data }: { id: string; data: any }) => {
    const response = await documentsApi.updateDocument(id, data);
    return response.data;
  }
);

export const deleteDocument = createAsyncThunk(
  'documents/deleteDocument',
  async (id: string) => {
    await documentsApi.deleteDocument(id);
    return id;
  }
);

const documentsSlice = createSlice({
  name: 'documents',
  initialState,
  reducers: {
    setPage: (state, action: PayloadAction<number>) => {
      state.page = action.payload;
    },
    setPageSize: (state, action: PayloadAction<number>) => {
      state.pageSize = action.payload;
    },
    setFilters: (state, action: PayloadAction<DocumentsState['filters']>) => {
      state.filters = action.payload;
    },
    clearFilters: (state) => {
      state.filters = {};
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch documents
      .addCase(fetchDocuments.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDocuments.fulfilled, (state, action) => {
        state.loading = false;
        state.documents = action.payload.documents;
        state.totalCount = action.payload.totalCount;
      })
      .addCase(fetchDocuments.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch documents';
      })
      // Fetch single document
      .addCase(fetchDocument.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDocument.fulfilled, (state, action) => {
        state.loading = false;
        state.selectedDocument = action.payload;
      })
      .addCase(fetchDocument.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch document';
      })
      // Create document
      .addCase(createDocument.fulfilled, (state, action) => {
        state.documents.unshift(action.payload);
        state.totalCount += 1;
      })
      // Update document
      .addCase(updateDocument.fulfilled, (state, action) => {
        const index = state.documents.findIndex(doc => doc.id === action.payload.id);
        if (index !== -1) {
          state.documents[index] = action.payload;
        }
        if (state.selectedDocument?.id === action.payload.id) {
          state.selectedDocument = action.payload;
        }
      })
      // Delete document
      .addCase(deleteDocument.fulfilled, (state, action) => {
        state.documents = state.documents.filter(doc => doc.id !== action.payload);
        state.totalCount -= 1;
        if (state.selectedDocument?.id === action.payload) {
          state.selectedDocument = null;
        }
      });
  },
});

export const {
  setPage,
  setPageSize,
  setFilters,
  clearFilters,
  clearError,
} = documentsSlice.actions;

export default documentsSlice.reducer;