import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import App from '../../../src/web/dashboard/App';
import { store } from '../../../src/web/dashboard/store';
import { theme } from '../../../src/web/dashboard/theme';

// Mock the API client
jest.mock('../../../src/web/dashboard/api/client', () => ({
  api: {
    get: jest.fn((url) => {
      if (url === '/dashboard/overview') {
        return Promise.resolve({
          data: {
            status: 'healthy',
            lastUpdated: new Date().toISOString(),
            summary: {
              cost: {
                dailySpending: 24.67,
                monthlySpending: 740.10,
                budgetUtilization: 0.74,
                trend: 'stable',
              },
              quality: {
                overallHealth: 99.5,
                errorRate: 0.5,
                avgResponseTime: 150,
                trend: 'improving',
              },
              operational: {
                uptime: 99.9,
                systemHealth: 'healthy',
                throughput: 450,
                activeConnections: 125,
              },
            },
          },
        });
      }
      if (url === '/documents') {
        return Promise.resolve({
          data: {
            documents: [
              { id: '1', title: 'Doc 1', status: 'completed', source: 'api', type: 'article', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
              { id: '2', title: 'Doc 2', status: 'processing', source: 'web', type: 'report', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            ],
            totalCount: 2,
          },
        });
      }
      if (url === '/alerts') {
        return Promise.resolve({
          data: {
            alerts: [
              { id: '1', title: 'High CPU Usage', severity: 'high', type: 'system', status: 'active', message: 'CPU usage exceeded 90%', source: 'Monitor', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            ],
            activeCount: 1,
          },
        });
      }
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  },
  dashboardApi: {
    getOverview: jest.fn().mockResolvedValue({ data: {} }),
  },
  documentsApi: {
    getDocuments: jest.fn().mockResolvedValue({ data: { documents: [], totalCount: 0 } }),
  },
  alertsApi: {
    getAlerts: jest.fn().mockResolvedValue({ data: { alerts: [], activeCount: 0 } }),
  },
  searchApi: {
    search: jest.fn().mockResolvedValue({ data: { results: [], totalResults: 0, searchTime: 0 } }),
    getPopularSearches: jest.fn().mockResolvedValue({ data: { searches: [] } }),
    getSearchAnalytics: jest.fn().mockResolvedValue({ data: { trends: [] } }),
  },
  reportsApi: {
    getReports: jest.fn().mockResolvedValue({ data: { reports: [] } }),
  },
}));

// Mock socket.io-client
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  })),
}));

const renderApp = () => {
  return render(
    <Provider store={store}>
      <BrowserRouter>
        <ThemeProvider theme={theme}>
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </Provider>
  );
};

describe('Dashboard Integration Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dashboard layout with navigation', async () => {
    renderApp();
    
    await waitFor(() => {
      expect(screen.getByText('TheWell Pipeline Dashboard')).toBeInTheDocument();
    });
    
    // Check navigation items
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });

  it('navigates between pages', async () => {
    renderApp();
    
    // Start on overview page
    await waitFor(() => {
      expect(screen.getByText('System Overview')).toBeInTheDocument();
    });
    
    // Navigate to Documents
    fireEvent.click(screen.getByText('Documents'));
    await waitFor(() => {
      expect(screen.getByText('Documents', { selector: 'h4' })).toBeInTheDocument();
    });
    
    // Navigate to Search
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => {
      expect(screen.getByText('Search Analytics')).toBeInTheDocument();
    });
    
    // Navigate to Alerts
    fireEvent.click(screen.getByText('Alerts'));
    await waitFor(() => {
      expect(screen.getByText('Alerts & Notifications')).toBeInTheDocument();
    });
    
    // Navigate to Reports
    fireEvent.click(screen.getByText('Reports'));
    await waitFor(() => {
      expect(screen.getByText('Reports & Analytics')).toBeInTheDocument();
    });
  });

  it('loads and displays overview data', async () => {
    renderApp();
    
    await waitFor(() => {
      expect(screen.getByText('Daily Cost')).toBeInTheDocument();
      expect(screen.getByText('24.67')).toBeInTheDocument();
      expect(screen.getByText('System Health')).toBeInTheDocument();
      expect(screen.getByText('99.5%')).toBeInTheDocument();
    });
  });

  it('shows alert badge in navigation', async () => {
    renderApp();
    
    await waitFor(() => {
      const alertsNavItem = screen.getByText('Alerts').closest('li');
      const badge = alertsNavItem?.querySelector('.MuiBadge-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('3'); // Mock value from nav item
    });
  });

  it('toggles sidebar drawer', async () => {
    renderApp();
    
    const toggleButton = screen.getByLabelText('toggle drawer');
    
    // Check if drawer is open (default)
    expect(screen.getByText('Overview')).toBeVisible();
    
    // Close drawer
    fireEvent.click(toggleButton);
    
    await waitFor(() => {
      const drawer = screen.getByText('Overview').closest('.MuiDrawer-paper');
      expect(drawer).toHaveStyle({ display: 'none' });
    });
    
    // Open drawer again
    fireEvent.click(toggleButton);
    
    await waitFor(() => {
      const drawer = screen.getByText('Overview').closest('.MuiDrawer-paper');
      expect(drawer).toHaveStyle({ display: 'block' });
    });
  });

  it('shows user menu on profile click', async () => {
    renderApp();
    
    const profileButton = screen.getByLabelText('Account of current user');
    fireEvent.click(profileButton);
    
    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Logout')).toBeInTheDocument();
    });
  });

  it('initializes WebSocket connection', async () => {
    const { io } = require('socket.io-client');
    renderApp();
    
    await waitFor(() => {
      expect(io).toHaveBeenCalledWith(
        '/',
        expect.objectContaining({
          path: '/socket.io',
          transports: ['websocket', 'polling'],
        })
      );
    });
  });

  it('fetches initial data on mount', async () => {
    const { api } = require('../../../src/web/dashboard/api/client');
    renderApp();
    
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/dashboard/overview', expect.any(Object));
    });
  });
});