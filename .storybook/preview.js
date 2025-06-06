/**
 * Storybook Preview Configuration
 */

import React from 'react';
import { ThemeProvider } from '../src/web/ui-framework/design-system/theme';
import { ToastProvider } from '../src/web/ui-framework/notifications/Toast';
import { LoadingProvider } from '../src/web/ui-framework/integration/LoadingManager';
import '../src/web/ui-framework/design-system/styles.css';

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
  viewport: {
    viewports: {
      xs: { name: 'XS (Mobile)', styles: { width: '375px', height: '667px' } },
      sm: { name: 'SM', styles: { width: '640px', height: '800px' } },
      md: { name: 'MD (Tablet)', styles: { width: '768px', height: '1024px' } },
      lg: { name: 'LG', styles: { width: '1024px', height: '768px' } },
      xl: { name: 'XL (Desktop)', styles: { width: '1280px', height: '800px' } },
      '2xl': { name: '2XL', styles: { width: '1536px', height: '900px' } },
    },
  },
  docs: {
    toc: true,
  },
};

// Global decorators
export const decorators = [
  (Story, context) => {
    const theme = context.globals.theme || 'light';
    
    return (
      <ThemeProvider initialMode={theme}>
        <LoadingProvider>
          <ToastProvider>
            <div style={{ padding: '1rem' }}>
              <Story />
            </div>
          </ToastProvider>
        </LoadingProvider>
      </ThemeProvider>
    );
  },
];

// Global types for toolbar
export const globalTypes = {
  theme: {
    name: 'Theme',
    description: 'Global theme for components',
    defaultValue: 'light',
    toolbar: {
      icon: 'circlehollow',
      items: [
        { value: 'light', title: 'Light theme' },
        { value: 'dark', title: 'Dark theme' },
      ],
      showName: true,
    },
  },
};