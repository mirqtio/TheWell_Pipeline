/**
 * CurationBoard Component Unit Tests
 */

const React = require('react');
const { render, screen, fireEvent, waitFor, within } = require('@testing-library/react');
const userEvent = require('@testing-library/user-event');
const '@testing-library/jest-dom';
const CurationBoard = require('../../../../src/web/components/curation/CurationBoard');

// Mock fetch
global.fetch = jest.fn();

// Mock document data
const mockDocuments = [
  {
    id: 'doc-001',
    title: 'Introduction to Machine Learning',
    contentPreview: 'Machine learning is a subset of AI...',
    source: { type: 'pdf', name: 'ML_Introduction.pdf' },
    metadata: { wordCount: 1250, language: 'en' },
    priority: 2,
    flags: [{ type: 'quality-check', notes: 'Needs technical review' }],
    status: 'pending',
    createdAt: new Date().toISOString()
  },
  {
    id: 'doc-002', 
    title: 'Data Science Best Practices',
    contentPreview: 'This document outlines essential practices...',
    source: { type: 'web', name: 'Data Science Blog' },
    metadata: { wordCount: 850, language: 'en' },
    priority: 1,
    flags: [],
    status: 'pending',
    createdAt: new Date().toISOString()
  }
];

describe('CurationBoard Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock responses
    fetch.mockImplementation((url) => {
      if (url.includes('/api/curation/items')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            items: mockDocuments,
            pagination: {
              page: 1,
              pages: 1,
              total: 2,
              hasNext: false,
              hasPrev: false
            }
          })
        });
      }
      
      if (url.includes('/api/curation/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            pending: 15,
            inReview: 3,
            approved: 245,
            rejected: 12
          })
        });
      }
      
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
    });
  });

  test('renders curation board', async () => {
    render(<CurationBoard />);
    
    expect(screen.getByText(/Curation Board|Document Review/i)).toBeInTheDocument();
  });

  test('displays statistics', async () => {
    render(<CurationBoard />);
    
    await waitFor(() => {
      expect(screen.getByText(/15.*Pending/i)).toBeInTheDocument();
      expect(screen.getByText(/3.*In Review/i)).toBeInTheDocument();
      expect(screen.getByText(/245.*Approved/i)).toBeInTheDocument();
    });
  });

  test('shows document list', async () => {
    render(<CurationBoard />);
    
    await waitFor(() => {
      expect(screen.getByText('Introduction to Machine Learning')).toBeInTheDocument();
      expect(screen.getByText('Data Science Best Practices')).toBeInTheDocument();
    });
  });

  test('displays document metadata', async () => {
    render(<CurationBoard />);
    
    await waitFor(() => {
      expect(screen.getByText(/1250.*words/i)).toBeInTheDocument();
      expect(screen.getByText(/ML_Introduction.pdf/)).toBeInTheDocument();
    });
  });

  test('shows priority indicators', async () => {
    render(<CurationBoard />);
    
    await waitFor(() => {
      const priorityElements = screen.getAllByTestId(/priority|badge/i);
      expect(priorityElements.length).toBeGreaterThan(0);
    });
  });

  test('displays flags', async () => {
    render(<CurationBoard />);
    
    await waitFor(() => {
      expect(screen.getByText(/quality-check/i)).toBeInTheDocument();
      expect(screen.getByText(/Needs technical review/i)).toBeInTheDocument();
    });
  });

  test('filters documents', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    await waitFor(() => {
      const filterSelect = screen.getByRole('combobox', { name: /filter/i });
      expect(filterSelect).toBeInTheDocument();
    });
    
    const filterSelect = screen.getByRole('combobox', { name: /filter/i });
    await user.selectOptions(filterSelect, 'flagged');
    
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('filter=flagged'),
      expect.any(Object)
    );
  });

  test('searches documents', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    const searchInput = screen.getByPlaceholderText(/search/i);
    await user.type(searchInput, 'machine learning');
    await user.keyboard('{Enter}');
    
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=machine%20learning'),
        expect.any(Object)
      );
    });
  });

  test('opens document detail modal', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    await waitFor(() => {
      const firstDocument = screen.getByText('Introduction to Machine Learning');
      expect(firstDocument).toBeInTheDocument();
    });
    
    const firstDocument = screen.getByText('Introduction to Machine Learning');
    await user.click(firstDocument);
    
    await waitFor(() => {
      // Should show modal with full content
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/Machine learning is a subset of AI/i)).toBeInTheDocument();
    });
  });

  test('approves document', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    // Open document detail
    await waitFor(() => {
      const firstDocument = screen.getByText('Introduction to Machine Learning');
      expect(firstDocument).toBeInTheDocument();
    });
    
    await user.click(screen.getByText('Introduction to Machine Learning'));
    
    // Click approve button
    const approveButton = screen.getByRole('button', { name: /approve/i });
    await user.click(approveButton);
    
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/curation/doc-001/approve'),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });
    
    // Should show success message
    expect(screen.getByText(/approved successfully/i)).toBeInTheDocument();
  });

  test('rejects document with reason', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    // Open document detail
    await waitFor(() => {
      const firstDocument = screen.getByText('Introduction to Machine Learning');
      expect(firstDocument).toBeInTheDocument();
    });
    
    await user.click(screen.getByText('Introduction to Machine Learning'));
    
    // Click reject button
    const rejectButton = screen.getByRole('button', { name: /reject/i });
    await user.click(rejectButton);
    
    // Should show reason dialog
    const reasonInput = screen.getByPlaceholderText(/reason/i);
    await user.type(reasonInput, 'Insufficient technical depth');
    
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    await user.click(confirmButton);
    
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/curation/doc-001/reject'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Insufficient technical depth')
        })
      );
    });
  });

  test('flags document for review', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    // Open document detail
    await waitFor(() => {
      const firstDocument = screen.getByText('Introduction to Machine Learning');
      expect(firstDocument).toBeInTheDocument();
    });
    
    await user.click(screen.getByText('Introduction to Machine Learning'));
    
    // Click flag button
    const flagButton = screen.getByRole('button', { name: /flag/i });
    await user.click(flagButton);
    
    // Select flag type
    const flagTypeSelect = screen.getByRole('combobox', { name: /flag type/i });
    await user.selectOptions(flagTypeSelect, 'accuracy');
    
    // Add notes
    const notesInput = screen.getByPlaceholderText(/notes/i);
    await user.type(notesInput, 'Some facts need verification');
    
    // Submit
    const submitButton = screen.getByRole('button', { name: /submit/i });
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/curation/doc-001/flag'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('accuracy')
        })
      );
    });
  });

  test('handles pagination', async () => {
    // Mock paginated response
    fetch.mockImplementationOnce((url) => {
      if (url.includes('/api/curation/items')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            items: mockDocuments,
            pagination: {
              page: 1,
              pages: 3,
              total: 30,
              hasNext: true,
              hasPrev: false
            }
          })
        });
      }
    });
    
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();
    });
    
    // Click next page
    const nextButton = screen.getByRole('button', { name: /next/i });
    await user.click(nextButton);
    
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('page=2'),
      expect.any(Object)
    );
  });

  test('sorts documents', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    const sortSelect = screen.getByRole('combobox', { name: /sort/i });
    await user.selectOptions(sortSelect, 'priority');
    
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('sort=priority'),
      expect.any(Object)
    );
  });

  test('bulk selects documents', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    await waitFor(() => {
      const selectAllCheckbox = screen.getByRole('checkbox', { name: /select all/i });
      expect(selectAllCheckbox).toBeInTheDocument();
    });
    
    // Select all
    const selectAllCheckbox = screen.getByRole('checkbox', { name: /select all/i });
    await user.click(selectAllCheckbox);
    
    // Should show bulk actions
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bulk approve/i })).toBeInTheDocument();
  });

  test('handles loading state', () => {
    render(<CurationBoard />);
    
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  test('handles error state', async () => {
    fetch.mockRejectedValueOnce(new Error('Network error'));
    
    render(<CurationBoard />);
    
    await waitFor(() => {
      expect(screen.getByText(/error.*loading/i)).toBeInTheDocument();
    });
    
    // Should show retry button
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  test('exports curation data', async () => {
    const user = userEvent.setup();
    render(<CurationBoard />);
    
    await waitFor(() => {
      const exportButton = screen.getByRole('button', { name: /export/i });
      expect(exportButton).toBeInTheDocument();
    });
    
    const exportButton = screen.getByRole('button', { name: /export/i });
    await user.click(exportButton);
    
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/curation/export'),
      expect.any(Object)
    );
  });
});