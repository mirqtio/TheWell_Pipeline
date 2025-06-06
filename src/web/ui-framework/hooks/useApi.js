/**
 * useApi Hook
 * Custom hook for API calls with loading and error states
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient } from '../integration/ApiClient';
import { useLoading } from '../integration/LoadingManager';

export const useApi = (endpoint, options = {}) => {
  const {
    method = 'GET',
    params,
    data: initialData,
    headers,
    autoFetch = true,
    cacheKey,
    cacheTime = 5 * 60 * 1000, // 5 minutes
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { setLoading: setGlobalLoading } = useLoading();
  const abortControllerRef = useRef(null);
  const cacheRef = useRef({});

  // Check cache
  const getCachedData = useCallback(() => {
    if (!cacheKey) return null;
    
    const cached = cacheRef.current[cacheKey];
    if (cached && Date.now() - cached.timestamp < cacheTime) {
      return cached.data;
    }
    
    return null;
  }, [cacheKey, cacheTime]);

  // Set cache
  const setCachedData = useCallback((data) => {
    if (!cacheKey) return;
    
    cacheRef.current[cacheKey] = {
      data,
      timestamp: Date.now(),
    };
  }, [cacheKey]);

  // Fetch data
  const fetchData = useCallback(async (fetchOptions = {}) => {
    // Check cache first
    const cachedData = getCachedData();
    if (cachedData) {
      setData(cachedData);
      return cachedData;
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);
    
    if (options.useGlobalLoading) {
      setGlobalLoading(`api-${endpoint}`, true);
    }

    try {
      const response = await apiClient.request(method, endpoint, {
        params: fetchOptions.params || params,
        data: fetchOptions.data || initialData,
        headers: fetchOptions.headers || headers,
        signal: abortControllerRef.current.signal,
      });

      const responseData = response.data;
      setData(responseData);
      setCachedData(responseData);

      if (onSuccess) {
        onSuccess(responseData);
      }

      return responseData;
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err);
        
        if (onError) {
          onError(err);
        }
      }
      throw err;
    } finally {
      setLoading(false);
      
      if (options.useGlobalLoading) {
        setGlobalLoading(`api-${endpoint}`, false);
      }
    }
  }, [
    endpoint,
    method,
    params,
    initialData,
    headers,
    options.useGlobalLoading,
    getCachedData,
    setCachedData,
    setGlobalLoading,
    onSuccess,
    onError,
  ]);

  // Refetch data
  const refetch = useCallback((refetchOptions) => {
    return fetchData(refetchOptions);
  }, [fetchData]);

  // Clear cache
  const clearCache = useCallback(() => {
    if (cacheKey) {
      delete cacheRef.current[cacheKey];
    }
  }, [cacheKey]);

  // Auto fetch on mount
  useEffect(() => {
    if (autoFetch) {
      fetchData();
    }

    // Cleanup
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    data,
    error,
    loading,
    refetch,
    clearCache,
  };
};

// useMutation Hook
export const useMutation = (mutationFn, options = {}) => {
  const {
    onSuccess,
    onError,
    onSettled,
  } = options;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { setLoading: setGlobalLoading } = useLoading();

  const mutate = useCallback(async (variables) => {
    setLoading(true);
    setError(null);
    
    if (options.useGlobalLoading) {
      setGlobalLoading('mutation', true);
    }

    try {
      const result = await mutationFn(variables);
      setData(result);

      if (onSuccess) {
        onSuccess(result, variables);
      }

      return result;
    } catch (err) {
      setError(err);
      
      if (onError) {
        onError(err, variables);
      }
      
      throw err;
    } finally {
      setLoading(false);
      
      if (options.useGlobalLoading) {
        setGlobalLoading('mutation', false);
      }
      
      if (onSettled) {
        onSettled(data, error, variables);
      }
    }
  }, [mutationFn, options.useGlobalLoading, setGlobalLoading, onSuccess, onError, onSettled, data, error]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    mutate,
    data,
    error,
    loading,
    reset,
  };
};