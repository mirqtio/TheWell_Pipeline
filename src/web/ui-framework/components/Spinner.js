/**
 * Spinner Component
 * Loading indicator with multiple sizes and variants
 */

import React from 'react';
import classNames from 'classnames';
import './Spinner.css';

export const SPINNER_SIZES = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
  XL: 'xl',
};

export const Spinner = ({
  size = SPINNER_SIZES.MD,
  className,
  label = 'Loading',
  center = false,
  overlay = false,
  ...props
}) => {
  const spinnerClasses = classNames(
    'tw-spinner',
    `tw-spinner--${size}`,
    className
  );

  const spinner = (
    <div className={spinnerClasses} role="status" aria-label={label} {...props}>
      <svg className="tw-spinner__svg" viewBox="0 0 24 24">
        <circle
          className="tw-spinner__track"
          cx="12"
          cy="12"
          r="10"
          fill="none"
          strokeWidth="3"
        />
        <circle
          className="tw-spinner__fill"
          cx="12"
          cy="12"
          r="10"
          fill="none"
          strokeWidth="3"
          pathLength="100"
          strokeDasharray="25 75"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );

  if (overlay) {
    return (
      <div className="tw-spinner-overlay">
        <div className="tw-spinner-overlay__content">
          {spinner}
        </div>
      </div>
    );
  }

  if (center) {
    return (
      <div className="tw-spinner-container">
        {spinner}
      </div>
    );
  }

  return spinner;
};

// Loading state wrapper component
export const LoadingState = ({
  loading,
  children,
  spinner = <Spinner />,
  minHeight = '200px',
}) => {
  if (!loading) {
    return children;
  }

  return (
    <div className="tw-loading-state" style={{ minHeight }}>
      {spinner}
    </div>
  );
};