/**
 * Loading State Manager
 * Global loading state management with context
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { Spinner } from '../components/Spinner';
import './LoadingManager.css';

// Loading Context
const LoadingContext = createContext();

// Loading Provider
export const LoadingProvider = ({ children }) => {
  const [loadingStates, setLoadingStates] = useState({});
  const [globalLoading, setGlobalLoading] = useState(false);

  // Set loading state for a specific key
  const setLoading = useCallback((key, isLoading) => {
    setLoadingStates(prev => ({
      ...prev,
      [key]: isLoading,
    }));
  }, []);

  // Get loading state for a specific key
  const isLoading = useCallback((key) => {
    if (!key) return globalLoading;
    return loadingStates[key] || false;
  }, [loadingStates, globalLoading]);

  // Check if any loading state is true
  const isAnyLoading = useCallback(() => {
    return globalLoading || Object.values(loadingStates).some(state => state);
  }, [loadingStates, globalLoading]);

  // Clear all loading states
  const clearLoading = useCallback(() => {
    setLoadingStates({});
    setGlobalLoading(false);
  }, []);

  // Execute async function with loading state
  const withLoading = useCallback(async (key, asyncFn) => {
    setLoading(key, true);
    try {
      const result = await asyncFn();
      return result;
    } finally {
      setLoading(key, false);
    }
  }, [setLoading]);

  const value = {
    setLoading,
    isLoading,
    isAnyLoading,
    clearLoading,
    withLoading,
    setGlobalLoading,
    globalLoading,
  };

  return (
    <LoadingContext.Provider value={value}>
      {children}
      {globalLoading && <GlobalLoadingOverlay />}
    </LoadingContext.Provider>
  );
};

// Hook to use loading
export const useLoading = () => {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error('useLoading must be used within LoadingProvider');
  }
  return context;
};

// Global Loading Overlay
const GlobalLoadingOverlay = () => {
  return (
    <div className="tw-loading-overlay" aria-busy="true" aria-label="Loading">
      <div className="tw-loading-overlay__content">
        <Spinner size="xl" />
      </div>
    </div>
  );
};

// Loading wrapper component
export const LoadingWrapper = ({
  loading,
  children,
  spinner = <Spinner />,
  overlay = false,
  minHeight = '200px',
  text,
}) => {
  if (!loading) {
    return children;
  }

  if (overlay) {
    return (
      <div className="tw-loading-wrapper" style={{ minHeight }}>
        {children}
        <div className="tw-loading-wrapper__overlay">
          <div className="tw-loading-wrapper__spinner">
            {spinner}
            {text && <p className="tw-loading-wrapper__text">{text}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-loading-wrapper" style={{ minHeight }}>
      <div className="tw-loading-wrapper__spinner">
        {spinner}
        {text && <p className="tw-loading-wrapper__text">{text}</p>}
      </div>
    </div>
  );
};

// Progress loading component
export const ProgressLoader = ({
  progress = 0,
  total = 100,
  label,
  showPercentage = true,
}) => {
  const percentage = Math.round((progress / total) * 100);

  return (
    <div className="tw-progress-loader">
      {label && <div className="tw-progress-loader__label">{label}</div>}
      <div className="tw-progress-loader__bar">
        <div
          className="tw-progress-loader__fill"
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin="0"
          aria-valuemax={total}
        />
      </div>
      {showPercentage && (
        <div className="tw-progress-loader__percentage">{percentage}%</div>
      )}
    </div>
  );
};