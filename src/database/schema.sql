-- TheWell Pipeline Database Schema
-- Comprehensive schema supporting ingestion, job management, visibility, and manual review

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable full-text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Sources: Define ingestion sources
CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL, -- 'rss', 'api', 'file', 'webhook'
    config JSONB NOT NULL, -- Source-specific configuration
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive', 'error'
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Documents: Core document storage
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
    external_id VARCHAR(500), -- Source-specific identifier
    title TEXT NOT NULL,
    content TEXT,
    content_type VARCHAR(100), -- 'text/plain', 'text/html', 'application/pdf'
    url TEXT,
    metadata JSONB DEFAULT '{}', -- Flexible metadata storage
    hash VARCHAR(64) UNIQUE, -- Content hash for deduplication
    word_count INTEGER,
    language VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Full-text search
    search_vector tsvector
);

-- =====================================================
-- JOB MANAGEMENT TABLES
-- =====================================================

-- Jobs: Track all ingestion and processing jobs
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL, -- 'ingestion', 'enrichment', 'processing'
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'cancelled'
    priority INTEGER DEFAULT 0, -- Higher numbers = higher priority
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    config JSONB DEFAULT '{}', -- Job-specific configuration
    progress INTEGER DEFAULT 0, -- 0-100 percentage
    result JSONB, -- Job results and outputs
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job Dependencies: Define job execution order
CREATE TABLE job_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    depends_on_job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(job_id, depends_on_job_id)
);

-- Job Logs: Detailed job execution logs
CREATE TABLE job_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    level VARCHAR(10) NOT NULL, -- 'debug', 'info', 'warn', 'error'
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- VISIBILITY MANAGEMENT TABLES
-- =====================================================

-- Document Visibility: Control document access
CREATE TABLE document_visibility (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    visibility_level VARCHAR(20) NOT NULL DEFAULT 'internal', -- 'public', 'internal', 'private', 'restricted'
    access_groups TEXT[], -- Array of group names that can access
    reason TEXT, -- Reason for visibility setting
    approved_by VARCHAR(255), -- User who approved the visibility
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(document_id)
);

-- Visibility Rules: Automated visibility assignment
CREATE TABLE visibility_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    pattern_type VARCHAR(20) NOT NULL, -- 'url', 'title', 'content', 'metadata'
    pattern TEXT NOT NULL, -- Regex or string pattern
    visibility_level VARCHAR(20) NOT NULL,
    priority INTEGER DEFAULT 0, -- Higher numbers processed first
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Visibility Audit Log: Track all visibility changes
CREATE TABLE visibility_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'created', 'updated', 'approved', 'rejected'
    old_visibility VARCHAR(20),
    new_visibility VARCHAR(20),
    reason TEXT,
    user_id VARCHAR(255), -- User who made the change
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- MANUAL REVIEW TABLES
-- =====================================================

-- Review Sessions: Track manual review sessions
CREATE TABLE review_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'completed', 'expired'
    documents_reviewed INTEGER DEFAULT 0,
    documents_approved INTEGER DEFAULT 0,
    documents_rejected INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '1 hour')
);

-- Document Reviews: Individual document review results
CREATE TABLE document_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    session_id UUID REFERENCES review_sessions(id) ON DELETE CASCADE,
    reviewer_id VARCHAR(255) NOT NULL,
    action VARCHAR(20) NOT NULL, -- 'approved', 'rejected', 'flagged', 'modified'
    reason TEXT,
    modifications JSONB, -- Any changes made during review
    confidence_score DECIMAL(3,2), -- 0.00-1.00
    review_time_seconds INTEGER, -- Time spent reviewing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(document_id, session_id)
);

-- =====================================================
-- LLM ENRICHMENT TABLES
-- =====================================================

-- LLM Providers: Track available LLM services
CREATE TABLE llm_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    provider_type VARCHAR(50) NOT NULL, -- 'openai', 'anthropic', 'local'
    config JSONB NOT NULL, -- Provider-specific configuration
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive', 'error'
    cost_per_token DECIMAL(10,8), -- Cost tracking
    rate_limit_rpm INTEGER, -- Requests per minute
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Document Enrichments: LLM-generated content
CREATE TABLE document_enrichments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES llm_providers(id) ON DELETE SET NULL,
    enrichment_type VARCHAR(50) NOT NULL, -- 'summary', 'tags', 'sentiment', 'classification'
    prompt_version VARCHAR(20),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost DECIMAL(10,6),
    result JSONB NOT NULL, -- Enrichment results
    confidence_score DECIMAL(3,2), -- 0.00-1.00
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- COST TRACKING TABLES
-- =====================================================

