import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Box,
  Paper,
  TextField,
  InputAdornment,
  IconButton,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
  TrendingUp as TrendingIcon,
  OpenInNew as OpenIcon,
} from '@mui/icons-material';
import { RootState, AppDispatch } from '../store';
import {
  performSearch,
  setQuery,
  clearSearch,
  fetchPopularSearches,
  fetchSearchAnalytics,
} from '../store/searchSlice';
import ChartWidget from '../components/ChartWidget';
import MetricsCard from '../components/MetricsCard';

const SearchPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const {
    query,
    results,
    loading,
    error,
    totalResults,
    searchTime,
    analytics,
  } = useSelector((state: RootState) => state.search);

  const [localQuery, setLocalQuery] = useState(query);

  useEffect(() => {
    dispatch(fetchPopularSearches());
    dispatch(fetchSearchAnalytics('7d'));
  }, [dispatch]);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (localQuery.trim()) {
      dispatch(setQuery(localQuery));
      dispatch(performSearch({ query: localQuery }));
    }
  };

  const handleClear = () => {
    setLocalQuery('');
    dispatch(clearSearch());
  };

  const handlePopularSearch = (searchTerm: string) => {
    setLocalQuery(searchTerm);
    dispatch(setQuery(searchTerm));
    dispatch(performSearch({ query: searchTerm }));
  };

  const searchTrendsData = [
    { name: 'Mon', searches: 245 },
    { name: 'Tue', searches: 312 },
    { name: 'Wed', searches: 287 },
    { name: 'Thu', searches: 385 },
    { name: 'Fri', searches: 428 },
    { name: 'Sat', searches: 198 },
    { name: 'Sun', searches: 167 },
  ];

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Search Analytics
      </Typography>

      {/* Search Metrics */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Total Searches Today"
            value={428}
            trend="increasing"
            trendValue={12.5}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Avg Response Time"
            value="145ms"
            trend="improving"
            trendValue={-8.2}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Search Success Rate"
            value="94.2%"
            trend="stable"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MetricsCard
            title="Unique Queries"
            value={167}
            trend="increasing"
            trendValue={5.7}
          />
        </Grid>
      </Grid>

      {/* Search Box */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <form onSubmit={handleSearch}>
          <TextField
            fullWidth
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Search documents, topics, or keywords..."
            variant="outlined"
            size="medium"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  {localQuery && (
                    <IconButton onClick={handleClear} edge="end">
                      <ClearIcon />
                    </IconButton>
                  )}
                  <Button
                    variant="contained"
                    onClick={() => handleSearch()}
                    sx={{ ml: 1 }}
                    disabled={!localQuery.trim() || loading}
                  >
                    Search
                  </Button>
                </InputAdornment>
              ),
            }}
          />
        </form>

        {/* Search Results Info */}
        {results.length > 0 && (
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Found {totalResults} results in {searchTime}ms
            </Typography>
            <Button size="small">Export Results</Button>
          </Box>
        )}
      </Paper>

      <Grid container spacing={3}>
        {/* Search Results */}
        <Grid item xs={12} md={8}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : results.length > 0 ? (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Search Results
              </Typography>
              {results.map((result, index) => (
                <React.Fragment key={result.id}>
                  <Card sx={{ mb: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                        <Typography variant="h6" color="primary">
                          {result.title}
                        </Typography>
                        <Chip
                          label={`Score: ${(result.score * 100).toFixed(1)}%`}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Source: {result.source}
                      </Typography>
                      <Typography variant="body2" paragraph>
                        {result.content.substring(0, 200)}...
                      </Typography>
                      {result.highlights.length > 0 && (
                        <Box sx={{ mb: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            Highlights:
                          </Typography>
                          {result.highlights.map((highlight, idx) => (
                            <Typography
                              key={idx}
                              variant="body2"
                              sx={{ 
                                bgcolor: 'warning.light',
                                p: 0.5,
                                my: 0.5,
                                borderRadius: 1,
                              }}
                              dangerouslySetInnerHTML={{ __html: highlight }}
                            />
                          ))}
                        </Box>
                      )}
                    </CardContent>
                    <CardActions>
                      <Button size="small" startIcon={<OpenIcon />}>
                        View Document
                      </Button>
                    </CardActions>
                  </Card>
                  {index < results.length - 1 && <Divider sx={{ my: 2 }} />}
                </React.Fragment>
              ))}
            </Paper>
          ) : query && !loading ? (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="h6" color="text.secondary">
                No results found for "{query}"
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Try adjusting your search terms or filters
              </Typography>
            </Paper>
          ) : (
            <ChartWidget
              title="Search Volume Trends"
              subtitle="Searches per day over the last week"
              type="line"
              data={searchTrendsData}
              dataKey="searches"
              height={400}
            />
          )}
        </Grid>

        {/* Popular Searches & Analytics */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <TrendingIcon color="action" sx={{ mr: 1 }} />
              <Typography variant="h6">Popular Searches</Typography>
            </Box>
            <List>
              {analytics.popularSearches.slice(0, 10).map((search, index) => (
                <ListItem
                  key={index}
                  button
                  onClick={() => handlePopularSearch(search)}
                >
                  <ListItemText
                    primary={search}
                    secondary={`${Math.floor(Math.random() * 100 + 20)} searches`}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Search Categories
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {['Documentation', 'API', 'Tutorials', 'FAQ', 'Troubleshooting', 'Best Practices'].map((category) => (
                <Chip
                  key={category}
                  label={category}
                  onClick={() => handlePopularSearch(category)}
                  clickable
                />
              ))}
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          Error: {error}
        </Typography>
      )}
    </Box>
  );
};

export default SearchPage;