import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Grid,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { GridColDef } from '@mui/x-data-grid';
import { RootState, AppDispatch } from '../store';
import {
  fetchDocuments,
  setPage,
  setPageSize,
  setFilters,
  deleteDocument,
} from '../store/documentsSlice';
import DataTable, { createStatusColumn, createDateColumn } from '../components/DataTable';
import FilterPanel from '../components/FilterPanel';
import MetricsCard from '../components/MetricsCard';

const DocumentsPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const {
    documents,
    loading,
    error,
    totalCount,
    page,
    pageSize,
    filters,
  } = useSelector((state: RootState) => state.documents);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchDocuments({ page, pageSize, ...filters }));
  }, [dispatch, page, pageSize, filters]);

  const handleFilterChange = (newFilters: any) => {
    dispatch(setFilters(newFilters));
  };

  const handleView = (id: string) => {
    navigate(`/documents/${id}`);
  };

  const handleEdit = (id: string) => {
    navigate(`/documents/${id}/edit`);
  };

  const handleDelete = (id: string) => {
    setSelectedDocId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (selectedDocId) {
      await dispatch(deleteDocument(selectedDocId));
      setDeleteDialogOpen(false);
      setSelectedDocId(null);
      // Refresh documents
      dispatch(fetchDocuments({ page, pageSize, ...filters }));
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'title',
      headerName: 'Title',
      flex: 1,
      minWidth: 200,
    },
    {
      field: 'source',
      headerName: 'Source',
      width: 150,
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 120,
    },
    createStatusColumn('status', 'Status', {
      processing: { label: 'Processing', color: 'warning' },
      completed: { label: 'Completed', color: 'success' },
      failed: { label: 'Failed', color: 'error' },
    }),
    createDateColumn('createdAt', 'Created'),
    createDateColumn('updatedAt', 'Updated'),
  ];

  const stats = {
    total: totalCount,
    processing: documents.filter(d => d.status === 'processing').length,
    completed: documents.filter(d => d.status === 'completed').length,
    failed: documents.filter(d => d.status === 'failed').length,
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Documents</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/documents/new')}
        >
          Add Document
        </Button>
      </Box>

      {/* Document Statistics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Total Documents"
            value={stats.total}
            trend="increasing"
            trendValue={5.2}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Processing"
            value={stats.processing}
            status="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Completed"
            value={stats.completed}
            status="healthy"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Failed"
            value={stats.failed}
            status="error"
          />
        </Grid>
      </Grid>

      {/* Filters */}
      <FilterPanel
        onFilterChange={handleFilterChange}
        showSearch
        showDateRange
        customFilters={[
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Processing', value: 'processing' },
              { label: 'Completed', value: 'completed' },
              { label: 'Failed', value: 'failed' },
            ],
          },
          {
            name: 'source',
            label: 'Source',
            type: 'select',
            options: [
              { label: 'Web Scraper', value: 'web' },
              { label: 'API', value: 'api' },
              { label: 'File Upload', value: 'file' },
              { label: 'Manual', value: 'manual' },
            ],
          },
          {
            name: 'type',
            label: 'Document Type',
            type: 'multiselect',
            options: [
              { label: 'Article', value: 'article' },
              { label: 'Report', value: 'report' },
              { label: 'Documentation', value: 'documentation' },
              { label: 'FAQ', value: 'faq' },
            ],
          },
        ]}
      />

      {/* Documents Table */}
      <DataTable
        title="Document List"
        data={documents}
        columns={columns}
        loading={loading}
        pageSize={pageSize}
        checkboxSelection
        onView={handleView}
        onEdit={handleEdit}
        onDelete={handleDelete}
        height={600}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this document? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          Error: {error}
        </Typography>
      )}
    </Box>
  );
};

export default DocumentsPage;