import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  IconButton,
  Collapse,
  Grid,
  TextField,
  MenuItem,
  Chip,
  FormControl,
  InputLabel,
  Select,
  SelectChangeEvent,
  Autocomplete,
} from '@mui/material';
import {
  FilterList as FilterIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimeRange } from '../types/dashboard';

interface FilterOption {
  label: string;
  value: string;
}

interface FilterPanelProps {
  onFilterChange: (filters: FilterValues) => void;
  timeRangeOptions?: TimeRange[];
  customFilters?: CustomFilter[];
  defaultExpanded?: boolean;
  showDateRange?: boolean;
  showTimeRange?: boolean;
  showSearch?: boolean;
}

interface FilterValues {
  timeRange?: TimeRange;
  dateRange?: {
    start: Date | null;
    end: Date | null;
  };
  search?: string;
  [key: string]: any;
}

interface CustomFilter {
  name: string;
  label: string;
  type: 'select' | 'multiselect' | 'text' | 'number';
  options?: FilterOption[];
  placeholder?: string;
}

const defaultTimeRanges: TimeRange[] = ['1h', '6h', '24h', '7d', '30d'];

const FilterPanel: React.FC<FilterPanelProps> = ({
  onFilterChange,
  timeRangeOptions = defaultTimeRanges,
  customFilters = [],
  defaultExpanded = true,
  showDateRange = false,
  showTimeRange = true,
  showSearch = true,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [filters, setFilters] = useState<FilterValues>({
    timeRange: '24h',
    dateRange: {
      start: null,
      end: null,
    },
    search: '',
  });

  const handleFilterChange = (name: string, value: any) => {
    const newFilters = { ...filters, [name]: value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleTimeRangeChange = (event: SelectChangeEvent) => {
    handleFilterChange('timeRange', event.target.value as TimeRange);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFilterChange('search', event.target.value);
  };

  const handleDateChange = (field: 'start' | 'end', value: Date | null) => {
    handleFilterChange('dateRange', {
      ...filters.dateRange,
      [field]: value,
    });
  };

  const handleClearFilters = () => {
    const clearedFilters: FilterValues = {
      timeRange: '24h',
      dateRange: { start: null, end: null },
      search: '',
    };
    customFilters.forEach(filter => {
      clearedFilters[filter.name] = filter.type === 'multiselect' ? [] : '';
    });
    setFilters(clearedFilters);
    onFilterChange(clearedFilters);
  };

  const activeFiltersCount = Object.entries(filters).filter(([key, value]) => {
    if (key === 'timeRange') return value !== '24h';
    if (key === 'dateRange') return value.start || value.end;
    if (key === 'search') return value;
    if (Array.isArray(value)) return value.length > 0;
    return value;
  }).length;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: expanded ? 2 : 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FilterIcon color="action" />
            <Typography variant="h6">Filters</Typography>
            {activeFiltersCount > 0 && (
              <Chip
                label={`${activeFiltersCount} active`}
                size="small"
                color="primary"
                variant="outlined"
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {activeFiltersCount > 0 && (
              <Button
                size="small"
                startIcon={<ClearIcon />}
                onClick={handleClearFilters}
              >
                Clear All
              </Button>
            )}
            <IconButton onClick={() => setExpanded(!expanded)} size="small">
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
        </Box>

        <Collapse in={expanded}>
          <Grid container spacing={2}>
            {showSearch && (
              <Grid item xs={12} md={6} lg={4}>
                <TextField
                  fullWidth
                  label="Search"
                  placeholder="Search..."
                  value={filters.search}
                  onChange={handleSearchChange}
                  variant="outlined"
                  size="small"
                />
              </Grid>
            )}

            {showTimeRange && (
              <Grid item xs={12} md={6} lg={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Time Range</InputLabel>
                  <Select
                    value={filters.timeRange}
                    label="Time Range"
                    onChange={handleTimeRangeChange}
                  >
                    {timeRangeOptions.map(range => (
                      <MenuItem key={range} value={range}>
                        {range === '1h' && 'Last Hour'}
                        {range === '6h' && 'Last 6 Hours'}
                        {range === '24h' && 'Last 24 Hours'}
                        {range === '7d' && 'Last 7 Days'}
                        {range === '30d' && 'Last 30 Days'}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}

            {showDateRange && (
              <>
                <Grid item xs={12} md={6} lg={4}>
                  <DatePicker
                    label="Start Date"
                    value={filters.dateRange?.start}
                    onChange={(value) => handleDateChange('start', value)}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        size: 'small',
                      },
                    }}
                  />
                </Grid>
                <Grid item xs={12} md={6} lg={4}>
                  <DatePicker
                    label="End Date"
                    value={filters.dateRange?.end}
                    onChange={(value) => handleDateChange('end', value)}
                    minDate={filters.dateRange?.start || undefined}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        size: 'small',
                      },
                    }}
                  />
                </Grid>
              </>
            )}

            {customFilters.map(filter => (
              <Grid item xs={12} md={6} lg={4} key={filter.name}>
                {filter.type === 'select' && (
                  <FormControl fullWidth size="small">
                    <InputLabel>{filter.label}</InputLabel>
                    <Select
                      value={filters[filter.name] || ''}
                      label={filter.label}
                      onChange={(e) => handleFilterChange(filter.name, e.target.value)}
                    >
                      <MenuItem value="">
                        <em>All</em>
                      </MenuItem>
                      {filter.options?.map(option => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                {filter.type === 'multiselect' && (
                  <Autocomplete
                    multiple
                    options={filter.options || []}
                    getOptionLabel={(option) => option.label}
                    value={filters[filter.name] || []}
                    onChange={(_, value) => handleFilterChange(filter.name, value)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={filter.label}
                        placeholder={filter.placeholder}
                        size="small"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          variant="outlined"
                          label={option.label}
                          size="small"
                          {...getTagProps({ index })}
                        />
                      ))
                    }
                  />
                )}

                {(filter.type === 'text' || filter.type === 'number') && (
                  <TextField
                    fullWidth
                    type={filter.type}
                    label={filter.label}
                    placeholder={filter.placeholder}
                    value={filters[filter.name] || ''}
                    onChange={(e) => handleFilterChange(filter.name, e.target.value)}
                    variant="outlined"
                    size="small"
                  />
                )}
              </Grid>
            ))}
          </Grid>
        </Collapse>
      </CardContent>
    </Card>
  );
};

export default FilterPanel;