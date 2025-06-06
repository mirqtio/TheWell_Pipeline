import React, { useState } from 'react';
import {
  DataGrid,
  GridColDef,
  GridPaginationModel,
  GridSortModel,
  GridFilterModel,
  GridToolbar,
  GridActionsCellItem,
  GridRowParams,
  GridValueGetterParams,
} from '@mui/x-data-grid';
import {
  Box,
  Paper,
  Typography,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Visibility as ViewIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';

interface DataTableProps {
  title?: string;
  data: any[];
  columns: GridColDef[];
  loading?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  checkboxSelection?: boolean;
  disableRowSelectionOnClick?: boolean;
  onRowClick?: (params: GridRowParams) => void;
  onView?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onExport?: () => void;
  height?: number | string;
  density?: 'compact' | 'standard' | 'comfortable';
  showToolbar?: boolean;
}

const DataTable: React.FC<DataTableProps> = ({
  title,
  data,
  columns,
  loading = false,
  pageSize = 10,
  pageSizeOptions = [5, 10, 25, 50],
  checkboxSelection = false,
  disableRowSelectionOnClick = true,
  onRowClick,
  onView,
  onEdit,
  onDelete,
  onExport,
  height = 400,
  density = 'standard',
  showToolbar = true,
}) => {
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    pageSize,
    page: 0,
  });
  const [sortModel, setSortModel] = useState<GridSortModel>([]);
  const [filterModel, setFilterModel] = useState<GridFilterModel>({
    items: [],
  });
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  // Add action column if any action handlers are provided
  const actionColumn: GridColDef | null = (onView || onEdit || onDelete) ? {
    field: 'actions',
    headerName: 'Actions',
    type: 'actions',
    width: 100,
    getActions: (params) => {
      const actions = [];
      
      if (onView) {
        actions.push(
          <GridActionsCellItem
            key="view"
            icon={<ViewIcon />}
            label="View"
            onClick={() => onView(params.id as string)}
            color="primary"
          />
        );
      }
      
      if (onEdit) {
        actions.push(
          <GridActionsCellItem
            key="edit"
            icon={<EditIcon />}
            label="Edit"
            onClick={() => onEdit(params.id as string)}
            color="primary"
          />
        );
      }
      
      if (onDelete) {
        actions.push(
          <GridActionsCellItem
            key="delete"
            icon={<DeleteIcon />}
            label="Delete"
            onClick={() => onDelete(params.id as string)}
            color="error"
          />
        );
      }
      
      return actions;
    },
  } : null;

  const finalColumns = actionColumn ? [...columns, actionColumn] : columns;

  // Add row ID if not present
  const rows = data.map((row, index) => ({
    id: row.id || index,
    ...row,
  }));

  return (
    <Paper sx={{ width: '100%', height }}>
      {title && (
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">{title}</Typography>
          {onExport && (
            <Tooltip title="Export Data">
              <IconButton onClick={onExport}>
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
      
      <DataGrid
        rows={rows}
        columns={finalColumns}
        loading={loading}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={pageSizeOptions}
        checkboxSelection={checkboxSelection}
        disableRowSelectionOnClick={disableRowSelectionOnClick}
        onRowSelectionModelChange={(newSelection) => {
          setSelectedRows(newSelection as string[]);
        }}
        sortModel={sortModel}
        onSortModelChange={setSortModel}
        filterModel={filterModel}
        onFilterModelChange={setFilterModel}
        onRowClick={onRowClick}
        density={density}
        slots={{
          toolbar: showToolbar ? GridToolbar : undefined,
        }}
        slotProps={{
          toolbar: {
            showQuickFilter: true,
            quickFilterProps: { debounceMs: 500 },
          },
        }}
        sx={{
          '& .MuiDataGrid-root': {
            border: 'none',
          },
          '& .MuiDataGrid-cell': {
            borderBottom: '1px solid rgba(224, 224, 224, 1)',
          },
          '& .MuiDataGrid-columnHeaders': {
            backgroundColor: 'background.default',
            borderBottom: '2px solid',
            borderColor: 'divider',
          },
          '& .MuiDataGrid-virtualScroller': {
            backgroundColor: 'background.paper',
          },
          '& .MuiDataGrid-footerContainer': {
            borderTop: '2px solid',
            borderColor: 'divider',
            backgroundColor: 'background.default',
          },
          '& .MuiCheckbox-root': {
            color: 'primary.main',
          },
          '& .MuiDataGrid-row:hover': {
            backgroundColor: 'action.hover',
            cursor: onRowClick ? 'pointer' : 'default',
          },
        }}
      />
    </Paper>
  );
};

// Helper function to create status chip columns
export const createStatusColumn = (
  field: string,
  headerName: string,
  statusMap: Record<string, { label: string; color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' }>
): GridColDef => ({
  field,
  headerName,
  width: 120,
  renderCell: (params) => {
    const status = params.value as string;
    const config = statusMap[status] || { label: status, color: 'default' };
    return (
      <Chip
        label={config.label}
        color={config.color}
        size="small"
        variant="outlined"
      />
    );
  },
});

// Helper function to create date columns
export const createDateColumn = (
  field: string,
  headerName: string,
  width = 150
): GridColDef => ({
  field,
  headerName,
  width,
  valueGetter: (params: GridValueGetterParams) => {
    const date = params.value;
    if (!date) return '';
    return new Date(date).toLocaleString();
  },
});

export default DataTable;