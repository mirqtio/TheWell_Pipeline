/**
 * Error Boundary Component
 * Global error handling for React components
 */

import React from 'react';
import { Alert } from '../notifications/Alert';
import { Button } from '../components/Button';
import './ErrorBoundary.css';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to error reporting service
    console.error('Error caught by boundary:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo,
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Call custom reset handler if provided
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback(
          this.state.error,
          this.state.errorInfo,
          this.handleReset
        );
      }

      // Default fallback UI
      return (
        <div className="tw-error-boundary">
          <div className="tw-error-boundary__content">
            <div className="tw-error-boundary__icon">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="4" />
                <path
                  d="M32 20V36M32 44H32.02"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            
            <h1 className="tw-error-boundary__title">
              {this.props.title || 'Something went wrong'}
            </h1>
            
            <p className="tw-error-boundary__message">
              {this.props.message || 'An unexpected error occurred. Please try refreshing the page.'}
            </p>

            {this.state.error && process.env.NODE_ENV === 'development' && (
              <Alert type="error" className="tw-error-boundary__details">
                <details>
                  <summary>Error details (Development only)</summary>
                  <pre>{this.state.error.toString()}</pre>
                  {this.state.errorInfo && (
                    <pre>{this.state.errorInfo.componentStack}</pre>
                  )}
                </details>
              </Alert>
            )}

            <div className="tw-error-boundary__actions">
              <Button onClick={this.handleReset}>
                Try Again
              </Button>
              <Button variant="ghost" onClick={() => window.location.href = '/'}>
                Go Home
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook for error handling in functional components
export const useErrorHandler = () => {
  const [error, setError] = React.useState(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const captureError = React.useCallback((error) => {
    setError(error);
  }, []);

  // Throw error to be caught by nearest error boundary
  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return { captureError, resetError };
};

// Async Error Boundary for handling async errors
export const AsyncErrorBoundary = ({ children, fallback, onError }) => {
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    const handleUnhandledRejection = (event) => {
      setError(new Error(event.reason));
      if (onError) {
        onError(event.reason);
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [onError]);

  if (error) {
    if (fallback) {
      return fallback(error, () => setError(null));
    }
    throw error;
  }

  return children;
};