-- Cost Events: Track individual LLM usage costs
CREATE TABLE cost_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(50) NOT NULL, -- 'openai', 'anthropic', etc.
    model VARCHAR(100) NOT NULL, -- 'gpt-4-turbo', 'claude-3-sonnet', etc.
    operation VARCHAR(50) NOT NULL, -- 'enrichment', 'completion', 'classification', etc.
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    source_type VARCHAR(50), -- Source type for categorization
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    input_cost DECIMAL(10,6) NOT NULL DEFAULT 0,
    output_cost DECIMAL(10,6) NOT NULL DEFAULT 0,
    total_cost DECIMAL(10,6) NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}', -- Additional cost-related metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cost Budgets: Define spending limits
CREATE TABLE cost_budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    budget_type VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly', 'yearly'
    limit_amount DECIMAL(10,2) NOT NULL,
    alert_threshold DECIMAL(3,2) DEFAULT 0.8, -- Alert when 80% of budget is reached
    provider_filter VARCHAR(50), -- Optional: limit to specific provider
    operation_filter VARCHAR(50), -- Optional: limit to specific operation
    source_type_filter VARCHAR(50), -- Optional: limit to specific source type
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cost Alerts: Track budget alerts and notifications
CREATE TABLE cost_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    budget_id UUID REFERENCES cost_budgets(id) ON DELETE CASCADE,
    alert_type VARCHAR(20) NOT NULL, -- 'threshold', 'exceeded', 'daily_summary'
    current_amount DECIMAL(10,2) NOT NULL,
    limit_amount DECIMAL(10,2) NOT NULL,
    percentage DECIMAL(5,2) NOT NULL, -- Percentage of budget used
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    message TEXT,
    is_acknowledged BOOLEAN DEFAULT false,
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cost Reports: Store generated cost reports
CREATE TABLE cost_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_name VARCHAR(255) NOT NULL,
    report_type VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'monthly', 'custom'
    date_range_start TIMESTAMP WITH TIME ZONE NOT NULL,
    date_range_end TIMESTAMP WITH TIME ZONE NOT NULL,
    total_cost DECIMAL(10,2) NOT NULL,
    total_tokens BIGINT NOT NULL,
    record_count INTEGER NOT NULL,
    report_data JSONB NOT NULL, -- Full report data
    format VARCHAR(20) DEFAULT 'json', -- 'json', 'csv', 'html'
    generated_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- CONFIGURATION TABLES
-- =====================================================

-- System Configuration: Hot-reloadable configuration
CREATE TABLE system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(255) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    is_sensitive BOOLEAN DEFAULT false, -- Don't log sensitive configs
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Configuration History: Track configuration changes
CREATE TABLE config_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key VARCHAR(255) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    changed_by VARCHAR(255),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Documents indexes
CREATE INDEX idx_documents_source_id ON documents(source_id);
CREATE INDEX idx_documents_hash ON documents(hash);
CREATE INDEX idx_documents_created_at ON documents(created_at);
CREATE INDEX idx_documents_search_vector ON documents USING gin(search_vector);
CREATE INDEX idx_documents_metadata ON documents USING gin(metadata);

-- Jobs indexes
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_priority ON jobs(priority DESC);
CREATE INDEX idx_jobs_source_id ON jobs(source_id);
CREATE INDEX idx_jobs_document_id ON jobs(document_id);
CREATE INDEX idx_jobs_created_at ON jobs(created_at);

-- Job logs indexes
CREATE INDEX idx_job_logs_job_id ON job_logs(job_id);
CREATE INDEX idx_job_logs_level ON job_logs(level);
CREATE INDEX idx_job_logs_created_at ON job_logs(created_at);

-- Visibility indexes
CREATE INDEX idx_document_visibility_document_id ON document_visibility(document_id);
CREATE INDEX idx_document_visibility_level ON document_visibility(visibility_level);
CREATE INDEX idx_visibility_audit_log_document_id ON visibility_audit_log(document_id);
CREATE INDEX idx_visibility_audit_log_created_at ON visibility_audit_log(created_at);

-- Review indexes
CREATE INDEX idx_review_sessions_user_id ON review_sessions(user_id);
CREATE INDEX idx_review_sessions_status ON review_sessions(status);
CREATE INDEX idx_document_reviews_document_id ON document_reviews(document_id);
CREATE INDEX idx_document_reviews_session_id ON document_reviews(session_id);
CREATE INDEX idx_document_reviews_reviewer_id ON document_reviews(reviewer_id);

