/**
 * Media Query Hook
 * Responsive design utilities
 */

import { useState, useEffect } from 'react';
import { breakpoints } from '../design-system/tokens';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

// useMediaQuery - Generic media query hook
export const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => {
    if (!isBrowser) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (!isBrowser) return;

    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handleChange = (e) => {
      setMatches(e.matches);
    };

    // Use addEventListener for modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [query]);

  return matches;
};

// Predefined breakpoint hooks
export const useBreakpoint = () => {
  const isXs = useMediaQuery(`(min-width: ${breakpoints.xs})`);
  const isSm = useMediaQuery(`(min-width: ${breakpoints.sm})`);
  const isMd = useMediaQuery(`(min-width: ${breakpoints.md})`);
  const isLg = useMediaQuery(`(min-width: ${breakpoints.lg})`);
  const isXl = useMediaQuery(`(min-width: ${breakpoints.xl})`);
  const is2xl = useMediaQuery(`(min-width: ${breakpoints['2xl']})`);

  const current = is2xl ? '2xl' :
                 isXl ? 'xl' :
                 isLg ? 'lg' :
                 isMd ? 'md' :
                 isSm ? 'sm' : 'xs';

  return {
    current,
    isXs,
    isSm,
    isMd,
    isLg,
    isXl,
    is2xl,
    // Utility functions
    up: (breakpoint) => {
      const query = `(min-width: ${breakpoints[breakpoint]})`;
      return useMediaQuery(query);
    },
    down: (breakpoint) => {
      const query = `(max-width: ${breakpoints[breakpoint]})`;
      return useMediaQuery(query);
    },
    between: (min, max) => {
      const query = `(min-width: ${breakpoints[min]}) and (max-width: ${breakpoints[max]})`;
      return useMediaQuery(query);
    },
  };
};

// Device-specific hooks
export const useIsMobile = () => {
  return useMediaQuery(`(max-width: ${breakpoints.md})`);
};

export const useIsTablet = () => {
  return useMediaQuery(`(min-width: ${breakpoints.md}) and (max-width: ${breakpoints.lg})`);
};

export const useIsDesktop = () => {
  return useMediaQuery(`(min-width: ${breakpoints.lg})`);
};

// Orientation hooks
export const useIsPortrait = () => {
  return useMediaQuery('(orientation: portrait)');
};

export const useIsLandscape = () => {
  return useMediaQuery('(orientation: landscape)');
};

// Feature detection hooks
export const useIsTouchDevice = () => {
  return useMediaQuery('(hover: none) and (pointer: coarse)');
};

export const usePrefersDarkMode = () => {
  return useMediaQuery('(prefers-color-scheme: dark)');
};

export const usePrefersReducedMotion = () => {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
};