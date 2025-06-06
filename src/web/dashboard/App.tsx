import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Box } from '@mui/material';

import DashboardLayout from './components/layout/DashboardLayout';
import OverviewPage from './pages/OverviewPage';
import DocumentsPage from './pages/DocumentsPage';
import SearchPage from './pages/SearchPage';
import AlertsPage from './pages/AlertsPage';
import ReportsPage from './pages/ReportsPage';
import { initializeWebSocket } from './store/websocketSlice';
import { fetchInitialData } from './store/dashboardSlice';
import { AppDispatch } from './store';

const App: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    // Initialize WebSocket connection
    dispatch(initializeWebSocket());
    
    // Fetch initial dashboard data
    dispatch(fetchInitialData());
  }, [dispatch]);

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <DashboardLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>
      </DashboardLayout>
    </Box>
  );
};

export default App;