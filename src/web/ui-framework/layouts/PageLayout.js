/**
 * Page Layout Components
 * Common page layout patterns and templates
 */

import React, { useState } from 'react';
import classNames from 'classnames';
import './PageLayout.css';

// Main layout wrapper
export const PageLayout = ({
  children,
  className,
  sidebar = false,
  ...props
}) => {
  const classes = classNames(
    'tw-page-layout',
    {
      'tw-page-layout--with-sidebar': sidebar,
    },
    className
  );

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};

// Page header component
export const PageHeader = ({
  children,
  title,
  subtitle,
  actions,
  breadcrumbs,
  sticky = false,
  className,
  ...props
}) => {
  const classes = classNames(
    'tw-page-header',
    {
      'tw-page-header--sticky': sticky,
    },
    className
  );

  return (
    <header className={classes} {...props}>
      {breadcrumbs && (
        <div className="tw-page-header__breadcrumbs">
          {breadcrumbs}
        </div>
      )}
      
      <div className="tw-page-header__main">
        <div className="tw-page-header__content">
          {title && <h1 className="tw-page-header__title">{title}</h1>}
          {subtitle && <p className="tw-page-header__subtitle">{subtitle}</p>}
          {children}
        </div>
        
        {actions && (
          <div className="tw-page-header__actions">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
};

// Sidebar component
export const Sidebar = ({
  children,
  position = 'left',
  collapsible = false,
  defaultCollapsed = false,
  className,
  ...props
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  
  const classes = classNames(
    'tw-sidebar',
    `tw-sidebar--${position}`,
    {
      'tw-sidebar--collapsible': collapsible,
      'tw-sidebar--collapsed': collapsed,
    },
    className
  );

  return (
    <aside className={classes} {...props}>
      {collapsible && (
        <button
          className="tw-sidebar__toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            {collapsed ? (
              <path d="M9 18l6-6-6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M15 18l-6-6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      )}
      
      <div className="tw-sidebar__content">
        {children}
      </div>
    </aside>
  );
};

// Main content area
export const PageContent = ({
  children,
  className,
  maxWidth = 'xl',
  centered = true,
  ...props
}) => {
  const classes = classNames(
    'tw-page-content',
    `tw-page-content--max-${maxWidth}`,
    {
      'tw-page-content--centered': centered,
    },
    className
  );

  return (
    <main className={classes} {...props}>
      {children}
    </main>
  );
};

// Page footer component
export const PageFooter = ({
  children,
  className,
  ...props
}) => {
  const classes = classNames('tw-page-footer', className);

  return (
    <footer className={classes} {...props}>
      {children}
    </footer>
  );
};

// Breadcrumbs component
export const Breadcrumbs = ({
  items,
  separator = '/',
  className,
  ...props
}) => {
  const classes = classNames('tw-breadcrumbs', className);

  return (
    <nav className={classes} aria-label="Breadcrumb" {...props}>
      <ol className="tw-breadcrumbs__list">
        {items.map((item, index) => (
          <li key={index} className="tw-breadcrumbs__item">
            {item.href ? (
              <a href={item.href} className="tw-breadcrumbs__link">
                {item.label}
              </a>
            ) : (
              <span className="tw-breadcrumbs__text" aria-current={index === items.length - 1 ? 'page' : undefined}>
                {item.label}
              </span>
            )}
            
            {index < items.length - 1 && (
              <span className="tw-breadcrumbs__separator" aria-hidden="true">
                {separator}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
};

// Tabs component
export const Tabs = ({
  tabs,
  activeTab,
  onChange,
  className,
  ...props
}) => {
  const classes = classNames('tw-tabs', className);

  return (
    <div className={classes} {...props}>
      <div className="tw-tabs__list" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={tab.id || index}
            className={classNames('tw-tabs__tab', {
              'tw-tabs__tab--active': activeTab === tab.id,
            })}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && <span className="tw-tabs__icon">{tab.icon}</span>}
            <span className="tw-tabs__label">{tab.label}</span>
            {tab.badge && <span className="tw-tabs__badge">{tab.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

// Compound component pattern
PageLayout.Header = PageHeader;
PageLayout.Sidebar = Sidebar;
PageLayout.Content = PageContent;
PageLayout.Footer = PageFooter;