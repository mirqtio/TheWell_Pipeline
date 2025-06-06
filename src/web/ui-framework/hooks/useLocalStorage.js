/**
 * Local Storage Hook
 * Sync state with localStorage with SSR support
 */

import { useState, useEffect, useCallback } from 'react';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined' && window.localStorage;

// Parse stored value
const parseStoredValue = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const useLocalStorage = (key, initialValue) => {
  // Get initial value
  const getInitialValue = () => {
    if (!isBrowser) {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item !== null ? parseStoredValue(item) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  };

  // State to store our value
  const [storedValue, setStoredValue] = useState(getInitialValue);

  // Return a wrapped version of useState's setter function
  const setValue = useCallback((value) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      
      // Save state
      setStoredValue(valueToStore);
      
      // Save to local storage
      if (isBrowser) {
        if (valueToStore === undefined) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
        
        // Dispatch storage event for other tabs
        window.dispatchEvent(new StorageEvent('storage', {
          key,
          newValue: JSON.stringify(valueToStore),
          url: window.location.href,
          storageArea: window.localStorage,
        }));
      }
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  // Remove value from storage
  const removeValue = useCallback(() => {
    setValue(undefined);
  }, [setValue]);

  // Listen for changes in other tabs/windows
  useEffect(() => {
    if (!isBrowser) return;

    const handleStorageChange = (e) => {
      if (e.key === key && e.newValue !== null) {
        setStoredValue(parseStoredValue(e.newValue));
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [storedValue, setValue, removeValue];
};

// useSessionStorage - Similar to useLocalStorage but uses sessionStorage
export const useSessionStorage = (key, initialValue) => {
  // Get initial value
  const getInitialValue = () => {
    if (!isBrowser) {
      return initialValue;
    }

    try {
      const item = window.sessionStorage.getItem(key);
      return item !== null ? parseStoredValue(item) : initialValue;
    } catch (error) {
      console.error(`Error reading sessionStorage key "${key}":`, error);
      return initialValue;
    }
  };

  // State to store our value
  const [storedValue, setStoredValue] = useState(getInitialValue);

  // Return a wrapped version of useState's setter function
  const setValue = useCallback((value) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      
      // Save state
      setStoredValue(valueToStore);
      
      // Save to session storage
      if (isBrowser) {
        if (valueToStore === undefined) {
          window.sessionStorage.removeItem(key);
        } else {
          window.sessionStorage.setItem(key, JSON.stringify(valueToStore));
        }
      }
    } catch (error) {
      console.error(`Error setting sessionStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  // Remove value from storage
  const removeValue = useCallback(() => {
    setValue(undefined);
  }, [setValue]);

  return [storedValue, setValue, removeValue];
};