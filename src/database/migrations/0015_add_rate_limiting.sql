-- Migration: Add Rate Limiting Tables
-- Description: Creates tables for rate limit configuration, API key management, and usage tracking

-- Add tier column to users table if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(50) DEFAULT 'free';

-- Create index on tier for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    key_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256 hash of the API key
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    tier VARCHAR(50) NOT NULL DEFAULT 'basic',
    custom_limits JSONB, -- Custom rate limits for this key
    rate_limit_override JSONB, -- Complete override of rate limits
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    rotated_to INTEGER REFERENCES api_keys(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    
    CONSTRAINT chk_tier CHECK (tier IN ('anonymous', 'free', 'basic', 'premium', 'enterprise', 'admin'))
);

-- Indexes for API keys
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash) WHERE is_active = true;
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at) WHERE is_active = true AND expires_at IS NOT NULL;

-- API Key Events (for audit trail)
CREATE TABLE IF NOT EXISTS api_key_events (
    id SERIAL PRIMARY KEY,
    api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_event_type CHECK (event_type IN ('created', 'used', 'rotated', 'revoked', 'expired'))
);

CREATE INDEX idx_api_key_events_key_id ON api_key_events(api_key_id);
CREATE INDEX idx_api_key_events_created_at ON api_key_events(created_at);

-- Rate Limit Usage tracking
CREATE TABLE IF NOT EXISTS rate_limit_usage (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL, -- User ID, IP, or API key
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    hour_bucket VARCHAR(13) NOT NULL, -- YYYY-MM-DD-HH format
    request_count INTEGER NOT NULL DEFAULT 0,
    total_cost INTEGER NOT NULL DEFAULT 0,
    tier VARCHAR(50),
    api_key_id INTEGER REFERENCES api_keys(id),
    first_request_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_request_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    UNIQUE(identifier, endpoint, method, hour_bucket)
);

-- Indexes for usage tracking
CREATE INDEX idx_rate_limit_usage_identifier ON rate_limit_usage(identifier);
CREATE INDEX idx_rate_limit_usage_hour_bucket ON rate_limit_usage(hour_bucket);
CREATE INDEX idx_rate_limit_usage_endpoint ON rate_limit_usage(endpoint);
CREATE INDEX idx_rate_limit_usage_first_request ON rate_limit_usage(first_request_at);

-- Rate Limit Configurations (for dynamic configuration)
CREATE TABLE IF NOT EXISTS rate_limit_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    config_type VARCHAR(50) NOT NULL, -- 'tier', 'endpoint', 'ip_range', 'custom'
    priority INTEGER DEFAULT 0, -- Higher priority configs override lower ones
    conditions JSONB NOT NULL DEFAULT '{}', -- Conditions for applying this config
    limits JSONB NOT NULL, -- Rate limit settings
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    
    CONSTRAINT chk_config_type CHECK (config_type IN ('tier', 'endpoint', 'ip_range', 'custom'))
);

CREATE INDEX idx_rate_limit_configs_type ON rate_limit_configs(config_type) WHERE is_active = true;
CREATE INDEX idx_rate_limit_configs_priority ON rate_limit_configs(priority DESC) WHERE is_active = true;

-- IP Blocks table
CREATE TABLE IF NOT EXISTS ip_blocks (
    id SERIAL PRIMARY KEY,
    ip_address INET UNIQUE NOT NULL,
    reason TEXT,
    blocked_until TIMESTAMP WITH TIME ZONE, -- NULL means permanent
    blocked_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ip_blocks_ip ON ip_blocks(ip_address);
CREATE INDEX idx_ip_blocks_blocked_until ON ip_blocks(blocked_until) WHERE blocked_until IS NOT NULL;

-- Rate Limit Violations (for monitoring and alerting)
CREATE TABLE IF NOT EXISTS rate_limit_violations (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    tier VARCHAR(50),
    violation_type VARCHAR(50) NOT NULL, -- 'rate_exceeded', 'daily_exceeded', 'burst_exceeded'
    attempted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    cost INTEGER DEFAULT 1,
    limit_value INTEGER NOT NULL,
    current_value INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_violations_identifier ON rate_limit_violations(identifier);
CREATE INDEX idx_violations_attempted_at ON rate_limit_violations(attempted_at);
CREATE INDEX idx_violations_type ON rate_limit_violations(violation_type);

-- Daily usage summary (materialized for performance)
CREATE TABLE IF NOT EXISTS rate_limit_daily_summary (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    tier VARCHAR(50),
    total_requests BIGINT DEFAULT 0,
    total_cost BIGINT DEFAULT 0,
    unique_endpoints INTEGER DEFAULT 0,
    violations_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(identifier, date)
);

CREATE INDEX idx_daily_summary_identifier_date ON rate_limit_daily_summary(identifier, date DESC);

-- Function to update daily summary
CREATE OR REPLACE FUNCTION update_rate_limit_daily_summary()
RETURNS void AS $$
BEGIN
    INSERT INTO rate_limit_daily_summary (
        identifier,
        date,
        tier,
        total_requests,
        total_cost,
        unique_endpoints
    )
    SELECT 
        identifier,
        DATE(first_request_at) as date,
        tier,
        SUM(request_count) as total_requests,
        SUM(total_cost) as total_cost,
        COUNT(DISTINCT endpoint) as unique_endpoints
    FROM rate_limit_usage
    WHERE DATE(first_request_at) = CURRENT_DATE - INTERVAL '1 day'
    GROUP BY identifier, DATE(first_request_at), tier
    ON CONFLICT (identifier, date) 
    DO UPDATE SET
        total_requests = EXCLUDED.total_requests,
        total_cost = EXCLUDED.total_cost,
        unique_endpoints = EXCLUDED.unique_endpoints;
END;
$$ LANGUAGE plpgsql;

-- Create default rate limit configurations
INSERT INTO rate_limit_configs (name, config_type, priority, conditions, limits) VALUES
    ('default_anonymous', 'tier', 0, '{"tier": "anonymous"}', '{"requests": 100, "window": 3600, "burst": 10}'),
    ('default_free', 'tier', 0, '{"tier": "free"}', '{"requests": 500, "window": 3600, "burst": 50}'),
    ('default_basic', 'tier', 0, '{"tier": "basic"}', '{"requests": 2000, "window": 3600, "burst": 200}'),
    ('default_premium', 'tier', 0, '{"tier": "premium"}', '{"requests": 10000, "window": 3600, "burst": 1000}'),
    ('default_enterprise', 'tier', 0, '{"tier": "enterprise"}', '{"requests": 50000, "window": 3600, "burst": 5000}'),
    ('health_endpoint', 'endpoint', 10, '{"endpoint": "/api/health"}', '{"bypass": true}')
ON CONFLICT (name) DO NOTHING;

-- Add comment
COMMENT ON TABLE api_keys IS 'Stores API keys for programmatic access with rate limiting';
COMMENT ON TABLE rate_limit_usage IS 'Tracks API usage for rate limiting and analytics';
COMMENT ON TABLE rate_limit_configs IS 'Dynamic rate limit configurations';
COMMENT ON TABLE ip_blocks IS 'Blocked IP addresses for security';
COMMENT ON TABLE rate_limit_violations IS 'Log of rate limit violations for monitoring';
COMMENT ON TABLE rate_limit_daily_summary IS 'Daily aggregated usage statistics';