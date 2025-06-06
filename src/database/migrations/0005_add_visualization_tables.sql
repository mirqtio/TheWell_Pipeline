-- Migration: Add visualization dashboard tables
-- Description: Creates tables for storing visualization dashboards and configurations

-- =====================================================
-- VISUALIZATION TABLES
-- =====================================================

-- Visualization Dashboards: Stores user-created dashboards
CREATE TABLE IF NOT EXISTS visualization_dashboards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layout JSONB NOT NULL DEFAULT '{"columns": 12, "rowHeight": 200}',
    widgets JSONB NOT NULL DEFAULT '[]',
    is_public BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT FALSE,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Dashboard Shares: Manages dashboard sharing permissions
CREATE TABLE IF NOT EXISTS dashboard_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id UUID REFERENCES visualization_dashboards(id) ON DELETE CASCADE,
    shared_by UUID REFERENCES users(id) ON DELETE CASCADE,
    shared_with UUID REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(20) DEFAULT 'view', -- 'view', 'edit'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(dashboard_id, shared_with)
);

-- Saved Visualizations: Stores individual visualization configurations
CREATE TABLE IF NOT EXISTS saved_visualizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL, -- 'chart', 'network', 'heatmap', etc.
    config JSONB NOT NULL, -- Complete visualization configuration
    data_source VARCHAR(50) NOT NULL,
    filters JSONB,
    is_public BOOLEAN DEFAULT FALSE,
    tags TEXT[],
    thumbnail TEXT, -- Base64 encoded thumbnail
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Visualization Templates: Pre-built visualization templates
CREATE TABLE IF NOT EXISTS visualization_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50), -- 'analytics', 'reporting', 'monitoring', etc.
    type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    preview_image TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Dashboard Views: Track dashboard usage analytics
CREATE TABLE IF NOT EXISTS dashboard_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id UUID REFERENCES visualization_dashboards(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    duration_seconds INTEGER,
    interactions JSONB -- Track user interactions
);

-- Create triggers for updated_at
CREATE TRIGGER set_visualization_dashboards_updated_at
BEFORE UPDATE ON visualization_dashboards
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_saved_visualizations_updated_at
BEFORE UPDATE ON saved_visualizations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_visualization_templates_updated_at
BEFORE UPDATE ON visualization_templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_visualization_dashboards_user_id ON visualization_dashboards(user_id);
CREATE INDEX idx_visualization_dashboards_is_public ON visualization_dashboards(is_public);
CREATE INDEX idx_visualization_dashboards_tags ON visualization_dashboards USING gin(tags);
CREATE INDEX idx_dashboard_shares_dashboard_id ON dashboard_shares(dashboard_id);
CREATE INDEX idx_dashboard_shares_shared_with ON dashboard_shares(shared_with);
CREATE INDEX idx_saved_visualizations_user_id ON saved_visualizations(user_id);
CREATE INDEX idx_saved_visualizations_type ON saved_visualizations(type);
CREATE INDEX idx_saved_visualizations_is_public ON saved_visualizations(is_public);
CREATE INDEX idx_visualization_templates_category ON visualization_templates(category);
CREATE INDEX idx_visualization_templates_type ON visualization_templates(type);
CREATE INDEX idx_dashboard_views_dashboard_id ON dashboard_views(dashboard_id);
CREATE INDEX idx_dashboard_views_viewed_at ON dashboard_views(viewed_at);

-- Insert default visualization templates
INSERT INTO visualization_templates (name, description, category, type, config) VALUES
('Document Activity Heatmap', 'Shows document creation and update patterns over time', 'analytics', 'heatmap', 
 '{"xField": "hour", "yField": "day", "valueField": "count", "colorScheme": "viridis"}'),
('Entity Relationship Network', 'Visualizes connections between extracted entities', 'analytics', 'network',
 '{"nodeSize": "value", "linkStrength": "weight", "enableClustering": true}'),
('Source Distribution', 'Pie chart showing document distribution by source', 'reporting', 'chart',
 '{"chartType": "pie", "dataField": "source", "valueField": "count"}'),
('Processing Timeline', 'Timeline of document processing and enrichment jobs', 'monitoring', 'timeline',
 '{"groupBy": "type", "showDuration": true, "enableZoom": true}'),
('Feedback Analysis', 'Analyzes user feedback patterns', 'analytics', 'chart',
 '{"chartType": "bar", "xField": "rating", "yField": "count", "groupBy": "category"}'),
('Geographic Distribution', 'Maps showing document locations', 'analytics', 'geomap',
 '{"mapType": "points", "valueField": "count", "enableClustering": true}');

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON visualization_dashboards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_shares TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_visualizations TO authenticated;
GRANT SELECT ON visualization_templates TO authenticated;
GRANT INSERT ON dashboard_views TO authenticated;