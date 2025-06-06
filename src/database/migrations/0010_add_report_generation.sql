-- Migration: Add report generation tables
-- Date: 2025-01-06
-- Description: Adds tables for report definitions, scheduled reports, and report history

BEGIN;

-- Report definitions table
CREATE TABLE IF NOT EXISTS report_definitions (
    id SERIAL PRIMARY KEY,
    report_id VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    report_type VARCHAR(100) NOT NULL,
    template_id VARCHAR(255),
    configuration JSONB DEFAULT '{}',
    data_sources JSONB DEFAULT '[]',
    filters JSONB DEFAULT '{}',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'
);

-- Scheduled reports table
CREATE TABLE IF NOT EXISTS scheduled_reports (
    id SERIAL PRIMARY KEY,
    schedule_id VARCHAR(255) NOT NULL UNIQUE,
    report_definition_id INTEGER NOT NULL,
    schedule_type VARCHAR(50) NOT NULL CHECK (schedule_type IN ('once', 'daily', 'weekly', 'monthly', 'custom')),
    schedule_config JSONB NOT NULL,
    output_format VARCHAR(20) NOT NULL CHECK (output_format IN ('pdf', 'csv', 'excel', 'json', 'html')),
    recipients JSONB DEFAULT '[]',
    delivery_method VARCHAR(50) DEFAULT 'download' CHECK (delivery_method IN ('download', 'email', 'webhook', 'storage')),
    delivery_config JSONB DEFAULT '{}',
    next_run_at TIMESTAMP WITH TIME ZONE,
    last_run_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Report history table
CREATE TABLE IF NOT EXISTS report_history (
    id SERIAL PRIMARY KEY,
    report_id VARCHAR(255) NOT NULL UNIQUE,
    report_definition_id INTEGER,
    schedule_id VARCHAR(255),
    report_type VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    format VARCHAR(20) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed', 'cancelled')),
    file_path TEXT,
    file_size BIGINT,
    generation_time_ms INTEGER,
    parameters JSONB DEFAULT '{}',
    summary JSONB DEFAULT '{}',
    error_message TEXT,
    requested_by VARCHAR(255) NOT NULL,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    download_count INTEGER DEFAULT 0,
    last_downloaded_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

-- Report templates table
CREATE TABLE IF NOT EXISTS report_templates (
    id SERIAL PRIMARY KEY,
    template_id VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    report_type VARCHAR(100) NOT NULL,
    format VARCHAR(20) NOT NULL,
    template_content TEXT,
    template_path VARCHAR(500),
    variables JSONB DEFAULT '[]',
    sample_data JSONB DEFAULT '{}',
    is_system BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Report access logs table
CREATE TABLE IF NOT EXISTS report_access_logs (
    id SERIAL PRIMARY KEY,
    report_id VARCHAR(255) NOT NULL,
    accessed_by VARCHAR(255) NOT NULL,
    access_type VARCHAR(50) NOT NULL CHECK (access_type IN ('view', 'download', 'share', 'delete')),
    ip_address VARCHAR(45),
    user_agent TEXT,
    accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Create indexes
CREATE INDEX idx_report_definitions_report_id ON report_definitions (report_id);
CREATE INDEX idx_report_definitions_report_type ON report_definitions (report_type);
CREATE INDEX idx_report_definitions_created_by ON report_definitions (created_by);
CREATE INDEX idx_report_definitions_is_active ON report_definitions (is_active);

CREATE INDEX idx_scheduled_reports_schedule_id ON scheduled_reports (schedule_id);
CREATE INDEX idx_scheduled_reports_report_definition_id ON scheduled_reports (report_definition_id);
CREATE INDEX idx_scheduled_reports_next_run_at ON scheduled_reports (next_run_at);
CREATE INDEX idx_scheduled_reports_is_active ON scheduled_reports (is_active);

CREATE INDEX idx_report_history_report_id ON report_history (report_id);
CREATE INDEX idx_report_history_report_definition_id ON report_history (report_definition_id);
CREATE INDEX idx_report_history_schedule_id ON report_history (schedule_id);
CREATE INDEX idx_report_history_status ON report_history (status);
CREATE INDEX idx_report_history_requested_by ON report_history (requested_by);
CREATE INDEX idx_report_history_requested_at ON report_history (requested_at);
CREATE INDEX idx_report_history_expires_at ON report_history (expires_at);

CREATE INDEX idx_report_templates_template_id ON report_templates (template_id);
CREATE INDEX idx_report_templates_report_type ON report_templates (report_type);
CREATE INDEX idx_report_templates_is_active ON report_templates (is_active);

CREATE INDEX idx_report_access_logs_report_id ON report_access_logs (report_id);
CREATE INDEX idx_report_access_logs_accessed_by ON report_access_logs (accessed_by);
CREATE INDEX idx_report_access_logs_accessed_at ON report_access_logs (accessed_at);

-- Add foreign key constraints
ALTER TABLE scheduled_reports 
    ADD CONSTRAINT fk_scheduled_reports_definition 
    FOREIGN KEY (report_definition_id) 
    REFERENCES report_definitions(id) 
    ON DELETE CASCADE;

ALTER TABLE report_history 
    ADD CONSTRAINT fk_report_history_definition 
    FOREIGN KEY (report_definition_id) 
    REFERENCES report_definitions(id) 
    ON DELETE SET NULL;

-- Create triggers for updated_at
CREATE TRIGGER update_report_definitions_updated_at 
    BEFORE UPDATE ON report_definitions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduled_reports_updated_at 
    BEFORE UPDATE ON scheduled_reports 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_report_templates_updated_at 
    BEFORE UPDATE ON report_templates 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default system templates
INSERT INTO report_templates (template_id, name, report_type, format, description, is_system, created_by) VALUES
    ('system-document-analytics-pdf', 'Document Analytics PDF Template', 'document-analytics', 'pdf', 'Default PDF template for document analytics reports', true, 'system'),
    ('system-entity-extraction-pdf', 'Entity Extraction PDF Template', 'entity-extraction', 'pdf', 'Default PDF template for entity extraction reports', true, 'system'),
    ('system-alert-summary-pdf', 'Alert Summary PDF Template', 'alert-summary', 'pdf', 'Default PDF template for alert summary reports', true, 'system'),
    ('system-search-analytics-pdf', 'Search Analytics PDF Template', 'search-analytics', 'pdf', 'Default PDF template for search analytics reports', true, 'system'),
    ('system-user-activity-pdf', 'User Activity PDF Template', 'user-activity', 'pdf', 'Default PDF template for user activity reports', true, 'system'),
    ('system-system-performance-pdf', 'System Performance PDF Template', 'system-performance', 'pdf', 'Default PDF template for system performance reports', true, 'system');

COMMIT;