import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  Box,
  Chip,
  IconButton,
  Skeleton,
  Divider,
} from '@mui/material';
import {
  Info as InfoIcon,
  CheckCircle as SuccessIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  MoreVert as MoreIcon,
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import { ActivityItem } from '../types/dashboard';

interface ActivityFeedProps {
  title?: string;
  activities: ActivityItem[];
  loading?: boolean;
  maxItems?: number;
  onRefresh?: () => void;
  onItemClick?: (activity: ActivityItem) => void;
}

const getActivityIcon = (type: ActivityItem['type']) => {
  switch (type) {
    case 'info':
      return <InfoIcon />;
    case 'success':
      return <SuccessIcon />;
    case 'warning':
      return <WarningIcon />;
    case 'error':
      return <ErrorIcon />;
    default:
      return <InfoIcon />;
  }
};

const getActivityColor = (type: ActivityItem['type']) => {
  switch (type) {
    case 'info':
      return 'info';
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
};

const ActivityFeed: React.FC<ActivityFeedProps> = ({
  title = 'Recent Activity',
  activities,
  loading = false,
  maxItems = 10,
  onRefresh,
  onItemClick,
}) => {
  const displayedActivities = activities.slice(0, maxItems);

  const renderSkeleton = () => (
    <>
      {[...Array(5)].map((_, index) => (
        <React.Fragment key={index}>
          <ListItem alignItems="flex-start">
            <ListItemAvatar>
              <Skeleton variant="circular" width={40} height={40} />
            </ListItemAvatar>
            <ListItemText
              primary={<Skeleton variant="text" width="80%" />}
              secondary={
                <>
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="40%" />
                </>
              }
            />
          </ListItem>
          {index < 4 && <Divider variant="inset" component="li" />}
        </React.Fragment>
      ))}
    </>
  );

  const renderActivity = (activity: ActivityItem, index: number) => (
    <React.Fragment key={activity.id}>
      <ListItem
        alignItems="flex-start"
        onClick={() => onItemClick?.(activity)}
        sx={{
          cursor: onItemClick ? 'pointer' : 'default',
          '&:hover': onItemClick ? {
            backgroundColor: 'action.hover',
          } : {},
        }}
      >
        <ListItemAvatar>
          <Avatar
            sx={{
              bgcolor: `${getActivityColor(activity.type)}.light`,
              color: `${getActivityColor(activity.type)}.main`,
            }}
          >
            {getActivityIcon(activity.type)}
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle2" component="span">
                {activity.title}
              </Typography>
              {activity.source && (
                <Chip
                  label={activity.source}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem', height: 20 }}
                />
              )}
            </Box>
          }
          secondary={
            <>
              <Typography
                component="span"
                variant="body2"
                color="text.primary"
                sx={{ display: 'block', mt: 0.5 }}
              >
                {activity.message}
              </Typography>
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5 }}
              >
                {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
              </Typography>
            </>
          }
        />
      </ListItem>
      {index < displayedActivities.length - 1 && (
        <Divider variant="inset" component="li" />
      )}
    </React.Fragment>
  );

  return (
    <Card>
      <CardHeader
        title={title}
        action={
          <Box>
            {onRefresh && (
              <IconButton onClick={onRefresh} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            )}
            <IconButton>
              <MoreIcon />
            </IconButton>
          </Box>
        }
      />
      <CardContent sx={{ p: 0 }}>
        <List sx={{ width: '100%', bgcolor: 'background.paper', p: 0 }}>
          {loading ? (
            renderSkeleton()
          ) : displayedActivities.length > 0 ? (
            displayedActivities.map((activity, index) => 
              renderActivity(activity, index)
            )
          ) : (
            <ListItem>
              <ListItemText
                primary={
                  <Typography variant="body2" color="text.secondary" align="center">
                    No recent activity
                  </Typography>
                }
              />
            </ListItem>
          )}
        </List>
        
        {!loading && activities.length > maxItems && (
          <Box sx={{ p: 2, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
            <Typography
              variant="body2"
              color="primary"
              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              View all {activities.length} activities
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default ActivityFeed;