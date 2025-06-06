/**
 * Badge Component
 * Small label component for status indicators and counts
 */

import React from 'react';
import classNames from 'classnames';
import './Badge.css';

export const BADGE_VARIANTS = {
  DEFAULT: 'default',
  PRIMARY: 'primary',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  INFO: 'info',
};

export const BADGE_SIZES = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
};

export const Badge = ({
  children,
  variant = BADGE_VARIANTS.DEFAULT,
  size = BADGE_SIZES.MD,
  dot = false,
  rounded = false,
  className,
  ...props
}) => {
  const classes = classNames(
    'tw-badge',
    `tw-badge--${variant}`,
    `tw-badge--${size}`,
    {
      'tw-badge--dot': dot,
      'tw-badge--rounded': rounded,
    },
    className
  );

  if (dot) {
    return <span className={classes} aria-label={children} {...props} />;
  }

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
};

// Badge Group for multiple badges
export const BadgeGroup = ({
  children,
  className,
  ...props
}) => {
  const classes = classNames('tw-badge-group', className);
  
  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};