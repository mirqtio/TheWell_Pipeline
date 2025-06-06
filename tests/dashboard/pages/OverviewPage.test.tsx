import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { configureStore } from '@reduxjs/toolkit';
import OverviewPage from '../../../src/web/dashboard/pages/OverviewPage';
import dashboardReducer from '../../../src/web/dashboard/store/dashboardSlice';
import { theme } from '../../../src/web/dashboard/theme';

// Mock the API client
jest.mock('../../../src/web/dashboard/api/client', () => ({
  api: {
    get: jest.fn().mockResolvedValue({
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
    }),
  },
}));

const createMockStore = (initialState = {}) => {
  return configureStore({
    reducer: {
      dashboard: dashboardReducer,
    },
    preloadedState: {
      dashboard: {
        overview: null,
        loading: false,
        error: null,
        lastUpdated: null,
        timeRange: '24h',
        autoRefresh: true,
        refreshInterval: 30,
        ...initialState,
      },
    },
  });
};

const renderWithProviders = (component: React.ReactElement, store?: any) => {
  const mockStore = store || createMockStore();
  
  return render(
    <Provider store={mockStore}>
      <BrowserRouter>
        <ThemeProvider theme={theme}>
          {component}
        </ThemeProvider>
      </BrowserRouter>
    </Provider>
  );
};

describe('OverviewPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders page title', () => {
    renderWithProviders(<OverviewPage />);
    
    expect(screen.getByText('System Overview')).toBeInTheDocument();
  });

  it('displays loading state initially', () => {
    const store = createMockStore({ loading: true });
    renderWithProviders(<OverviewPage />, store);
    
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('displays error state', () => {
    const store = createMockStore({ error: 'Failed to load data' });
    renderWithProviders(<OverviewPage />, store);
    
    expect(screen.getByText(/Error loading dashboard/)).toBeInTheDocument();
    expect(screen.getByText(/Failed to load data/)).toBeInTheDocument();
  });

  it('displays metrics cards with data', async () => {
    const store = createMockStore({
      overview: {
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
    
    renderWithProviders(<OverviewPage />, store);
    
    await waitFor(() => {
      expect(screen.getByText('Daily Cost')).toBeInTheDocument();
      expect(screen.getByText('24.67')).toBeInTheDocument();
      expect(screen.getByText('USD')).toBeInTheDocument();
      
      expect(screen.getByText('System Health')).toBeInTheDocument();
      expect(screen.getByText('99.5%')).toBeInTheDocument();
      
      expect(screen.getByText('Error Rate')).toBeInTheDocument();
      expect(screen.getByText('0.5%')).toBeInTheDocument();
      
      expect(screen.getByText('Active Connections')).toBeInTheDocument();
      expect(screen.getByText('125')).toBeInTheDocument();
    });
  });

  it('renders filter panel', () => {
    renderWithProviders(<OverviewPage />);
    
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('renders charts section', () => {
    renderWithProviders(<OverviewPage />);
    
    expect(screen.getByText('Cost Trend')).toBeInTheDocument();
    expect(screen.getByText('Daily spending over time')).toBeInTheDocument();
    
    expect(screen.getByText('Provider Usage')).toBeInTheDocument();
    expect(screen.getByText('Distribution by provider')).toBeInTheDocument();
    
    expect(screen.getByText('Quality Metrics')).toBeInTheDocument();
    expect(screen.getByText('System reliability over time')).toBeInTheDocument();
  });

  it('renders activity feed', () => {
    renderWithProviders(<OverviewPage />);
    
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
    expect(screen.getByText('Document Processing Complete')).toBeInTheDocument();
    expect(screen.getByText('High Response Time Detected')).toBeInTheDocument();
  });

  it('renders system status summary', async () => {
    const store = createMockStore({
      overview: {
        summary: {
          operational: {
            uptime: 99.9,
            throughput: 450,
          },
          quality: {
            avgResponseTime: 150,
          },
          cost: {
            budgetUtilization: 0.74,
          },
        },
      },
    });
    
    renderWithProviders(<OverviewPage />, store);
    
    await waitFor(() => {
      expect(screen.getByText('System Status Summary')).toBeInTheDocument();
      expect(screen.getByText('99.9%')).toBeInTheDocument();
      expect(screen.getByText('Uptime')).toBeInTheDocument();
      expect(screen.getByText('450')).toBeInTheDocument();
      expect(screen.getByText('Requests/min')).toBeInTheDocument();
    });
  });

  it('fetches dashboard data on mount', async () => {
    const { api } = require('../../../src/web/dashboard/api/client');
    renderWithProviders(<OverviewPage />);
    
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/dashboard/overview', { params: { timeRange: '24h' } });
    });
  });
});