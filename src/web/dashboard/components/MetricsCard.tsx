import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  Skeleton,
  useTheme,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  TrendingFlat as TrendingFlatIcon,
} from '@mui/icons-material';
import { MetricCard as MetricCardType, MetricTrend } from '../types/dashboard';

interface MetricsCardProps extends MetricCardType {
  loading?: boolean;
  onClick?: () => void;
}

const getTrendIcon = (trend?: MetricTrend) => {
  switch (trend) {
    case 'increasing':
    case 'improving':
      return <TrendingUpIcon fontSize="small" />;
    case 'decreasing':
    case 'degrading':
      return <TrendingDownIcon fontSize="small" />;
    case 'stable':
    default:
      return <TrendingFlatIcon fontSize="small" />;
  }
};

const getTrendColor = (trend?: MetricTrend) => {
  switch (trend) {
    case 'improving':
      return 'success';
    case 'degrading':
      return 'error';
    case 'increasing':
      return 'warning';
    case 'decreasing':
      return 'info';
    case 'stable':
    default:
      return 'default';
  }
};

const MetricsCard: React.FC<MetricsCardProps> = ({
  title,
  value,
  unit,
  trend,
  trendValue,
  status,
  sparklineData,
  loading = false,
  onClick,
}) => {
  const theme = useTheme();

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Skeleton variant="text" width="60%" height={24} />
          <Skeleton variant="text" width="80%" height={48} sx={{ my: 1 }} />
          <Skeleton variant="rectangular" width="40%" height={24} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      sx={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        '&:hover': onClick ? {
          transform: 'translateY(-2px)',
          boxShadow: theme.shadows[4],
        } : {},
      }}
      onClick={onClick}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Typography color="text.secondary" variant="subtitle2">
            {title}
          </Typography>
          {status && (
            <Box
              className={`status-indicator status-${status}`}
              sx={{ mt: 0.5 }}
            />
          )}
        </Box>

        <Typography variant="h4" component="div" sx={{ mb: 1, fontWeight: 600 }}>
          {value}
          {unit && (
            <Typography
              component="span"
              variant="h6"
              color="text.secondary"
              sx={{ ml: 0.5, fontWeight: 400 }}
            >
              {unit}
            </Typography>
          )}
        </Typography>

        {(trend || trendValue !== undefined) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {trend && (
              <Chip
                icon={getTrendIcon(trend)}
                label={trend.charAt(0).toUpperCase() + trend.slice(1)}
                size="small"
                color={getTrendColor(trend)}
                sx={{ fontWeight: 500 }}
              />
            )}
            {trendValue !== undefined && (
              <Typography variant="caption" color="text.secondary">
                {trendValue > 0 ? '+' : ''}{trendValue}%
              </Typography>
            )}
          </Box>
        )}

        {sparklineData && sparklineData.length > 0 && (
          <Box sx={{ mt: 2, height: 40 }}>
            {/* Sparkline chart would go here */}
            <Box
              sx={{
                height: '100%',
                background: `linear-gradient(to right, ${theme.palette.primary.light}20, ${theme.palette.primary.main}40)`,
                borderRadius: 1,
                opacity: 0.5,
              }}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default MetricsCard;