-- Migration: Add real-time analytics tables
-- Version: 0011
-- Description: Create tables for time-series data, aggregated metrics, and analytics configuration

-- Create analytics metrics table for time-series data
CREATE TABLE IF NOT EXISTS analytics_metrics (
    id BIGSERIAL PRIMARY KEY,
    metric_name VARCHAR(255) NOT NULL,
    tags JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ NOT NULL,
    time_bucket TIMESTAMPTZ NOT NULL,
    granularity VARCHAR(20) DEFAULT 'raw',
    count INTEGER NOT NULL DEFAULT 1,
    sum DOUBLE PRECISION,
    min DOUBLE PRECISION,
    max DOUBLE PRECISION,
    avg DOUBLE PRECISION,
    last DOUBLE PRECISION,
    p50 DOUBLE PRECISION,
    p95 DOUBLE PRECISION,
    p99 DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_analytics_metrics_name_time ON analytics_metrics(metric_name, timestamp DESC);
CREATE INDEX idx_analytics_metrics_bucket ON analytics_metrics(time_bucket DESC);
CREATE INDEX idx_analytics_metrics_tags ON analytics_metrics USING GIN(tags);
CREATE INDEX idx_analytics_metrics_composite ON analytics_metrics(metric_name, tags, time_bucket DESC);

-- Create unique constraint for upserts
CREATE UNIQUE INDEX idx_analytics_metrics_unique ON analytics_metrics(metric_name, tags, time_bucket);

-- Create table for metric metadata and configuration
CREATE TABLE IF NOT EXISTS analytics_metric_definitions (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    unit VARCHAR(50),
    type VARCHAR(50) DEFAULT 'gauge', -- gauge, counter, histogram
    retention_raw INTEGER DEFAULT 3600, -- seconds
    retention_1m INTEGER DEFAULT 86400,
    retention_1h INTEGER DEFAULT 604800,
    retention_1d INTEGER DEFAULT 2592000,
    aggregation_method VARCHAR(50) DEFAULT 'avg', -- avg, sum, max, min, last
    anomaly_detection_enabled BOOLEAN DEFAULT true,
    anomaly_threshold DOUBLE PRECISION DEFAULT 3.0,
    alert_enabled BOOLEAN DEFAULT false,
    alert_threshold_high DOUBLE PRECISION,
    alert_threshold_low DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create table for storing anomalies
CREATE TABLE IF NOT EXISTS analytics_anomalies (
    id BIGSERIAL PRIMARY KEY,
    metric_name VARCHAR(255) NOT NULL,
    tags JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    deviation DOUBLE PRECISION NOT NULL,
    severity VARCHAR(20) NOT NULL, -- low, medium, high
    baseline_mean DOUBLE PRECISION,
    baseline_stddev DOUBLE PRECISION,
    baseline_count INTEGER,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_by INTEGER REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_anomalies_metric_time ON analytics_anomalies(metric_name, timestamp DESC);
CREATE INDEX idx_analytics_anomalies_severity ON analytics_anomalies(severity, acknowledged);
CREATE INDEX idx_analytics_anomalies_tags ON analytics_anomalies USING GIN(tags);

-- Create table for real-time dashboards configuration
CREATE TABLE IF NOT EXISTS analytics_dashboards (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    owner_id INTEGER REFERENCES users(id),
    is_public BOOLEAN DEFAULT false,
    layout JSONB DEFAULT '{}',
    refresh_interval INTEGER DEFAULT 5, -- seconds
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create table for dashboard widgets
CREATE TABLE IF NOT EXISTS analytics_dashboard_widgets (
    id SERIAL PRIMARY KEY,
    dashboard_id INTEGER REFERENCES analytics_dashboards(id) ON DELETE CASCADE,
    widget_type VARCHAR(50) NOT NULL, -- line_chart, bar_chart, gauge, number, table
    title VARCHAR(255) NOT NULL,
    position JSONB NOT NULL, -- {x, y, w, h}
    config JSONB NOT NULL, -- widget-specific configuration
    metric_name VARCHAR(255),
    tags JSONB DEFAULT '{}',
    time_range VARCHAR(50) DEFAULT '1h', -- 5m, 15m, 1h, 6h, 1d, 7d, 30d
    refresh_interval INTEGER, -- override dashboard refresh
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dashboard_widgets_dashboard ON analytics_dashboard_widgets(dashboard_id);

-- Create table for metric alerts configuration
CREATE TABLE IF NOT EXISTS analytics_alerts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    tags JSONB DEFAULT '{}',
    condition VARCHAR(20) NOT NULL, -- above, below, outside_range, anomaly
    threshold_value DOUBLE PRECISION,
    threshold_min DOUBLE PRECISION,
    threshold_max DOUBLE PRECISION,
    time_window INTEGER DEFAULT 300, -- seconds
    evaluation_interval INTEGER DEFAULT 60, -- seconds
    severity VARCHAR(20) DEFAULT 'medium',
    enabled BOOLEAN DEFAULT true,
    notification_channels JSONB DEFAULT '[]', -- email, slack, webhook
    cooldown_period INTEGER DEFAULT 300, -- seconds
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_alerts_metric ON analytics_alerts(metric_name, enabled);

-- Create table for alert history
CREATE TABLE IF NOT EXISTS analytics_alert_history (
    id BIGSERIAL PRIMARY KEY,
    alert_id INTEGER REFERENCES analytics_alerts(id),
    triggered_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    metric_value DOUBLE PRECISION,
    threshold_value DOUBLE PRECISION,
    tags JSONB DEFAULT '{}',
    notification_sent BOOLEAN DEFAULT false,
    notification_sent_at TIMESTAMPTZ,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_by INTEGER REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alert_history_alert ON analytics_alert_history(alert_id, triggered_at DESC);
CREATE INDEX idx_alert_history_unresolved ON analytics_alert_history(resolved_at) WHERE resolved_at IS NULL;

-- Create table for query performance tracking
CREATE TABLE IF NOT EXISTS analytics_query_performance (
    id BIGSERIAL PRIMARY KEY,
    query_hash VARCHAR(64) NOT NULL,
    query_text TEXT NOT NULL,
    metric_name VARCHAR(255),
    tags JSONB DEFAULT '{}',
    time_range_seconds INTEGER,
    execution_time_ms INTEGER NOT NULL,
    rows_returned INTEGER,
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_query_performance_hash ON analytics_query_performance(query_hash, created_at DESC);
CREATE INDEX idx_query_performance_slow ON analytics_query_performance(execution_time_ms DESC);

-- Create materialized views for common aggregations
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_hourly_summary AS
SELECT 
    metric_name,
    tags,
    date_trunc('hour', time_bucket) as hour,
    COUNT(*) as data_points,
    AVG(avg) as avg_value,
    MIN(min) as min_value,
    MAX(max) as max_value,
    AVG(p95) as p95_value,
    AVG(p99) as p99_value
FROM analytics_metrics
WHERE time_bucket > NOW() - INTERVAL '7 days'
GROUP BY metric_name, tags, date_trunc('hour', time_bucket);

CREATE INDEX idx_hourly_summary_metric ON analytics_hourly_summary(metric_name, hour DESC);

-- Create function to automatically clean up old data
CREATE OR REPLACE FUNCTION cleanup_analytics_data() RETURNS void AS $$
DECLARE
    metric_def RECORD;
BEGIN
    -- Clean up raw metrics based on retention settings
    FOR metric_def IN SELECT * FROM analytics_metric_definitions LOOP
        DELETE FROM analytics_metrics 
        WHERE metric_name = metric_def.metric_name 
        AND granularity = 'raw'
        AND timestamp < NOW() - INTERVAL '1 second' * metric_def.retention_raw;
        
        DELETE FROM analytics_metrics 
        WHERE metric_name = metric_def.metric_name 
        AND granularity = '1m'
        AND timestamp < NOW() - INTERVAL '1 second' * metric_def.retention_1m;
        
        DELETE FROM analytics_metrics 
        WHERE metric_name = metric_def.metric_name 
        AND granularity = '1h'
        AND timestamp < NOW() - INTERVAL '1 second' * metric_def.retention_1h;
        
        DELETE FROM analytics_metrics 
        WHERE metric_name = metric_def.metric_name 
        AND granularity = '1d'
        AND timestamp < NOW() - INTERVAL '1 second' * metric_def.retention_1d;
    END LOOP;
    
    -- Clean up old anomalies (keep 30 days)
    DELETE FROM analytics_anomalies WHERE timestamp < NOW() - INTERVAL '30 days';
    
    -- Clean up old alert history (keep 90 days)
    DELETE FROM analytics_alert_history WHERE triggered_at < NOW() - INTERVAL '90 days';
    
    -- Clean up old query performance data (keep 7 days)
    DELETE FROM analytics_query_performance WHERE created_at < NOW() - INTERVAL '7 days';
    
    -- Refresh materialized views
    REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_hourly_summary;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at timestamps
CREATE OR REPLACE FUNCTION update_analytics_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_analytics_metrics_updated_at 
    BEFORE UPDATE ON analytics_metrics 
    FOR EACH ROW EXECUTE FUNCTION update_analytics_updated_at();

CREATE TRIGGER update_analytics_metric_definitions_updated_at 
    BEFORE UPDATE ON analytics_metric_definitions 
    FOR EACH ROW EXECUTE FUNCTION update_analytics_updated_at();

CREATE TRIGGER update_analytics_dashboards_updated_at 
    BEFORE UPDATE ON analytics_dashboards 
    FOR EACH ROW EXECUTE FUNCTION update_analytics_updated_at();

CREATE TRIGGER update_analytics_dashboard_widgets_updated_at 
    BEFORE UPDATE ON analytics_dashboard_widgets 
    FOR EACH ROW EXECUTE FUNCTION update_analytics_updated_at();

CREATE TRIGGER update_analytics_alerts_updated_at 
    BEFORE UPDATE ON analytics_alerts 
    FOR EACH ROW EXECUTE FUNCTION update_analytics_updated_at();

-- Insert default metric definitions
INSERT INTO analytics_metric_definitions (metric_name, description, unit, type) VALUES
    ('document.processing.time', 'Time to process a document', 'ms', 'histogram'),
    ('search.query.latency', 'Search query response time', 'ms', 'histogram'),
    ('search.query.count', 'Number of search queries', 'count', 'counter'),
    ('system.cpu.usage', 'CPU usage percentage', 'percent', 'gauge'),
    ('system.memory.usage', 'Memory usage percentage', 'percent', 'gauge'),
    ('api.request.count', 'API request count', 'count', 'counter'),
    ('api.request.latency', 'API request latency', 'ms', 'histogram'),
    ('api.error.count', 'API error count', 'count', 'counter'),
    ('embedding.generation.time', 'Embedding generation time', 'ms', 'histogram'),
    ('cache.hit.rate', 'Cache hit rate', 'percent', 'gauge')
ON CONFLICT (metric_name) DO NOTHING;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO thewell_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO thewell_app;
GRANT SELECT ON analytics_hourly_summary TO thewell_readonly;