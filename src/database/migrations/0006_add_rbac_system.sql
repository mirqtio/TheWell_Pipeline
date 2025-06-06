-- Migration: Add Role-Based Access Control (RBAC) system
-- Version: 0006
-- Description: Adds roles, permissions, and API key rotation

BEGIN;

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '[]',
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users table (extend existing or create new)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API Keys table with rotation support
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL,
    key_prefix VARCHAR(8) NOT NULL, -- For identification (first 8 chars)
    name VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE,
    rotated_from INTEGER REFERENCES api_keys(id),
    rotated_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Create indexes for performance
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at);
CREATE INDEX idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_email ON users(email);

-- Permission definitions (as a reference table)
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    description TEXT,
    CONSTRAINT unique_permission UNIQUE(resource, action)
);

-- Role permissions junction table (alternative to JSONB)
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    granted_by INTEGER REFERENCES users(id),
    PRIMARY KEY (role_id, permission_id)
);

-- Audit log for permission changes
CREATE TABLE IF NOT EXISTS rbac_audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id INTEGER,
    old_value JSONB,
    new_value JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default roles
INSERT INTO roles (name, description, permissions, is_system) VALUES
    ('admin', 'Full system access', '["*"]', true),
    ('analyst', 'Read and analyze data, create reports', '["documents:read", "documents:search", "reports:create", "reports:read"]', true),
    ('researcher', 'Search and export data', '["documents:read", "documents:search", "documents:export"]', true),
    ('reviewer', 'Review and approve content', '["documents:read", "documents:update", "documents:approve", "visibility:manage"]', true),
    ('viewer', 'Read-only access', '["documents:read"]', true)
ON CONFLICT (name) DO NOTHING;

-- Insert default permissions
INSERT INTO permissions (resource, action, description) VALUES
    ('documents', 'create', 'Create new documents'),
    ('documents', 'read', 'View documents'),
    ('documents', 'update', 'Update existing documents'),
    ('documents', 'delete', 'Delete documents'),
    ('documents', 'search', 'Search documents'),
    ('documents', 'export', 'Export documents'),
    ('documents', 'approve', 'Approve document changes'),
    ('visibility', 'manage', 'Manage document visibility'),
    ('sources', 'create', 'Create data sources'),
    ('sources', 'read', 'View data sources'),
    ('sources', 'update', 'Update data sources'),
    ('sources', 'delete', 'Delete data sources'),
    ('users', 'create', 'Create users'),
    ('users', 'read', 'View users'),
    ('users', 'update', 'Update users'),
    ('users', 'delete', 'Delete users'),
    ('roles', 'manage', 'Manage roles and permissions'),
    ('reports', 'create', 'Create reports'),
    ('reports', 'read', 'View reports'),
    ('api_keys', 'manage', 'Manage API keys'),
    ('system', 'admin', 'System administration')
ON CONFLICT (resource, action) DO NOTHING;

-- Helper function to check permissions
CREATE OR REPLACE FUNCTION check_permission(
    p_user_id INTEGER,
    p_resource VARCHAR,
    p_action VARCHAR
) RETURNS BOOLEAN AS $$
DECLARE
    v_permissions JSONB;
    v_permission_string VARCHAR;
BEGIN
    -- Get user's role permissions
    SELECT r.permissions INTO v_permissions
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.id = p_user_id AND u.is_active = TRUE;
    
    IF v_permissions IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check for wildcard permission
    IF v_permissions ? '*' THEN
        RETURN TRUE;
    END IF;
    
    -- Check for specific permission
    v_permission_string := p_resource || ':' || p_action;
    IF v_permissions ? v_permission_string THEN
        RETURN TRUE;
    END IF;
    
    -- Check for resource wildcard
    v_permission_string := p_resource || ':*';
    IF v_permissions ? v_permission_string THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function for API key rotation
CREATE OR REPLACE FUNCTION rotate_api_key(
    p_old_key_id INTEGER,
    p_new_key_hash VARCHAR,
    p_new_key_prefix VARCHAR,
    p_grace_period_minutes INTEGER DEFAULT 60
) RETURNS INTEGER AS $$
DECLARE
    v_new_key_id INTEGER;
    v_user_id INTEGER;
BEGIN
    -- Get user from old key
    SELECT user_id INTO v_user_id
    FROM api_keys
    WHERE id = p_old_key_id AND is_active = TRUE;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Invalid or inactive API key';
    END IF;
    
    -- Create new key
    INSERT INTO api_keys (user_id, key_hash, key_prefix, rotated_from, name)
    SELECT user_id, p_new_key_hash, p_new_key_prefix, id, name || ' (rotated)'
    FROM api_keys
    WHERE id = p_old_key_id
    RETURNING id INTO v_new_key_id;
    
    -- Set expiration on old key (grace period)
    UPDATE api_keys
    SET expires_at = NOW() + (p_grace_period_minutes || ' minutes')::INTERVAL,
        rotated_at = NOW()
    WHERE id = p_old_key_id;
    
    RETURN v_new_key_id;
END;
$$ LANGUAGE plpgsql;

-- Add migration record
INSERT INTO schema_migrations (version, name)
VALUES ('0006', 'add_rbac_system')
ON CONFLICT (version) DO NOTHING;

COMMIT;