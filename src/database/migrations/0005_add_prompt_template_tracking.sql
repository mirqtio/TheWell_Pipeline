-- Migration 0005: Add Prompt Template Tracking Tables
-- Support for prompt template metadata storage and output linking

-- Table for tracking prompt templates
CREATE TABLE IF NOT EXISTS prompt_templates (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    version VARCHAR(50) NOT NULL,
    template_content TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    git_commit_hash VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, version)
);

-- Table for tracking template output links
CREATE TABLE IF NOT EXISTS prompt_template_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id VARCHAR(32) REFERENCES prompt_templates(id),
    template_version VARCHAR(50) NOT NULL,
    document_id VARCHAR(255),
    enrichment_type VARCHAR(100),
    provider VARCHAR(100),
    model VARCHAR(100),
    execution_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_total DECIMAL(10,6),
    result_content TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_prompt_templates_name ON prompt_templates(name);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_version ON prompt_templates(version);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_created_at ON prompt_templates(created_at);

CREATE INDEX IF NOT EXISTS idx_prompt_template_outputs_template_id ON prompt_template_outputs(template_id);
CREATE INDEX IF NOT EXISTS idx_prompt_template_outputs_document_id ON prompt_template_outputs(document_id);
CREATE INDEX IF NOT EXISTS idx_prompt_template_outputs_provider ON prompt_template_outputs(provider);
CREATE INDEX IF NOT EXISTS idx_prompt_template_outputs_execution_timestamp ON prompt_template_outputs(execution_timestamp);

-- Table for template usage analytics
CREATE TABLE IF NOT EXISTS prompt_template_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id VARCHAR(32) REFERENCES prompt_templates(id),
    template_version VARCHAR(50) NOT NULL,
    usage_date DATE DEFAULT CURRENT_DATE,
    execution_count INTEGER DEFAULT 1,
    total_input_tokens BIGINT DEFAULT 0,
    total_output_tokens BIGINT DEFAULT 0,
    total_cost DECIMAL(10,6) DEFAULT 0,
    avg_execution_time_ms INTEGER DEFAULT 0,
    success_rate DECIMAL(5,4) DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(template_id, template_version, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_prompt_template_analytics_date ON prompt_template_analytics(usage_date);
CREATE INDEX IF NOT EXISTS idx_prompt_template_analytics_template ON prompt_template_analytics(template_id, template_version);

-- Update trigger for prompt_templates
CREATE OR REPLACE FUNCTION update_prompt_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_prompt_template_timestamp
    BEFORE UPDATE ON prompt_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_prompt_template_timestamp();

-- Update trigger for prompt_template_analytics
CREATE TRIGGER trigger_update_prompt_template_analytics_timestamp
    BEFORE UPDATE ON prompt_template_analytics
    FOR EACH ROW
    EXECUTE FUNCTION update_prompt_template_timestamp();

-- Function to upsert template analytics
CREATE OR REPLACE FUNCTION upsert_prompt_template_analytics(
    p_template_id VARCHAR(32),
    p_template_version VARCHAR(50),
    p_input_tokens INTEGER,
    p_output_tokens INTEGER,
    p_cost DECIMAL(10,6),
    p_execution_time_ms INTEGER,
    p_success BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO prompt_template_analytics (
        template_id,
        template_version,
        usage_date,
        execution_count,
        total_input_tokens,
        total_output_tokens,
        total_cost,
        avg_execution_time_ms,
        success_rate
    ) VALUES (
        p_template_id,
        p_template_version,
        CURRENT_DATE,
        1,
        COALESCE(p_input_tokens, 0),
        COALESCE(p_output_tokens, 0),
        COALESCE(p_cost, 0),
        COALESCE(p_execution_time_ms, 0),
        CASE WHEN p_success THEN 1.0 ELSE 0.0 END
    )
    ON CONFLICT (template_id, template_version, usage_date)
    DO UPDATE SET
        execution_count = prompt_template_analytics.execution_count + 1,
        total_input_tokens = prompt_template_analytics.total_input_tokens + COALESCE(p_input_tokens, 0),
        total_output_tokens = prompt_template_analytics.total_output_tokens + COALESCE(p_output_tokens, 0),
        total_cost = prompt_template_analytics.total_cost + COALESCE(p_cost, 0),
        avg_execution_time_ms = (
            prompt_template_analytics.avg_execution_time_ms * prompt_template_analytics.execution_count + 
            COALESCE(p_execution_time_ms, 0)
        ) / (prompt_template_analytics.execution_count + 1),
        success_rate = (
            prompt_template_analytics.success_rate * prompt_template_analytics.execution_count + 
            CASE WHEN p_success THEN 1.0 ELSE 0.0 END
        ) / (prompt_template_analytics.execution_count + 1),
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON prompt_templates TO thewell_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON prompt_template_outputs TO thewell_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON prompt_template_analytics TO thewell_user;
GRANT EXECUTE ON FUNCTION upsert_prompt_template_analytics TO thewell_user;