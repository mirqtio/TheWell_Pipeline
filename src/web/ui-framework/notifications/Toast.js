/**
 * Toast Notification System
 * Non-blocking notifications with automatic dismissal
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import './Toast.css';

const TOAST_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

const TOAST_POSITIONS = {
  TOP_LEFT: 'top-left',
  TOP_CENTER: 'top-center',
  TOP_RIGHT: 'top-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_CENTER: 'bottom-center',
  BOTTOM_RIGHT: 'bottom-right',
};

// Toast Context
const ToastContext = createContext();

// Toast Provider
export const ToastProvider = ({
  children,
  position = TOAST_POSITIONS.TOP_RIGHT,
  duration = 5000,
}) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, options = {}) => {
    const id = Date.now();
    const toast = {
      id,
      message,
      type: options.type || TOAST_TYPES.INFO,
      duration: options.duration || duration,
      action: options.action,
      onClose: options.onClose,
    };

    setToasts(prev => [...prev, toast]);

    if (toast.duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, toast.duration);
    }

    return id;
  }, [duration]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  // Helper methods
  const success = useCallback((message, options) => {
    return addToast(message, { ...options, type: TOAST_TYPES.SUCCESS });
  }, [addToast]);

  const error = useCallback((message, options) => {
    return addToast(message, { ...options, type: TOAST_TYPES.ERROR });
  }, [addToast]);

  const warning = useCallback((message, options) => {
    return addToast(message, { ...options, type: TOAST_TYPES.WARNING });
  }, [addToast]);

  const info = useCallback((message, options) => {
    return addToast(message, { ...options, type: TOAST_TYPES.INFO });
  }, [addToast]);

  const value = {
    toasts,
    addToast,
    removeToast,
    clearToasts,
    success,
    error,
    warning,
    info,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer position={position} />
    </ToastContext.Provider>
  );
};

// Hook to use toast
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

// Toast Container
const ToastContainer = ({ position }) => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  const containerClasses = classNames(
    'tw-toast-container',
    `tw-toast-container--${position}`
  );

  return createPortal(
    <div className={containerClasses} role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          {...toast}
          onClose={() => {
            if (toast.onClose) toast.onClose();
            removeToast(toast.id);
          }}
        />
      ))}
    </div>,
    document.body
  );
};

// Individual Toast Component
const Toast = ({ id, message, type, action, onClose }) => {
  const toastClasses = classNames(
    'tw-toast',
    `tw-toast--${type}`
  );

  const getIcon = () => {
    switch (type) {
    case TOAST_TYPES.SUCCESS:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M16.666 5L7.49998 14.1667L3.33331 10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case TOAST_TYPES.ERROR:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 10V6.66667M10 13.3333H10.0083"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10" r="8.33333" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case TOAST_TYPES.WARNING:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M8.57465 3.21468L1.51632 14.9999C1.37079 15.2519 1.29379 15.5375 1.29298 15.8284C1.29216 16.1192 1.36756 16.4052 1.51167 16.658C1.65579 16.9108 1.86359 17.1217 2.11441 17.2696C2.36523 17.4175 2.65032 17.4969 2.94132 17.4999H17.058C17.349 17.4969 17.6341 17.4175 17.8849 17.2696C18.1357 17.1217 18.3435 16.9108 18.4876 16.658C18.6317 16.4052 18.7071 16.1192 18.7063 15.8284C18.7055 15.5375 18.6285 15.2519 18.483 14.9999L11.4247 3.21468C11.2764 2.96989 11.0673 2.76728 10.8173 2.6264C10.5674 2.48553 10.2847 2.41113 9.99965 2.41113C9.71461 2.41113 9.43292 2.48553 9.18292 2.6264C8.93293 2.76728 8.72385 2.96989 8.57465 3.21468Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 7.5V10.8333M10 14.1667H10.0083"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8.33333" stroke="currentColor" strokeWidth="2" />
          <path
            d="M10 13.3333V10M10 6.66667H10.0083"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
  };

  return (
    <div className={toastClasses} role="alert">
      <div className="tw-toast__icon">
        {getIcon()}
      </div>
      
      <div className="tw-toast__content">
        <div className="tw-toast__message">{message}</div>
        {action && (
          <button
            className="tw-toast__action"
            onClick={() => {
              action.onClick();
              onClose();
            }}
          >
            {action.label}
          </button>
        )}
      </div>
      
      <button
        className="tw-toast__close"
        onClick={onClose}
        aria-label="Close notification"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M12 4L4 12M4 4L12 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
};

// Export constants
export { TOAST_TYPES, TOAST_POSITIONS };