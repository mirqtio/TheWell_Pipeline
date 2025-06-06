/**
 * useApi Hook Tests
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useApi, useMutation } from '../../../../src/web/ui-framework/hooks/useApi';
import { LoadingProvider } from '../../../../src/web/ui-framework/integration/LoadingManager';
import { apiClient } from '../../../../src/web/ui-framework/integration/ApiClient';

// Mock the API client
jest.mock('../../../../src/web/ui-framework/integration/ApiClient', () => ({
  apiClient: {
    request: jest.fn(),
  },
}));

// Wrapper component for providers
const wrapper = ({ children }) => (
  <LoadingProvider>{children}</LoadingProvider>
);

describe('useApi Hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('fetches data on mount when autoFetch is true', async () => {
      const mockData = { id: 1, name: 'Test' };
      apiClient.request.mockResolvedValueOnce({ data: mockData });

      const { result } = renderHook(
        () => useApi('/test', { autoFetch: true }),
        { wrapper }
      );

      expect(result.current.loading).toBe(true);
      expect(apiClient.request).toHaveBeenCalledWith('GET', '/test', expect.any(Object));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.data).toEqual(mockData);
        expect(result.current.error).toBe(null);
      });
    });

    it('does not fetch on mount when autoFetch is false', () => {
      renderHook(() => useApi('/test', { autoFetch: false }), { wrapper });

      expect(apiClient.request).not.toHaveBeenCalled();
    });

    it('handles fetch errors', async () => {
      const mockError = new Error('API Error');
      apiClient.request.mockRejectedValueOnce(mockError);

      const { result } = renderHook(() => useApi('/test'), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toEqual(mockError);
        expect(result.current.data).toBe(null);
      });
    });
  });

  describe('Refetch', () => {
    it('refetches data when called', async () => {
      const mockData1 = { id: 1, name: 'First' };
      const mockData2 = { id: 2, name: 'Second' };
      
      apiClient.request
        .mockResolvedValueOnce({ data: mockData1 })
        .mockResolvedValueOnce({ data: mockData2 });

      const { result } = renderHook(() => useApi('/test'), { wrapper });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData1);
      });

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.data).toEqual(mockData2);
      expect(apiClient.request).toHaveBeenCalledTimes(2);
    });

    it('accepts refetch options', async () => {
      apiClient.request.mockResolvedValueOnce({ data: {} });

      const { result } = renderHook(
        () => useApi('/test', { autoFetch: false }),
        { wrapper }
      );

      await act(async () => {
        await result.current.refetch({ params: { page: 2 } });
      });

      expect(apiClient.request).toHaveBeenCalledWith(
        'GET',
        '/test',
        expect.objectContaining({ params: { page: 2 } })
      );
    });
  });

  describe('Caching', () => {
    it('returns cached data when available', async () => {
      const mockData = { id: 1, cached: true };
      apiClient.request.mockResolvedValueOnce({ data: mockData });

      const { result: result1 } = renderHook(
        () => useApi('/test', { cacheKey: 'test-cache' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.data).toEqual(mockData);
      });

      // Second hook with same cache key
      const { result: result2 } = renderHook(
        () => useApi('/test', { cacheKey: 'test-cache' }),
        { wrapper }
      );

      // Should return cached data immediately without making another request
      expect(result2.current.data).toEqual(mockData);
      expect(apiClient.request).toHaveBeenCalledTimes(1);
    });

    it('clears cache when requested', async () => {
      const mockData = { id: 1 };
      apiClient.request.mockResolvedValue({ data: mockData });

      const { result } = renderHook(
        () => useApi('/test', { cacheKey: 'test-clear' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      act(() => {
        result.current.clearCache();
      });

      await act(async () => {
        await result.current.refetch();
      });

      expect(apiClient.request).toHaveBeenCalledTimes(2);
    });
  });

  describe('Callbacks', () => {
    it('calls onSuccess callback', async () => {
      const mockData = { success: true };
      const onSuccess = jest.fn();
      apiClient.request.mockResolvedValueOnce({ data: mockData });

      renderHook(
        () => useApi('/test', { onSuccess }),
        { wrapper }
      );

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(mockData);
      });
    });

    it('calls onError callback', async () => {
      const mockError = new Error('Failed');
      const onError = jest.fn();
      apiClient.request.mockRejectedValueOnce(mockError);

      renderHook(
        () => useApi('/test', { onError }),
        { wrapper }
      );

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(mockError);
      });
    });
  });
});

describe('useMutation Hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executes mutation function', async () => {
    const mockResult = { id: 1, created: true };
    const mutationFn = jest.fn().mockResolvedValue(mockResult);

    const { result } = renderHook(
      () => useMutation(mutationFn),
      { wrapper }
    );

    expect(result.current.loading).toBe(false);

    await act(async () => {
      const data = await result.current.mutate({ name: 'Test' });
      expect(data).toEqual(mockResult);
    });

    expect(mutationFn).toHaveBeenCalledWith({ name: 'Test' });
    expect(result.current.data).toEqual(mockResult);
    expect(result.current.loading).toBe(false);
  });

  it('handles mutation errors', async () => {
    const mockError = new Error('Mutation failed');
    const mutationFn = jest.fn().mockRejectedValue(mockError);
    const onError = jest.fn();

    const { result } = renderHook(
      () => useMutation(mutationFn, { onError }),
      { wrapper }
    );

    await act(async () => {
      try {
        await result.current.mutate({ bad: 'data' });
      } catch (error) {
        expect(error).toEqual(mockError);
      }
    });

    expect(result.current.error).toEqual(mockError);
    expect(onError).toHaveBeenCalledWith(mockError, { bad: 'data' });
  });

  it('resets mutation state', async () => {
    const mutationFn = jest.fn().mockResolvedValue({ done: true });

    const { result } = renderHook(
      () => useMutation(mutationFn),
      { wrapper }
    );

    await act(async () => {
      await result.current.mutate({});
    });

    expect(result.current.data).toEqual({ done: true });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe(null);
    expect(result.current.loading).toBe(false);
  });
});