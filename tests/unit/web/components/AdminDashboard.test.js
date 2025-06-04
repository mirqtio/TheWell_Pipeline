/**
 * AdminDashboard Component Unit Tests
 */

const React = require('react');
const { render, screen, fireEvent, waitFor } = require('@testing-library/react');
const '@testing-library/jest-dom';
const AdminDashboard = require('../../../../src/web/components/admin/AdminDashboard');

// Mock the fetch API
global.fetch = jest.fn();

describe('AdminDashboard Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock responses
    fetch.mockImplementation((url) => {
      if (url.includes('/api/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: 'healthy',
            services: {
              api: 'online',
              database: 'connected',
              cache: 'ready',
              queue: 'active'
            }
          })
        });
      }
      
      if (url.includes('/api/jobs/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            queues: {
              ingestion: { waiting: 5, active: 2, completed: 150, failed: 3 },
              enrichment: { waiting: 2, active: 1, completed: 89, failed: 1 }
            }
          })
        });
      }
      
      if (url.includes('/api/monitoring/metrics')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            requests: { total: 10000, rate: 15.5 },
            latency: { p50: 45, p95: 120, p99: 250 },
            errors: { total: 23, rate: 0.23 }
          })
        });
      }
      
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });
  });

  test('renders dashboard title', async () => {
    render(<AdminDashboard />);
    
    expect(screen.getByText(/Admin Dashboard|TheWell Pipeline/i)).toBeInTheDocument();
  });

  test('displays system status', async () => {
    render(<AdminDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText(/System Status/i)).toBeInTheDocument();
      expect(screen.getByText(/healthy/i)).toBeInTheDocument();
    });
  });

  test('shows service statuses', async () => {
    render(<AdminDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText(/API.*online/i)).toBeInTheDocument();
      expect(screen.getByText(/Database.*connected/i)).toBeInTheDocument();
      expect(screen.getByText(/Cache.*ready/i)).toBeInTheDocument();
    });
  });

  test('displays queue statistics', async () => {
    render(<AdminDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText(/Queue Statistics/i)).toBeInTheDocument();
      expect(screen.getByText(/Ingestion/i)).toBeInTheDocument();
      expect(screen.getByText(/Enrichment/i)).toBeInTheDocument();
    });
  });

  test('shows job counts', async () => {
    render(<AdminDashboard />);
    
    await waitFor(() => {
      // Check for queue counts
      expect(screen.getByText(/150/)).toBeInTheDocument(); // completed
      expect(screen.getByText(/5/)).toBeInTheDocument(); // waiting
    });
  });

  test('displays performance metrics', async () => {
    render(<AdminDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText(/Performance Metrics/i)).toBeInTheDocument();
      expect(screen.getByText(/15.5/)).toBeInTheDocument(); // request rate
      expect(screen.getByText(/120/)).toBeInTheDocument(); // p95 latency
    });
  });

  test('handles loading state', () => {
    render(<AdminDashboard />);
    
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  test('handles error state', async () => {
    fetch.mockRejectedValueOnce(new Error('Network error'));
    
    render(<AdminDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText(/Error.*loading/i)).toBeInTheDocument();
    });
  });

  test('refreshes data on interval', async () => {
    jest.useFakeTimers();
    
    render(<AdminDashboard />);
    
    // Initial load
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(3); // status, jobs, metrics
    });
    
    // Fast forward 30 seconds
    jest.advanceTimersByTime(30000);
    
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(6); // called again
    });
    
    jest.useRealTimers();
  });

  test('navigates to detailed views', async () => {
    const mockNavigate = jest.fn();
    
    render(<AdminDashboard onNavigate={mockNavigate} />);
    
    await waitFor(() => {
      const jobsLink = screen.getByText(/View All Jobs/i);
      fireEvent.click(jobsLink);
      
      expect(mockNavigate).toHaveBeenCalledWith('/jobs');
    });
  });

  test('displays alerts for critical metrics', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('/api/monitoring/metrics')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            errors: { total: 500, rate: 5.2 }, // High error rate
            latency: { p99: 5000 } // High latency
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    
    render(<AdminDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText(/High error rate/i)).toBeInTheDocument();
      expect(screen.getByText(/High latency/i)).toBeInTheDocument();
    });
  });

  test('shows quick actions', async () => {
    render(<AdminDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText(/Quick Actions/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Review Documents/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Manage Jobs/i })).toBeInTheDocument();
    });
  });

  test('handles service degradation', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('/api/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: 'degraded',
            services: {
              api: 'online',
              database: 'slow',
              cache: 'disconnected'
            }
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    
    render(<AdminDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText(/degraded/i)).toBeInTheDocument();
      expect(screen.getByText(/slow/i)).toBeInTheDocument();
      expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
    });
  });
});