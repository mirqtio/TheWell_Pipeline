# TheWell Pipeline Dashboard

A modern React-based monitoring and analytics dashboard for TheWell Pipeline system.

## Features

- **Real-time Monitoring**: Live updates via WebSocket connection
- **Comprehensive Analytics**: Cost, quality, and operational metrics
- **Document Management**: Browse, search, and manage documents
- **Alert System**: Real-time alerts with severity levels and acknowledgment
- **Report Generation**: Create and schedule various report types
- **Search Analytics**: Track search patterns and popular queries
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile

## Technology Stack

- **React 18** with TypeScript for type safety
- **Material-UI (MUI)** for modern UI components
- **Redux Toolkit** for state management
- **React Router** for navigation
- **Recharts** for data visualization
- **Socket.io** for real-time updates
- **Webpack** for bundling and development

## Getting Started

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dashboard:dev

# The dashboard will be available at http://localhost:3001/dashboard
```

### Production Build

```bash
# Build for production
npm run dashboard:build

# Output will be in dist/dashboard/
```

### Testing

```bash
# Run all dashboard tests
npm run dashboard:test

# Run tests in watch mode
npm run dashboard:test:watch

# Run E2E tests (requires dashboard to be running)
npm run test:ui
```

## Project Structure

```
src/web/dashboard/
├── components/          # Reusable UI components
│   ├── layout/         # Layout components (DashboardLayout)
│   ├── ActivityFeed.tsx
│   ├── ChartWidget.tsx
│   ├── DataTable.tsx
│   ├── FilterPanel.tsx
│   └── MetricsCard.tsx
├── pages/              # Page components
│   ├── OverviewPage.tsx
│   ├── DocumentsPage.tsx
│   ├── SearchPage.tsx
│   ├── AlertsPage.tsx
│   └── ReportsPage.tsx
├── store/              # Redux store and slices
│   ├── index.ts
│   ├── dashboardSlice.ts
│   ├── documentsSlice.ts
│   ├── searchSlice.ts
│   ├── alertsSlice.ts
│   ├── reportsSlice.ts
│   └── websocketSlice.ts
├── api/                # API client and endpoints
│   └── client.ts
├── types/              # TypeScript type definitions
│   └── dashboard.ts
├── styles/             # Global styles
│   └── global.css
├── App.tsx             # Main app component
├── index.tsx           # Entry point
└── theme.ts            # MUI theme configuration
```

## Key Components

### MetricsCard
Displays key metrics with trends and status indicators.

```tsx
<MetricsCard
  title="Daily Cost"
  value={24.67}
  unit="USD"
  trend="stable"
  trendValue={2.5}
  status="healthy"
/>
```

### ChartWidget
Flexible chart component supporting line, bar, pie, and area charts.

```tsx
<ChartWidget
  title="Cost Trend"
  type="line"
  data={chartData}
  dataKey="value"
  height={300}
/>
```

### DataTable
Feature-rich data grid with sorting, filtering, and pagination.

```tsx
<DataTable
  title="Documents"
  data={documents}
  columns={columns}
  onView={handleView}
  onEdit={handleEdit}
  onDelete={handleDelete}
/>
```

### ActivityFeed
Real-time activity stream with type-based styling.

```tsx
<ActivityFeed
  activities={activities}
  onRefresh={handleRefresh}
  maxItems={10}
/>
```

### FilterPanel
Flexible filtering interface with various input types.

```tsx
<FilterPanel
  onFilterChange={handleFilterChange}
  showTimeRange
  showDateRange
  customFilters={customFilters}
/>
```

## State Management

The dashboard uses Redux Toolkit for state management with the following slices:

- **dashboardSlice**: Overview metrics and settings
- **documentsSlice**: Document list and operations
- **searchSlice**: Search results and analytics
- **alertsSlice**: Alerts and notification management
- **reportsSlice**: Report generation and scheduling
- **websocketSlice**: Real-time connection management

## API Integration

All API calls are centralized in `api/client.ts` with dedicated endpoints:

- `dashboardApi`: Dashboard metrics and overview
- `documentsApi`: Document CRUD operations
- `searchApi`: Search and analytics
- `alertsApi`: Alert management
- `reportsApi`: Report generation and downloads

## Real-time Updates

The dashboard connects to the backend via WebSocket for real-time updates:

- Metric updates
- New alerts
- Document status changes
- System notifications

## Styling

The dashboard uses a combination of:

- Material-UI theme for consistent styling
- CSS modules for component-specific styles
- Global CSS for common utilities
- Responsive design with mobile-first approach

## Performance Optimizations

- Code splitting by route
- Lazy loading of heavy components
- Memoization of expensive computations
- Virtual scrolling for large data sets
- Optimistic UI updates
- Request debouncing and throttling

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Contributing

1. Follow the existing code style
2. Write tests for new features
3. Update documentation as needed
4. Ensure all tests pass before submitting PR

## License

MIT