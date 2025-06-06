/**
 * Container Component
 * Responsive container with max-width constraints
 */

import React from 'react';
import classNames from 'classnames';
import './Container.css';

export const CONTAINER_SIZES = {
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
  XL: 'xl',
  FULL: 'full',
};

export const Container = ({
  children,
  size = CONTAINER_SIZES.XL,
  fluid = false,
  centered = true,
  className,
  as: Component = 'div',
  ...props
}) => {
  const classes = classNames(
    'tw-container',
    {
      [`tw-container--${size}`]: !fluid,
      'tw-container--fluid': fluid,
      'tw-container--centered': centered,
    },
    className
  );

  return (
    <Component className={classes} {...props}>
      {children}
    </Component>
  );
};

// Section component for page sections
export const Section = ({
  children,
  className,
  spacing = 'md',
  as: Component = 'section',
  ...props
}) => {
  const classes = classNames(
    'tw-section',
    `tw-section--spacing-${spacing}`,
    className
  );

  return (
    <Component className={classes} {...props}>
      {children}
    </Component>
  );
};