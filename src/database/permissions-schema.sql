-- Permission Enforcement System Schema
-- Comprehensive document-level access control

-- =====================================================
-- USER AND ROLE MANAGEMENT
-- =====================================================

-- Users: Core user management
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255), -- For local authentication
    external_id VARCHAR(255), -- For external auth systems (SSO, OAuth)
    auth_provider VARCHAR(50) DEFAULT 'local', -- 'local', 'oauth', 'saml', 'ldap'
    
    -- User metadata
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    department VARCHAR(255),
    organization VARCHAR(255),
    
    -- Status and settings
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive', 'suspended', 'pending'
    email_verified BOOLEAN DEFAULT false,
    last_login_at TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Roles: Define user roles with hierarchical structure
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Role hierarchy
    parent_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    level INTEGER DEFAULT 0, -- 0 = highest level (admin), higher numbers = lower privileges
    
    -- Role configuration
    is_system_role BOOLEAN DEFAULT false, -- System-defined roles that cannot be deleted
    is_default BOOLEAN DEFAULT false, -- Default role for new users
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Roles: Many-to-many relationship between users and roles
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    
    -- Assignment metadata
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE, -- Optional role expiration
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    UNIQUE(user_id, role_id)
);

-- =====================================================
-- PERMISSION SYSTEM
-- =====================================================

-- Permissions: Define granular permissions
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Permission categorization
    category VARCHAR(50) NOT NULL, -- 'document', 'source', 'system', 'admin'
    resource_type VARCHAR(50), -- 'document', 'source', 'user', 'role', etc.
    action VARCHAR(50) NOT NULL, -- 'read', 'write', 'delete', 'approve', 'admin'
    
    -- Permission configuration
    is_system_permission BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Role Permissions: Assign permissions to roles
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    
    -- Permission scope (optional resource-specific permissions)
    resource_id UUID, -- Can reference documents, sources, etc.
    resource_type VARCHAR(50), -- Type of resource being granted permission to
    
    -- Assignment metadata
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(role_id, permission_id, resource_id)
);

-- User Permissions: Direct user permissions (overrides role permissions)
CREATE TABLE IF NOT EXISTS user_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    
    -- Permission scope
    resource_id UUID,
    resource_type VARCHAR(50),
    
    -- Grant or deny (allows for explicit denials)
    is_granted BOOLEAN DEFAULT true,
    
    -- Assignment metadata
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(user_id, permission_id, resource_id)
);

-- =====================================================
-- DOCUMENT ACCESS CONTROL
-- =====================================================

-- Document Access Policies: Define access rules for documents
CREATE TABLE IF NOT EXISTS document_access_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Access control configuration
    access_level VARCHAR(20) DEFAULT 'restricted', -- 'public', 'internal', 'restricted', 'private'
    requires_approval BOOLEAN DEFAULT false,
    
    -- Ownership
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Classification
    classification VARCHAR(50), -- 'public', 'internal', 'confidential', 'secret'
    sensitivity_level INTEGER DEFAULT 1, -- 1-5 scale
    
    -- Access restrictions
    allowed_roles JSONB DEFAULT '[]', -- Array of role IDs that can access
    denied_roles JSONB DEFAULT '[]', -- Array of role IDs explicitly denied
    allowed_users JSONB DEFAULT '[]', -- Array of user IDs that can access
    denied_users JSONB DEFAULT '[]', -- Array of user IDs explicitly denied
    
    -- Geographic and time-based restrictions
    allowed_countries JSONB DEFAULT '[]', -- ISO country codes
    allowed_ip_ranges JSONB DEFAULT '[]', -- CIDR blocks
    access_start_time TIME, -- Daily access window start
    access_end_time TIME, -- Daily access window end
    access_timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Audit trail
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    access_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(document_id)
);

-- Document Access Grants: Explicit access grants for documents
CREATE TABLE IF NOT EXISTS document_access_grants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Grantee (user or role)
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    
    -- Grant details
    permission_type VARCHAR(50) NOT NULL, -- 'read', 'write', 'admin'
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Grant conditions
    conditions JSONB DEFAULT '{}', -- Additional access conditions
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revoke_reason TEXT,
    
    -- Ensure either user_id or role_id is set, but not both
    CONSTRAINT check_grantee CHECK (
        (user_id IS NOT NULL AND role_id IS NULL) OR 
        (user_id IS NULL AND role_id IS NOT NULL)
    )
);

