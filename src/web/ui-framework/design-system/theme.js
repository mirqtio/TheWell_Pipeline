/**
 * Theme Management System
 * Provides theme context and utilities for TheWell UI Framework
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { tokens } from './tokens';

// Theme modes
export const THEME_MODES = {
  LIGHT: 'light',
  DARK: 'dark',
  AUTO: 'auto',
};

// Default theme
const defaultTheme = {
  mode: THEME_MODES.LIGHT,
  tokens,
  // Add computed values based on mode
  colors: {
    ...tokens.colors,
    // Semantic colors that change based on theme
    background: {
      primary: tokens.colors.neutral[0],
      secondary: tokens.colors.neutral[50],
      tertiary: tokens.colors.neutral[100],
    },
    text: {
      primary: tokens.colors.neutral[900],
      secondary: tokens.colors.neutral[700],
      tertiary: tokens.colors.neutral[600],
      disabled: tokens.colors.neutral[400],
    },
    border: {
      light: tokens.colors.neutral[200],
      base: tokens.colors.neutral[300],
      dark: tokens.colors.neutral[400],
    },
  },
};

// Dark theme overrides
const darkThemeColors = {
  background: {
    primary: tokens.colors.neutral[900],
    secondary: tokens.colors.neutral[800],
    tertiary: tokens.colors.neutral[700],
  },
  text: {
    primary: tokens.colors.neutral[0],
    secondary: tokens.colors.neutral[200],
    tertiary: tokens.colors.neutral[300],
    disabled: tokens.colors.neutral[600],
  },
  border: {
    light: tokens.colors.neutral[700],
    base: tokens.colors.neutral[600],
    dark: tokens.colors.neutral[500],
  },
};

// Theme Context
const ThemeContext = createContext(defaultTheme);

// Theme Provider Component
export function ThemeProvider({ children, initialMode = THEME_MODES.LIGHT }) {
  const [mode, setMode] = useState(initialMode);
  const [theme, setTheme] = useState(defaultTheme);

  // Update theme based on mode
  useEffect(() => {
    const newTheme = {
      ...defaultTheme,
      mode,
      colors: {
        ...defaultTheme.colors,
        ...(mode === THEME_MODES.DARK ? darkThemeColors : {}),
      },
    };
    setTheme(newTheme);

    // Apply theme class to document root
    document.documentElement.classList.remove('light-theme', 'dark-theme');
    document.documentElement.classList.add(`${mode}-theme`);
  }, [mode]);

  // Handle auto mode (system preference)
  useEffect(() => {
    if (mode === THEME_MODES.AUTO) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e) => {
        const systemMode = e.matches ? THEME_MODES.DARK : THEME_MODES.LIGHT;
        setMode(systemMode);
      };
      
      // Set initial system preference
      handleChange(mediaQuery);
      
      // Listen for changes
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [mode]);

  const value = {
    ...theme,
    setMode,
    toggleMode: () => {
      setMode(current => 
        current === THEME_MODES.LIGHT ? THEME_MODES.DARK : THEME_MODES.LIGHT
      );
    },
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// Hook to use theme
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

// CSS variable generator
export function generateCSSVariables(theme) {
  const cssVars = {};
  
  // Colors
  Object.entries(theme.colors).forEach(([key, value]) => {
    if (typeof value === 'object') {
      Object.entries(value).forEach(([shade, color]) => {
        cssVars[`--color-${key}-${shade}`] = color;
      });
    } else {
      cssVars[`--color-${key}`] = value;
    }
  });
  
  // Typography
  Object.entries(theme.tokens.typography.fontSize).forEach(([key, value]) => {
    cssVars[`--font-size-${key}`] = value;
  });
  
  Object.entries(theme.tokens.typography.fontWeight).forEach(([key, value]) => {
    cssVars[`--font-weight-${key}`] = value;
  });
  
  // Spacing
  Object.entries(theme.tokens.spacing).forEach(([key, value]) => {
    cssVars[`--spacing-${key}`] = value;
  });
  
  // Border radius
  Object.entries(theme.tokens.borderRadius).forEach(([key, value]) => {
    cssVars[`--radius-${key}`] = value;
  });
  
  // Shadows
  Object.entries(theme.tokens.shadows).forEach(([key, value]) => {
    cssVars[`--shadow-${key}`] = value;
  });
  
  return cssVars;
}

// Theme utilities
export const themeUtils = {
  // Get color with opacity
  alpha: (color, opacity) => {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  },
  
  // Get responsive value
  responsive: (values, breakpoint) => {
    if (typeof values === 'string' || typeof values === 'number') {
      return values;
    }
    return values[breakpoint] || values.base || values;
  },
  
  // Generate class names based on theme
  cx: (...classes) => classes.filter(Boolean).join(' '),
};