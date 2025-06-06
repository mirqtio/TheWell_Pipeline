import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

class ApiClient {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor
    this.instance.interceptors.request.use(
      (config) => {
        // Add auth token if available
        const token = localStorage.getItem('authToken');
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.instance.interceptors.response.use(
      (response) => {
        return response;
      },
      (error) => {
        if (error.response?.status === 401) {
          // Handle unauthorized access
          localStorage.removeItem('authToken');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Generic request methods
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.instance.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.instance.post<T>(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.instance.put<T>(url, data, config);
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.instance.delete<T>(url, config);
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.instance.patch<T>(url, data, config);
  }
}

export const api = new ApiClient();

// Dashboard API endpoints
export const dashboardApi = {
  getOverview: (timeRange?: string) => 
    api.get('/dashboard/overview', { params: { timeRange } }),
  
  getCostMetrics: (timeRange: string, granularity: string) =>
    api.get('/dashboard/cost', { params: { timeRange, granularity } }),
  
  getQualityMetrics: (timeRange: string, granularity: string) =>
    api.get('/dashboard/quality', { params: { timeRange, granularity } }),
  
  getOperationalMetrics: () =>
    api.get('/dashboard/operational'),
  
  getRealtimeMetrics: (metrics?: string) =>
    api.get('/dashboard/realtime', { params: { metrics } }),
};

// Documents API endpoints
export const documentsApi = {
  getDocuments: (params?: any) =>
    api.get('/documents', { params }),
  
  getDocument: (id: string) =>
    api.get(`/documents/${id}`),
  
  createDocument: (data: any) =>
    api.post('/documents', data),
  
  updateDocument: (id: string, data: any) =>
    api.put(`/documents/${id}`, data),
  
  deleteDocument: (id: string) =>
    api.delete(`/documents/${id}`),
};

// Search API endpoints
export const searchApi = {
  search: (query: string, filters?: any) =>
    api.post('/search', { query, filters }),
  
  getSearchAnalytics: (timeRange: string) =>
    api.get('/search/analytics', { params: { timeRange } }),
  
  getPopularSearches: () =>
    api.get('/search/popular'),
};

// Alerts API endpoints
export const alertsApi = {
  getAlerts: (params?: any) =>
    api.get('/alerts', { params }),
  
  getAlert: (id: string) =>
    api.get(`/alerts/${id}`),
  
  acknowledgeAlert: (id: string) =>
    api.put(`/alerts/${id}/acknowledge`),
  
  dismissAlert: (id: string) =>
    api.put(`/alerts/${id}/dismiss`),
  
  createAlertRule: (data: any) =>
    api.post('/alerts/rules', data),
};

// Reports API endpoints
export const reportsApi = {
  getReports: (params?: any) =>
    api.get('/reports', { params }),
  
  getReport: (id: string) =>
    api.get(`/reports/${id}`),
  
  generateReport: (data: any) =>
    api.post('/reports/generate', data),
  
  scheduleReport: (data: any) =>
    api.post('/reports/schedule', data),
  
  downloadReport: (id: string, format: string) =>
    api.get(`/reports/${id}/download`, { 
      params: { format },
      responseType: 'blob'
    }),
};