-- =====================================================
-- SOURCE ACCESS CONTROL
-- =====================================================

-- Source Access Policies: Control access to data sources
CREATE TABLE source_access_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
    
    -- Access configuration
    access_level VARCHAR(20) DEFAULT 'internal', -- 'public', 'internal', 'restricted'
    requires_approval BOOLEAN DEFAULT false,
    
    -- Ownership
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Access control lists
    allowed_roles JSONB DEFAULT '[]',
    denied_roles JSONB DEFAULT '[]',
    allowed_users JSONB DEFAULT '[]',
    denied_users JSONB DEFAULT '[]',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(source_id)
);

-- =====================================================
-- AUDIT AND LOGGING
-- =====================================================

-- Access Logs: Track all access attempts
CREATE TABLE access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- User and session info
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    
    -- Access details
    resource_type VARCHAR(50) NOT NULL, -- 'document', 'source', 'api'
    resource_id UUID,
    action VARCHAR(50) NOT NULL, -- 'read', 'write', 'delete', 'search'
    
    -- Request details
    endpoint VARCHAR(255),
    method VARCHAR(10),
    query_params JSONB,
    request_body JSONB,
    
    -- Response details
    status_code INTEGER,
    response_time_ms INTEGER,
    access_granted BOOLEAN NOT NULL,
    denial_reason TEXT,
    
    -- Context
    trace_id VARCHAR(255),
    correlation_id VARCHAR(255),
    
    -- Timestamp
    accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Permission Checks: Cache permission check results for performance
CREATE TABLE permission_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Check parameters
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission_name VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    
    -- Check result
    is_granted BOOLEAN NOT NULL,
    check_reason TEXT,
    
    -- Caching
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '1 hour',
    
    -- Create unique constraint for caching
    UNIQUE(user_id, permission_name, resource_type, resource_id)
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Role indexes
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_roles_parent_role_id ON roles(parent_role_id);
CREATE INDEX IF NOT EXISTS idx_roles_level ON roles(level);

-- User roles indexes
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(is_active);

-- Permission indexes
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);
CREATE INDEX IF NOT EXISTS idx_permissions_resource_type ON permissions(resource_type);

-- Role permissions indexes
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_resource ON role_permissions(resource_type, resource_id);

