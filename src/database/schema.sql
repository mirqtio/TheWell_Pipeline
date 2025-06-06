-- TheWell Pipeline Database Schema
-- Comprehensive schema supporting ingestion, job management, visibility, and manual review

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable full-text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Function to update updated_at timestamp on row update
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- Documents: Core document storage with vector search capabilities
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
    external_id VARCHAR(500), -- Source-specific identifier
    title TEXT NOT NULL,
    content TEXT,
    content_type VARCHAR(100), -- 'text/plain', 'text/html', 'application/pdf'
    url TEXT,
    author VARCHAR(255),
    published_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}', -- Flexible metadata storage
    hash VARCHAR(64) UNIQUE, -- Content hash for deduplication
    word_count INTEGER,
    language VARCHAR(10),
    
    -- Vector embeddings for semantic similarity search
    embedding vector(1536), -- OpenAI text-embedding-3-small dimension
    embedding_model VARCHAR(100) DEFAULT 'text-embedding-3-small',
    
    -- Visibility and quality controls
    visibility VARCHAR(20) DEFAULT 'internal', -- 'public', 'internal', 'private', 'restricted'
    quality_score FLOAT, -- 0.0 to 1.0
    believability_score FLOAT, -- Score from 0.0 to 1.0 indicating perceived believability
    is_processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP WITH TIME ZONE,
    processing_error TEXT,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================

-- Users: Stores user information for access control and review assignments
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    external_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive', 'suspended', 'pending'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger for users to update updated_at
CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================

-- Articles: Enhanced document representation with additional metadata and review status
CREATE TABLE articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    source_id UUID REFERENCES sources(id), -- Denormalized for easier querying
    external_id VARCHAR(500), -- Source-specific identifier
    title TEXT NOT NULL,
    url TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    author VARCHAR(255),
    summary TEXT,
    tags TEXT[],
    category VARCHAR(100),
    
    -- Enrichment and analysis fields
    sentiment VARCHAR(20), -- 'positive', 'negative', 'neutral'
    sentiment_score FLOAT,
    entities JSONB, -- Named entities extracted from content
    keywords TEXT[],
    topics TEXT[],
    believability_score FLOAT, -- Score from 0.0 to 1.0 indicating perceived believability
    
    -- Review and moderation fields
    status VARCHAR(50) DEFAULT 'pending_review', -- 'pending_review', 'approved', 'rejected', 'archived'
    review_priority INTEGER DEFAULT 0,
    assigned_to UUID REFERENCES users(id),
    review_notes TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger for documents to update updated_at
CREATE TRIGGER set_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create a trigger for sources to update updated_at
CREATE TRIGGER set_sources_updated_at
BEFORE UPDATE ON sources
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create a trigger for articles to update updated_at
CREATE TRIGGER set_articles_updated_at
BEFORE UPDATE ON articles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- JOB MANAGEMENT TABLES
-- =====================================================

-- Jobs: Tracks background processing tasks
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type VARCHAR(100) NOT NULL, -- e.g., 'ingest_rss', 'enrich_document', 'generate_summary'
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'retrying'
    priority INTEGER DEFAULT 0,
    payload JSONB, -- Job-specific parameters
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_attempted_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger for jobs to update updated_at
CREATE TRIGGER set_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- USER AND AUTHENTICATION TABLES

-- VISIBILITY AND REVIEW TABLES
-- =====================================================

-- Visibility Rules: Define rules for automatic visibility setting
CREATE TABLE visibility_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    pattern_type VARCHAR(50) NOT NULL, -- 'url', 'content_keyword', 'source_type'
    pattern TEXT NOT NULL,
    visibility_level VARCHAR(20) NOT NULL, -- 'public', 'internal', 'private', 'restricted'
    priority INTEGER DEFAULT 0, -- Higher priority rules are evaluated first
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger for visibility_rules to update updated_at
CREATE TRIGGER set_visibility_rules_updated_at
BEFORE UPDATE ON visibility_rules
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Review Sessions: Tracks manual review sessions
CREATE TABLE review_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'completed', 'expired'
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE, -- e.g., NOW() + INTERVAL '1 hour'
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger for review_sessions to update updated_at
CREATE TRIGGER set_review_sessions_updated_at
BEFORE UPDATE ON review_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Reviewed Items: Links articles to review sessions and records review decisions
CREATE TABLE reviewed_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES review_sessions(id) ON DELETE CASCADE,
    article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- User who performed the review
    decision VARCHAR(20), -- 'approved', 'rejected', 'flagged'
    notes TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, article_id) -- Ensure an article is reviewed once per session
);

-- Create a trigger for reviewed_items to update updated_at
CREATE TRIGGER set_reviewed_items_updated_at
BEFORE UPDATE ON reviewed_items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- CONFIGURATION AND METADATA TABLES
-- =====================================================

