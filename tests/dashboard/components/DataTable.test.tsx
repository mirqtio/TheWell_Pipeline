import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@mui/material/styles';
import DataTable, { createStatusColumn, createDateColumn } from '../../../src/web/dashboard/components/DataTable';
import { theme } from '../../../src/web/dashboard/theme';

const renderWithTheme = (component: React.ReactElement) => {
  return render(
    <ThemeProvider theme={theme}>
      {component}
    </ThemeProvider>
  );
};

describe('DataTable', () => {
  const mockData = [
    { id: '1', name: 'Document 1', status: 'active', createdAt: '2024-01-01T00:00:00Z' },
    { id: '2', name: 'Document 2', status: 'inactive', createdAt: '2024-01-02T00:00:00Z' },
    { id: '3', name: 'Document 3', status: 'active', createdAt: '2024-01-03T00:00:00Z' },
  ];

  const columns = [
    { field: 'name', headerName: 'Name', width: 200 },
    createStatusColumn('status', 'Status', {
      active: { label: 'Active', color: 'success' },
      inactive: { label: 'Inactive', color: 'default' },
    }),
    createDateColumn('createdAt', 'Created'),
  ];

  it('renders table with data', () => {
    renderWithTheme(
      <DataTable
        data={mockData}
        columns={columns}
      />
    );
    
    expect(screen.getByText('Document 1')).toBeInTheDocument();
    expect(screen.getByText('Document 2')).toBeInTheDocument();
    expect(screen.getByText('Document 3')).toBeInTheDocument();
  });

  it('renders with title', () => {
    renderWithTheme(
      <DataTable
        title="Test Table"
        data={mockData}
        columns={columns}
      />
    );
    
    expect(screen.getByText('Test Table')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    renderWithTheme(
      <DataTable
        data={[]}
        columns={columns}
        loading
      />
    );
    
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('handles row click', async () => {
    const handleRowClick = jest.fn();
    renderWithTheme(
      <DataTable
        data={mockData}
        columns={columns}
        onRowClick={handleRowClick}
      />
    );
    
    const row = screen.getByText('Document 1').closest('tr');
    fireEvent.click(row!);
    
    await waitFor(() => {
      expect(handleRowClick).toHaveBeenCalled();
    });
  });

  it('renders action buttons when handlers provided', () => {
    const handleView = jest.fn();
    const handleEdit = jest.fn();
    const handleDelete = jest.fn();
    
    renderWithTheme(
      <DataTable
        data={mockData}
        columns={columns}
        onView={handleView}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    );
    
    // Check for action buttons
    const viewButtons = screen.getAllByLabelText('View');
    expect(viewButtons).toHaveLength(mockData.length);
  });

  it('handles pagination', async () => {
    const largeData = Array.from({ length: 25 }, (_, i) => ({
      id: `${i}`,
      name: `Document ${i}`,
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
    }));
    
    renderWithTheme(
      <DataTable
        data={largeData}
        columns={columns}
        pageSize={10}
      />
    );
    
    // First page should show items 0-9
    expect(screen.getByText('Document 0')).toBeInTheDocument();
    expect(screen.queryByText('Document 10')).not.toBeInTheDocument();
    
    // Navigate to next page
    const nextButton = screen.getByLabelText('Go to next page');
    fireEvent.click(nextButton);
    
    await waitFor(() => {
      expect(screen.getByText('Document 10')).toBeInTheDocument();
      expect(screen.queryByText('Document 0')).not.toBeInTheDocument();
    });
  });

  it('handles checkbox selection', () => {
    renderWithTheme(
      <DataTable
        data={mockData}
        columns={columns}
        checkboxSelection
      />
    );
    
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    
    // Select first row
    fireEvent.click(checkboxes[1]);
    expect(checkboxes[1]).toBeChecked();
  });

  it('renders export button when handler provided', () => {
    const handleExport = jest.fn();
    
    renderWithTheme(
      <DataTable
        title="Test Table"
        data={mockData}
        columns={columns}
        onExport={handleExport}
      />
    );
    
    const exportButton = screen.getByLabelText('Export Data');
    expect(exportButton).toBeInTheDocument();
    
    fireEvent.click(exportButton);
    expect(handleExport).toHaveBeenCalledTimes(1);
  });

  it('shows toolbar when enabled', () => {
    renderWithTheme(
      <DataTable
        data={mockData}
        columns={columns}
        showToolbar
      />
    );
    
    // Check for toolbar elements
    expect(screen.getByLabelText('Export')).toBeInTheDocument();
  });
});

describe('DataTable Helper Functions', () => {
  it('createStatusColumn renders chips correctly', () => {
    const statusColumn = createStatusColumn('status', 'Status', {
      active: { label: 'Active', color: 'success' },
      inactive: { label: 'Inactive', color: 'error' },
    });
    
    const params = { value: 'active' };
    const result = statusColumn.renderCell!(params as any);
    
    render(result as React.ReactElement);
    
    const chip = screen.getByText('Active');
    expect(chip).toBeInTheDocument();
    expect(chip.closest('.MuiChip-root')).toHaveClass('MuiChip-colorSuccess');
  });

  it('createDateColumn formats dates correctly', () => {
    const dateColumn = createDateColumn('date', 'Date');
    
    const params = { value: '2024-01-01T12:00:00Z' };
    const formattedDate = dateColumn.valueGetter!(params as any);
    
    expect(formattedDate).toMatch(/1\/1\/2024/);
  });
});