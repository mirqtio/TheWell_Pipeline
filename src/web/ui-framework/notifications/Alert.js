/**
 * Alert Component
 * Inline alert messages for important information
 */

import React from 'react';
import classNames from 'classnames';
import './Alert.css';

export const ALERT_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

export const Alert = ({
  children,
  type = ALERT_TYPES.INFO,
  title,
  icon = true,
  closable = false,
  onClose,
  action,
  className,
  ...props
}) => {
  const classes = classNames(
    'tw-alert',
    `tw-alert--${type}`,
    className
  );

  const getIcon = () => {
    if (!icon) return null;
    
    switch (type) {
    case ALERT_TYPES.SUCCESS:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8.33333" stroke="currentColor" strokeWidth="2" />
          <path
            d="M13.333 7.5L8.74998 12.0833L6.66665 10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case ALERT_TYPES.ERROR:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8.33333" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12.5 7.5L7.5 12.5M7.5 7.5L12.5 12.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case ALERT_TYPES.WARNING:
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
    <div className={classes} role="alert" {...props}>
      {icon && (
        <div className="tw-alert__icon">
          {getIcon()}
        </div>
      )}
      
      <div className="tw-alert__content">
        {title && <div className="tw-alert__title">{title}</div>}
        <div className="tw-alert__message">{children}</div>
        {action && (
          <button
            className="tw-alert__action"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </div>
      
      {closable && (
        <button
          className="tw-alert__close"
          onClick={onClose}
          aria-label="Close alert"
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
      )}
    </div>
  );
};

// Alert Banner Component (full-width variant)
export const AlertBanner = ({
  children,
  type = ALERT_TYPES.INFO,
  closable = true,
  onClose,
  className,
  ...props
}) => {
  const classes = classNames(
    'tw-alert-banner',
    `tw-alert-banner--${type}`,
    className
  );

  return (
    <div className={classes} role="alert" {...props}>
      <div className="tw-alert-banner__content">
        {children}
      </div>
      
      {closable && (
        <button
          className="tw-alert-banner__close"
          onClick={onClose}
          aria-label="Close banner"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M15 5L5 15M5 5L15 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
};