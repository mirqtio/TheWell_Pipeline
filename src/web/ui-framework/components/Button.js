/**
 * Button Component
 * Accessible, themeable button with multiple variants and states
 */

import React, { forwardRef } from 'react';
import classNames from 'classnames';
import { useTheme } from '../design-system/theme';
import './Button.css';

export const BUTTON_VARIANTS = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  TERTIARY: 'tertiary',
  DANGER: 'danger',
  GHOST: 'ghost',
};

export const BUTTON_SIZES = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
};

export const Button = forwardRef(({
  children,
  variant = BUTTON_VARIANTS.PRIMARY,
  size = BUTTON_SIZES.MD,
  disabled = false,
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  as = 'button',
  className,
  onClick,
  ...props
}, ref) => {
  const theme = useTheme();
  const Component = as;
  
  const classes = classNames(
    'tw-button',
    `tw-button--${variant}`,
    `tw-button--${size}`,
    {
      'tw-button--disabled': disabled || loading,
      'tw-button--loading': loading,
      'tw-button--full-width': fullWidth,
    },
    className
  );

  const handleClick = (e) => {
    if (!disabled && !loading && onClick) {
      onClick(e);
    }
  };

  return (
    <Component
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      onClick={handleClick}
      aria-busy={loading}
      aria-disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span className="tw-button__spinner" aria-hidden="true">
          <svg className="tw-spinner" viewBox="0 0 24 24">
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
        </span>
      )}
      
      {leftIcon && !loading && (
        <span className="tw-button__icon tw-button__icon--left" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      
      <span className="tw-button__content">{children}</span>
      
      {rightIcon && !loading && (
        <span className="tw-button__icon tw-button__icon--right" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </Component>
  );
});

Button.displayName = 'Button';

// Button Group Component
export const ButtonGroup = ({ children, className, ...props }) => {
  const classes = classNames('tw-button-group', className);
  
  return (
    <div className={classes} role="group" {...props}>
      {children}
    </div>
  );
};