-- LLM Providers: Stores configuration for different LLM providers
CREATE TABLE llm_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    provider_type VARCHAR(50) NOT NULL, -- 'openai', 'anthropic', 'local_llm'
    config JSONB NOT NULL, -- API keys, model names, etc.
    cost_per_token DECIMAL(10, 8), -- Cost per 1000 tokens or similar unit
    rate_limit_rpm INTEGER, -- Requests per minute
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger for llm_providers to update updated_at
CREATE TRIGGER set_llm_providers_updated_at
BEFORE UPDATE ON llm_providers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- System Config: Key-value store for system-wide settings
CREATE TABLE system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value JSONB,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger for system_config to update updated_at
CREATE TRIGGER set_system_config_updated_at
BEFORE UPDATE ON system_config
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Migrations: Tracks applied database migrations
CREATE TABLE migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cost Tracking: Tracks costs associated with LLM usage or other services
CREATE TABLE cost_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id),
    llm_provider_id UUID REFERENCES llm_providers(id),
    document_id UUID REFERENCES documents(id),
    tokens_used INTEGER,
    cost DECIMAL(10, 6),
    event_type VARCHAR(100), -- e.g., 'llm_request', 'data_storage'
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cost Budgets: Define budgets for cost control
CREATE TABLE cost_budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    budget_type VARCHAR(50) NOT NULL, -- 'daily', 'monthly', 'per_provider'
    limit_amount DECIMAL(12, 2) NOT NULL,
    alert_threshold FLOAT DEFAULT 0.8, -- e.g., 0.8 for 80%
    provider_filter VARCHAR(100), -- Optional: filter by provider name (e.g., 'openai')
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger for cost_budgets to update updated_at
CREATE TRIGGER set_cost_budgets_updated_at
BEFORE UPDATE ON cost_budgets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INDEXES
-- =====================================================

-- Indexes for core tables
CREATE INDEX idx_documents_source_id ON documents(source_id);
CREATE INDEX idx_documents_external_id ON documents(external_id);
CREATE INDEX idx_documents_hash ON documents(hash);
CREATE INDEX idx_documents_visibility ON documents(visibility);
CREATE INDEX idx_documents_created_at ON documents(created_at);
CREATE INDEX idx_documents_content_gin ON documents USING gin (to_tsvector('english', content)); -- For FTS
CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100); -- For vector search

CREATE INDEX idx_articles_document_id ON articles(document_id);
CREATE INDEX idx_articles_source_id ON articles(source_id);
CREATE INDEX idx_articles_status ON articles(status);
CREATE INDEX idx_articles_published_at ON articles(published_at);
CREATE INDEX idx_articles_assigned_to ON articles(assigned_to);

CREATE INDEX idx_sources_name ON sources(name);
CREATE INDEX idx_sources_type ON sources(type);

-- Indexes for job management
CREATE INDEX idx_jobs_type_status ON jobs(job_type, status);
CREATE INDEX idx_jobs_document_id ON jobs(document_id);
CREATE INDEX idx_jobs_priority_created_at ON jobs(priority DESC, created_at ASC);

-- Indexes for user and auth
CREATE INDEX idx_users_email ON users(email);

-- Indexes for visibility and review
CREATE INDEX idx_visibility_rules_is_active ON visibility_rules(is_active);
CREATE INDEX idx_review_sessions_user_id ON review_sessions(user_id);
CREATE INDEX idx_review_sessions_status ON review_sessions(status);
CREATE INDEX idx_reviewed_items_article_id ON reviewed_items(article_id);
CREATE INDEX idx_reviewed_items_user_id ON reviewed_items(user_id);

-- Indexes for configuration and metadata
CREATE INDEX idx_llm_providers_is_active ON llm_providers(is_active);
CREATE INDEX idx_cost_tracking_event_timestamp ON cost_tracking(event_timestamp);
CREATE INDEX idx_cost_budgets_is_active ON cost_budgets(is_active);

-- =====================================================
-- INITIAL DATA (Optional Seed Data)
-- =====================================================

-- Insert default user (replace with secure setup in production)
INSERT INTO users (username, email, password_hash, role) VALUES
('admin', 'admin@example.com', 'replace_this_with_a_real_hash', 'admin');

-- Insert default sources (examples)
INSERT INTO sources (name, type, config) VALUES
('Example RSS Feed', 'rss', '{"url": "http://example.com/rss", "fetch_interval_minutes": 60}'),
('Example API Source', 'api', '{"base_url": "http://api.example.com/news", "api_key_env": "EXAMPLE_API_KEY"}'),
('Local JSON Files', 'file', '{"directory_path": "/app/data/json_files", "file_pattern": "*.json"}'),
('Hacker News Top Stories', 'api', '{"base_url": "https://hacker-news.firebaseio.com/v0", "endpoint": "/topstories.json"}');

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
