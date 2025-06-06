import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@mui/material/styles';
import MetricsCard from '../../../src/web/dashboard/components/MetricsCard';
import { theme } from '../../../src/web/dashboard/theme';

const renderWithTheme = (component: React.ReactElement) => {
  return render(
    <ThemeProvider theme={theme}>
      {component}
    </ThemeProvider>
  );
};

describe('MetricsCard', () => {
  const defaultProps = {
    title: 'Test Metric',
    value: '100',
    unit: 'ms',
  };

  it('renders with basic props', () => {
    renderWithTheme(<MetricsCard {...defaultProps} />);
    
    expect(screen.getByText('Test Metric')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('ms')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    renderWithTheme(<MetricsCard {...defaultProps} loading />);
    
    expect(screen.queryByText('Test Metric')).not.toBeInTheDocument();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('renders with trend information', () => {
    renderWithTheme(
      <MetricsCard
        {...defaultProps}
        trend="increasing"
        trendValue={10.5}
      />
    );
    
    expect(screen.getByText('Increasing')).toBeInTheDocument();
    expect(screen.getByText('+10.5%')).toBeInTheDocument();
  });

  it('renders status indicator', () => {
    renderWithTheme(
      <MetricsCard
        {...defaultProps}
        status="healthy"
      />
    );
    
    const statusIndicator = document.querySelector('.status-healthy');
    expect(statusIndicator).toBeInTheDocument();
  });

  it('handles click events', () => {
    const handleClick = jest.fn();
    renderWithTheme(
      <MetricsCard
        {...defaultProps}
        onClick={handleClick}
      />
    );
    
    const card = screen.getByText('Test Metric').closest('.MuiCard-root');
    fireEvent.click(card!);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders different trend types correctly', () => {
    const trends = ['increasing', 'decreasing', 'stable', 'improving', 'degrading'];
    
    trends.forEach(trend => {
      const { rerender } = renderWithTheme(
        <MetricsCard {...defaultProps} trend={trend as any} />
      );
      
      expect(screen.getByText(trend.charAt(0).toUpperCase() + trend.slice(1))).toBeInTheDocument();
      
      rerender(<></>);
    });
  });

  it('renders without unit', () => {
    renderWithTheme(
      <MetricsCard
        title="Test Metric"
        value="100"
      />
    );
    
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByText('ms')).not.toBeInTheDocument();
  });

  it('renders with sparkline data placeholder', () => {
    renderWithTheme(
      <MetricsCard
        {...defaultProps}
        sparklineData={[1, 2, 3, 4, 5]}
      />
    );
    
    // Check for sparkline container
    const sparklineContainer = document.querySelector('.MuiBox-root');
    expect(sparklineContainer).toBeInTheDocument();
  });
});