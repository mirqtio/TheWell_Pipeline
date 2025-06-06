-- Document Visibility Management Schema
-- Supports document visibility states, access controls, and approval workflows

-- Document visibility states table
CREATE TABLE IF NOT EXISTS document_visibility (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) NOT NULL,
    visibility VARCHAR(50) NOT NULL CHECK (visibility IN ('internal', 'external', 'restricted', 'public', 'draft', 'archived')),
    previous_visibility VARCHAR(50),
    set_by VARCHAR(255) NOT NULL,
    set_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for document_visibility
CREATE INDEX IF NOT EXISTS idx_document_visibility_document_id ON document_visibility (document_id);
CREATE INDEX IF NOT EXISTS idx_document_visibility_visibility ON document_visibility (visibility);
CREATE INDEX IF NOT EXISTS idx_document_visibility_set_by ON document_visibility (set_by);
CREATE INDEX IF NOT EXISTS idx_document_visibility_set_at ON document_visibility (set_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_visibility_unique_doc ON document_visibility (document_id);

-- Visibility approval requests table
CREATE TABLE IF NOT EXISTS visibility_approvals (
    id SERIAL PRIMARY KEY,
    approval_id VARCHAR(255) NOT NULL UNIQUE,
    document_id VARCHAR(255) NOT NULL,
    requested_visibility VARCHAR(50) NOT NULL,
    current_visibility VARCHAR(50),
    requested_by VARCHAR(255) NOT NULL,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    
    -- Approval details
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for visibility_approvals
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_approval_id ON visibility_approvals (approval_id);
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_document_id ON visibility_approvals (document_id);
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_status ON visibility_approvals (status);
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_requested_by ON visibility_approvals (requested_by);
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_requested_at ON visibility_approvals (requested_at);

-- Visibility rules table
-- CREATE TABLE IF NOT EXISTS visibility_rules (
--     id SERIAL PRIMARY KEY,
--     rule_id VARCHAR(255) NOT NULL UNIQUE,
--     name VARCHAR(255) NOT NULL,
--     description TEXT,
--     conditions JSONB NOT NULL,
--     target_visibility VARCHAR(50) NOT NULL,
--     priority INTEGER DEFAULT 0,
--     active BOOLEAN DEFAULT true,
--     created_by VARCHAR(255) NOT NULL,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- Indexes for visibility_rules
-- CREATE INDEX IF NOT EXISTS idx_visibility_rules_rule_id ON visibility_rules (rule_id);
-- CREATE INDEX IF NOT EXISTS idx_visibility_rules_active ON visibility_rules (active);
-- CREATE INDEX IF NOT EXISTS idx_visibility_rules_priority ON visibility_rules (priority);
-- CREATE INDEX IF NOT EXISTS idx_visibility_rules_target_visibility ON visibility_rules (target_visibility);

-- User permissions table
CREATE TABLE IF NOT EXISTS user_permissions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    role VARCHAR(100) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]',
    visibility_levels JSONB NOT NULL DEFAULT '[]',
    granted_by VARCHAR(255),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for user_permissions
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_role ON user_permissions (role);
CREATE INDEX IF NOT EXISTS idx_user_permissions_active ON user_permissions (active);
CREATE INDEX IF NOT EXISTS idx_user_permissions_expires_at ON user_permissions (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_permissions_unique ON user_permissions (user_id, role);

-- Visibility change audit log
CREATE TABLE IF NOT EXISTS visibility_audit_log (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('visibility_changed', 'approval_requested', 'approval_granted', 'approval_rejected', 'rule_applied')),
    old_visibility VARCHAR(50),
    new_visibility VARCHAR(50),
    changed_by VARCHAR(255) NOT NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    approval_id VARCHAR(255),
    rule_id VARCHAR(255),
    metadata JSONB DEFAULT '{}'
);

-- Indexes for visibility_audit_log
CREATE INDEX IF NOT EXISTS idx_visibility_audit_document_id ON visibility_audit_log (document_id);
CREATE INDEX IF NOT EXISTS idx_visibility_audit_action ON visibility_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_visibility_audit_changed_by ON visibility_audit_log (changed_by);
CREATE INDEX IF NOT EXISTS idx_visibility_audit_changed_at ON visibility_audit_log (changed_at);
CREATE INDEX IF NOT EXISTS idx_visibility_audit_approval_id ON visibility_audit_log (approval_id);

-- Document access log (for compliance and monitoring)
CREATE TABLE IF NOT EXISTS document_access_log (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    access_type VARCHAR(50) NOT NULL CHECK (access_type IN ('read', 'write', 'download', 'share')),
    access_granted BOOLEAN NOT NULL,
    document_visibility VARCHAR(50),
    user_permissions JSONB,
    accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Indexes for document_access_log
CREATE INDEX IF NOT EXISTS idx_document_access_document_id ON document_access_log (document_id);
CREATE INDEX IF NOT EXISTS idx_document_access_user_id ON document_access_log (user_id);
CREATE INDEX IF NOT EXISTS idx_document_access_type ON document_access_log (access_type);
CREATE INDEX IF NOT EXISTS idx_document_access_granted ON document_access_log (access_granted);
CREATE INDEX IF NOT EXISTS idx_document_access_accessed_at ON document_access_log (accessed_at);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_document_visibility_updated_at ON document_visibility;
CREATE TRIGGER update_document_visibility_updated_at 
    BEFORE UPDATE ON document_visibility 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_visibility_approvals_updated_at ON visibility_approvals;
CREATE TRIGGER update_visibility_approvals_updated_at 
    BEFORE UPDATE ON visibility_approvals 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- DROP TRIGGER IF EXISTS update_visibility_rules_updated_at ON visibility_rules;
-- CREATE TRIGGER update_visibility_rules_updated_at 
--     BEFORE UPDATE ON visibility_rules 
--     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_permissions_updated_at ON user_permissions;
CREATE TRIGGER update_user_permissions_updated_at 
    BEFORE UPDATE ON user_permissions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default visibility rules
-- INSERT INTO visibility_rules (rule_id, name, description, conditions, target_visibility, priority, created_by) VALUES
-- ('rule_internal_default', 'Internal Default', 'Default visibility for all documents', '{}', 'internal', 0, 'system'),
-- ('rule_external_policy', 'External Policy Documents', 'Policy documents should be external by default', '{"sourceType": "policy", "fileType": "pdf"}', 'external', 10, 'system'),
-- ('rule_sensitive_restricted', 'Sensitive Content Restricted', 'Documents tagged as sensitive should be restricted', '{"tags": ["sensitive", "confidential"]}', 'restricted', 20, 'system')
-- ON CONFLICT (rule_id) DO NOTHING;

-- Insert default user permissions
INSERT INTO user_permissions (user_id, role, permissions, visibility_levels, granted_by) VALUES
('system', 'admin', '["read", "write", "admin", "approve"]', '["internal", "external", "restricted", "public", "draft", "archived"]', 'system'),
('reviewer', 'reviewer', '["read", "write", "approve"]', '["internal", "external"]', 'system'),
('user', 'user', '["read"]', '["internal"]', 'system')
ON CONFLICT (user_id, role) DO NOTHING;
