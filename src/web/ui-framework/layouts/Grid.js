/**
 * Grid Layout System
 * Responsive grid component with flexible columns and gaps
 */

import React from 'react';
import classNames from 'classnames';
import './Grid.css';

export const Grid = ({
  children,
  columns = 12,
  gap = 4,
  rowGap,
  columnGap,
  alignItems = 'stretch',
  justifyItems = 'stretch',
  className,
  as: Component = 'div',
  ...props
}) => {
  const classes = classNames(
    'tw-grid',
    {
      [`tw-grid--cols-${columns}`]: typeof columns === 'number',
      [`tw-grid--gap-${gap}`]: gap && !rowGap && !columnGap,
      [`tw-grid--row-gap-${rowGap}`]: rowGap,
      [`tw-grid--col-gap-${columnGap}`]: columnGap,
      [`tw-grid--align-${alignItems}`]: alignItems !== 'stretch',
      [`tw-grid--justify-${justifyItems}`]: justifyItems !== 'stretch',
    },
    className
  );

  const style = {
    ...(typeof columns === 'object' ? {
      '--grid-cols-xs': columns.xs || 1,
      '--grid-cols-sm': columns.sm || columns.xs || 1,
      '--grid-cols-md': columns.md || columns.sm || columns.xs || 1,
      '--grid-cols-lg': columns.lg || columns.md || columns.sm || columns.xs || 1,
      '--grid-cols-xl': columns.xl || columns.lg || columns.md || columns.sm || columns.xs || 1,
    } : {}),
    ...props.style,
  };

  return (
    <Component className={classes} style={style} {...props}>
      {children}
    </Component>
  );
};

export const GridItem = ({
  children,
  span = 1,
  start,
  end,
  rowSpan,
  rowStart,
  rowEnd,
  alignSelf,
  justifySelf,
  className,
  as: Component = 'div',
  ...props
}) => {
  const classes = classNames(
    'tw-grid-item',
    {
      [`tw-grid-item--span-${span}`]: typeof span === 'number',
      [`tw-grid-item--start-${start}`]: start,
      [`tw-grid-item--end-${end}`]: end,
      [`tw-grid-item--row-span-${rowSpan}`]: rowSpan,
      [`tw-grid-item--row-start-${rowStart}`]: rowStart,
      [`tw-grid-item--row-end-${rowEnd}`]: rowEnd,
      [`tw-grid-item--align-${alignSelf}`]: alignSelf,
      [`tw-grid-item--justify-${justifySelf}`]: justifySelf,
    },
    className
  );

  const style = {
    ...(typeof span === 'object' ? {
      '--item-span-xs': span.xs || 1,
      '--item-span-sm': span.sm || span.xs || 1,
      '--item-span-md': span.md || span.sm || span.xs || 1,
      '--item-span-lg': span.lg || span.md || span.sm || span.xs || 1,
      '--item-span-xl': span.xl || span.lg || span.md || span.sm || span.xs || 1,
    } : {}),
    ...props.style,
  };

  return (
    <Component className={classes} style={style} {...props}>
      {children}
    </Component>
  );
};

// Compound component pattern
Grid.Item = GridItem;