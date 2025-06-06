import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Menu,
  MenuItem,
  Box,
  Skeleton,
} from '@mui/material';
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useTheme } from '@mui/material/styles';

export type ChartType = 'line' | 'bar' | 'pie' | 'area';

interface ChartWidgetProps {
  title: string;
  subtitle?: string;
  type: ChartType;
  data: any[];
  dataKey?: string;
  xAxisKey?: string;
  height?: number;
  loading?: boolean;
  colors?: string[];
  onExport?: () => void;
  onFullscreen?: () => void;
}

const COLORS = ['#3498db', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6', '#1abc9c'];

const ChartWidget: React.FC<ChartWidgetProps> = ({
  title,
  subtitle,
  type,
  data,
  dataKey = 'value',
  xAxisKey = 'name',
  height = 300,
  loading = false,
  colors = COLORS,
  onExport,
  onFullscreen,
}) => {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleExport = () => {
    handleMenuClose();
    onExport?.();
  };

  const handleFullscreen = () => {
    handleMenuClose();
    onFullscreen?.();
  };

  const renderChart = () => {
    if (loading) {
      return <Skeleton variant="rectangular" height={height} />;
    }

    const commonProps = {
      data,
      margin: { top: 5, right: 30, left: 20, bottom: 5 },
    };

    switch (type) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis 
                dataKey={xAxisKey} 
                stroke={theme.palette.text.secondary}
                style={{ fontSize: 12 }}
              />
              <YAxis 
                stroke={theme.palette.text.secondary}
                style={{ fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={colors[0]}
                strokeWidth={2}
                dot={{ fill: colors[0], r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        );

      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis 
                dataKey={xAxisKey} 
                stroke={theme.palette.text.secondary}
                style={{ fontSize: 12 }}
              />
              <YAxis 
                stroke={theme.palette.text.secondary}
                style={{ fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                }}
              />
              <Legend />
              <Bar dataKey={dataKey} fill={colors[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.name}: ${entry.value}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey={dataKey}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis 
                dataKey={xAxisKey} 
                stroke={theme.palette.text.secondary}
                style={{ fontSize: 12 }}
              />
              <YAxis 
                stroke={theme.palette.text.secondary}
                style={{ fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={colors[0]}
                fill={colors[0]}
                fillOpacity={0.6}
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader
        title={title}
        subheader={subtitle}
        action={
          (onExport || onFullscreen) && (
            <>
              <IconButton onClick={handleMenuOpen}>
                <MoreVertIcon />
              </IconButton>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleMenuClose}
              >
                {onFullscreen && (
                  <MenuItem onClick={handleFullscreen}>
                    View Fullscreen
                  </MenuItem>
                )}
                {onExport && (
                  <MenuItem onClick={handleExport}>
                    Export Chart
                  </MenuItem>
                )}
              </Menu>
            </>
          )
        }
      />
      <CardContent>
        <Box className="chart-container" sx={{ width: '100%', height }}>
          {renderChart()}
        </Box>
      </CardContent>
    </Card>
  );
};

export default ChartWidget;