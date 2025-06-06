/**
 * Stack Component
 * Vertical or horizontal stacking layout with consistent spacing
 */

import React from 'react';
import classNames from 'classnames';
import './Stack.css';

export const Stack = ({
  children,
  direction = 'vertical',
  spacing = 4,
  align = 'stretch',
  justify = 'start',
  wrap = false,
  divider = false,
  className,
  as: Component = 'div',
  ...props
}) => {
  const classes = classNames(
    'tw-stack',
    `tw-stack--${direction}`,
    `tw-stack--spacing-${spacing}`,
    `tw-stack--align-${align}`,
    `tw-stack--justify-${justify}`,
    {
      'tw-stack--wrap': wrap,
      'tw-stack--divider': divider,
    },
    className
  );

  return (
    <Component className={classes} {...props}>
      {React.Children.map(children, (child, index) => {
        if (!child) return null;
        
        return (
          <div className="tw-stack__item" key={index}>
            {child}
          </div>
        );
      })}
    </Component>
  );
};

// Spacer component for flexible spacing
export const Spacer = ({ className, ...props }) => {
  const classes = classNames('tw-spacer', className);
  return <div className={classes} aria-hidden="true" {...props} />;
};