-- User permissions indexes
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_permission_id ON user_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_resource ON user_permissions(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_granted ON user_permissions(is_granted);

-- Document access policy indexes
CREATE INDEX IF NOT EXISTS idx_document_access_policies_document_id ON document_access_policies(document_id);
CREATE INDEX IF NOT EXISTS idx_document_access_policies_access_level ON document_access_policies(access_level);
CREATE INDEX IF NOT EXISTS idx_document_access_policies_owner_id ON document_access_policies(owner_id);
CREATE INDEX IF NOT EXISTS idx_document_access_policies_classification ON document_access_policies(classification);

-- Document access grants indexes
CREATE INDEX IF NOT EXISTS idx_document_access_grants_document_id ON document_access_grants(document_id);
CREATE INDEX IF NOT EXISTS idx_document_access_grants_user_id ON document_access_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_document_access_grants_role_id ON document_access_grants(role_id);
CREATE INDEX IF NOT EXISTS idx_document_access_grants_active ON document_access_grants(is_active);
CREATE INDEX IF NOT EXISTS idx_document_access_grants_expires ON document_access_grants(expires_at);

-- Source access policy indexes
CREATE INDEX IF NOT EXISTS idx_source_access_policies_source_id ON source_access_policies(source_id);
CREATE INDEX IF NOT EXISTS idx_source_access_policies_access_level ON source_access_policies(access_level);

-- Access logs indexes
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_resource ON access_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_accessed_at ON access_logs(accessed_at);
CREATE INDEX IF NOT EXISTS idx_access_logs_access_granted ON access_logs(access_granted);
CREATE INDEX IF NOT EXISTS idx_access_logs_trace_id ON access_logs(trace_id);

-- Permission checks indexes
CREATE INDEX IF NOT EXISTS idx_permission_checks_user_id ON permission_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_permission_checks_expires_at ON permission_checks(expires_at);

-- =====================================================
-- TRIGGERS AND FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_permissions_updated_at BEFORE UPDATE ON permissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_document_access_policies_updated_at BEFORE UPDATE ON document_access_policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_source_access_policies_updated_at BEFORE UPDATE ON source_access_policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired permission checks
CREATE OR REPLACE FUNCTION cleanup_expired_permission_checks()
RETURNS void AS $$
BEGIN
    DELETE FROM permission_checks WHERE expires_at < NOW();
END;
$$ language 'plpgsql';

-- =====================================================
-- DEFAULT DATA
-- =====================================================

-- Insert default system roles
INSERT INTO roles (name, display_name, description, level, is_system_role, is_default) VALUES
('admin', 'Administrator', 'Full system access with all permissions', 0, true, false),
('manager', 'Manager', 'Management access with elevated permissions', 1, true, false),
('editor', 'Editor', 'Content editing and management permissions', 2, true, false),
('reviewer', 'Reviewer', 'Content review and approval permissions', 2, true, false),
('user', 'Standard User', 'Basic read access to permitted content', 3, true, true),
('guest', 'Guest User', 'Limited read-only access to public content', 4, true, false);

-- Insert default system permissions
INSERT INTO permissions (name, display_name, description, category, resource_type, action, is_system_permission) VALUES
-- Document permissions
('document.read', 'Read Documents', 'View and search documents', 'document', 'document', 'read', true),
('document.write', 'Write Documents', 'Create and edit documents', 'document', 'document', 'write', true),
('document.delete', 'Delete Documents', 'Delete documents', 'document', 'document', 'delete', true),
('document.approve', 'Approve Documents', 'Approve documents for publication', 'document', 'document', 'approve', true),
('document.admin', 'Administer Documents', 'Full document administration', 'document', 'document', 'admin', true),

-- Source permissions
('source.read', 'Read Sources', 'View source configurations', 'source', 'source', 'read', true),
('source.write', 'Write Sources', 'Create and edit sources', 'source', 'source', 'write', true),
('source.delete', 'Delete Sources', 'Delete sources', 'source', 'source', 'delete', true),
('source.admin', 'Administer Sources', 'Full source administration', 'source', 'source', 'admin', true),

-- System permissions
('system.admin', 'System Administration', 'Full system administration access', 'system', 'system', 'admin', true),
('system.monitor', 'System Monitoring', 'View system metrics and logs', 'system', 'system', 'read', true),
('system.config', 'System Configuration', 'Modify system configuration', 'system', 'system', 'write', true),

-- User management permissions
('user.read', 'Read Users', 'View user information', 'admin', 'user', 'read', true),
('user.write', 'Write Users', 'Create and edit users', 'admin', 'user', 'write', true),
('user.delete', 'Delete Users', 'Delete users', 'admin', 'user', 'delete', true),
('user.admin', 'Administer Users', 'Full user administration', 'admin', 'user', 'admin', true),

-- Role management permissions
('role.read', 'Read Roles', 'View role information', 'admin', 'role', 'read', true),
('role.write', 'Write Roles', 'Create and edit roles', 'admin', 'role', 'write', true),
('role.delete', 'Delete Roles', 'Delete roles', 'admin', 'role', 'delete', true),
('role.admin', 'Administer Roles', 'Full role administration', 'admin', 'role', 'admin', true);

-- Assign permissions to default roles
-- Admin role gets all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin';

-- Manager role gets most permissions except system admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager' 
AND p.name NOT IN ('system.admin', 'user.delete', 'role.delete');

-- Editor role gets document and source permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'editor' 
AND p.category IN ('document', 'source')
AND p.action != 'delete';

-- Reviewer role gets read and approve permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'reviewer' 
AND (p.action IN ('read', 'approve') OR p.name = 'system.monitor');

-- User role gets basic read permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' 
AND p.action = 'read'
AND p.category IN ('document', 'source');

-- Guest role gets only document read permission
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'guest' 
AND p.name = 'document.read';
