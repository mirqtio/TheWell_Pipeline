/**
 * Card Component
 * Flexible container component with header, body, and footer sections
 */

import React from 'react';
import classNames from 'classnames';
import './Card.css';

export const Card = ({
  children,
  className,
  elevated = false,
  interactive = false,
  padding = true,
  ...props
}) => {
  const classes = classNames(
    'tw-card',
    {
      'tw-card--elevated': elevated,
      'tw-card--interactive': interactive,
      'tw-card--no-padding': !padding,
    },
    className
  );

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};

export const CardHeader = ({
  children,
  className,
  actions,
  ...props
}) => {
  const classes = classNames('tw-card__header', className);

  return (
    <div className={classes} {...props}>
      <div className="tw-card__header-content">{children}</div>
      {actions && (
        <div className="tw-card__header-actions">{actions}</div>
      )}
    </div>
  );
};

export const CardTitle = ({
  children,
  as: Component = 'h3',
  className,
  ...props
}) => {
  const classes = classNames('tw-card__title', className);

  return (
    <Component className={classes} {...props}>
      {children}
    </Component>
  );
};

export const CardDescription = ({
  children,
  className,
  ...props
}) => {
  const classes = classNames('tw-card__description', className);

  return (
    <p className={classes} {...props}>
      {children}
    </p>
  );
};

export const CardBody = ({
  children,
  className,
  ...props
}) => {
  const classes = classNames('tw-card__body', className);

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};

export const CardFooter = ({
  children,
  className,
  align = 'right',
  ...props
}) => {
  const classes = classNames(
    'tw-card__footer',
    `tw-card__footer--align-${align}`,
    className
  );

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};

// Compound component pattern
Card.Header = CardHeader;
Card.Title = CardTitle;
Card.Description = CardDescription;
Card.Body = CardBody;
Card.Footer = CardFooter;