-- Enrichment indexes
CREATE INDEX idx_document_enrichments_document_id ON document_enrichments(document_id);
CREATE INDEX idx_document_enrichments_type ON document_enrichments(enrichment_type);
CREATE INDEX idx_document_enrichments_provider_id ON document_enrichments(provider_id);

-- Cost tracking indexes
CREATE INDEX idx_cost_events_provider ON cost_events(provider);
CREATE INDEX idx_cost_events_model ON cost_events(model);
CREATE INDEX idx_cost_events_operation ON cost_events(operation);
CREATE INDEX idx_cost_events_document_id ON cost_events(document_id);
CREATE INDEX idx_cost_events_created_at ON cost_events(created_at);
CREATE INDEX idx_cost_events_provider_created_at ON cost_events(provider, created_at);
CREATE INDEX idx_cost_budgets_budget_type ON cost_budgets(budget_type);
CREATE INDEX idx_cost_budgets_is_active ON cost_budgets(is_active);
CREATE INDEX idx_cost_alerts_budget_id ON cost_alerts(budget_id);
CREATE INDEX idx_cost_alerts_alert_type ON cost_alerts(alert_type);
CREATE INDEX idx_cost_alerts_created_at ON cost_alerts(created_at);
CREATE INDEX idx_cost_reports_report_type ON cost_reports(report_type);
CREATE INDEX idx_cost_reports_date_range ON cost_reports(date_range_start, date_range_end);

-- =====================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- =====================================================

-- Update timestamps automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers
CREATE TRIGGER update_sources_updated_at BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_document_visibility_updated_at BEFORE UPDATE ON document_visibility FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_visibility_rules_updated_at BEFORE UPDATE ON visibility_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_llm_providers_updated_at BEFORE UPDATE ON llm_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cost_budgets_updated_at BEFORE UPDATE ON cost_budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update search vector for documents
CREATE OR REPLACE FUNCTION update_document_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector = to_tsvector('english', COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.content, ''));
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_documents_search_vector 
    BEFORE INSERT OR UPDATE ON documents 
    FOR EACH ROW EXECUTE FUNCTION update_document_search_vector();

-- =====================================================
-- INITIAL DATA
-- =====================================================

-- Insert default LLM providers
INSERT INTO llm_providers (name, provider_type, config, cost_per_token, rate_limit_rpm) VALUES
('OpenAI GPT-4', 'openai', '{"model": "gpt-4", "max_tokens": 4000}', 0.00003, 500),
('OpenAI GPT-3.5', 'openai', '{"model": "gpt-3.5-turbo", "max_tokens": 4000}', 0.000002, 3500),
('Anthropic Claude', 'anthropic', '{"model": "claude-3-sonnet-20240229", "max_tokens": 4000}', 0.000015, 1000);

-- Insert default visibility rules
INSERT INTO visibility_rules (name, description, pattern_type, pattern, visibility_level, priority) VALUES
('Public News Sites', 'Major news websites should be public', 'url', '(cnn\.com|bbc\.com|reuters\.com|ap\.org)', 'public', 100),
('Internal Documentation', 'Internal docs should be private', 'url', '(internal\.|intranet\.|docs\.company)', 'private', 90),
('Sensitive Content', 'Documents with sensitive keywords', 'content', '(confidential|secret|proprietary|internal only)', 'restricted', 80);

-- Insert default system configuration
INSERT INTO system_config (key, value, description) VALUES
('ingestion.batch_size', '100', 'Number of documents to process in each batch'),
('ingestion.max_retries', '3', 'Maximum number of retry attempts for failed ingestions'),
('llm.default_provider', '"OpenAI GPT-3.5"', 'Default LLM provider for enrichment'),
('review.session_timeout', '3600', 'Review session timeout in seconds'),
('visibility.default_level', '"internal"', 'Default visibility level for new documents');

-- Insert default cost budgets
INSERT INTO cost_budgets (name, budget_type, limit_amount, alert_threshold, is_active) VALUES
('Daily Budget', 'daily', 50.00, 0.8, true),
('Monthly Budget', 'monthly', 1000.00, 0.8, true),
('OpenAI Daily Limit', 'daily', 30.00, 0.9, true),
('Anthropic Daily Limit', 'daily', 20.00, 0.9, true);

-- Update cost budgets with provider filters
UPDATE cost_budgets SET provider_filter = 'openai' WHERE name = 'OpenAI Daily Limit';
UPDATE cost_budgets SET provider_filter = 'anthropic' WHERE name = 'Anthropic Daily Limit';
