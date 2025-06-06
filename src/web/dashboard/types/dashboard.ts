export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';

export type MetricTrend = 'increasing' | 'decreasing' | 'stable' | 'improving' | 'degrading';

export type SystemStatus = 'healthy' | 'warning' | 'error' | 'critical';

export interface CostMetrics {
  dailySpending: number;
  monthlySpending: number;
  budgetUtilization: number;
  trend: MetricTrend;
  breakdown?: {
    provider: string;
    cost: number;
    percentage: number;
  }[];
}

export interface QualityMetrics {
  overallHealth: number;
  errorRate: number;
  avgResponseTime: number;
  trend: MetricTrend;
  sloCompliance?: {
    availability: number;
    latency: number;
    errorBudget: number;
  };
}

export interface OperationalMetrics {
  uptime: number;
  systemHealth: SystemStatus;
  throughput: number;
  activeConnections: number;
  resourceUsage?: {
    cpu: number;
    memory: number;
    disk: number;
  };
}

export interface DashboardData {
  status: SystemStatus;
  lastUpdated: string;
  summary: {
    cost: CostMetrics;
    quality: QualityMetrics;
    operational: OperationalMetrics;
  };
}

export interface ChartDataPoint {
  timestamp: string;
  value: number;
  label?: string;
}

export interface ChartData {
  data: ChartDataPoint[];
  metadata: {
    timeRange: TimeRange;
    granularity: string;
    lastUpdated: string;
    dataPoints: number;
  };
}

export interface MetricCard {
  title: string;
  value: number | string;
  unit?: string;
  trend?: MetricTrend;
  trendValue?: number;
  status?: SystemStatus;
  sparklineData?: number[];
}

export interface ActivityItem {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  source?: string;
  metadata?: Record<string, any>;
}