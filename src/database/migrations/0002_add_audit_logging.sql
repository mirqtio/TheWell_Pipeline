-- Migration: Add Audit Logging
-- Version: 0002
-- Created: 2025-06-02T11:51:00.000Z

-- Forward migration
-- Add comprehensive audit logging for security and compliance

-- Create audit log table
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(10) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],
    user_id VARCHAR(255),
    session_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for audit log queries
CREATE INDEX idx_audit_log_table_operation ON audit_log(table_name, operation);
CREATE INDEX idx_audit_log_record_id ON audit_log(record_id);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);

-- Create audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
DECLARE
    old_data JSONB;
    new_data JSONB;
    changed_fields TEXT[] := ARRAY[]::TEXT[];
    field_name TEXT;
BEGIN
    -- Determine operation type and data
    IF TG_OP = 'DELETE' THEN
        old_data := to_jsonb(OLD);
        new_data := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
        
        -- Identify changed fields
        FOR field_name IN SELECT jsonb_object_keys(old_data) LOOP
            IF old_data->field_name IS DISTINCT FROM new_data->field_name THEN
                changed_fields := array_append(changed_fields, field_name);
            END IF;
        END LOOP;
    ELSIF TG_OP = 'INSERT' THEN
        old_data := NULL;
        new_data := to_jsonb(NEW);
    END IF;

    -- Insert audit record
    INSERT INTO audit_log (
        table_name,
        operation,
        record_id,
        old_values,
        new_values,
        changed_fields,
        user_id,
        session_id,
        ip_address
    ) VALUES (
        TG_TABLE_NAME,
        TG_OP,
        COALESCE(NEW.id, OLD.id),
        old_data,
        new_data,
        changed_fields,
        current_setting('app.current_user_id', true),
        current_setting('app.current_session_id', true),
        current_setting('app.current_ip_address', true)::INET
    );

    -- Return appropriate record
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create audit triggers for critical tables
CREATE TRIGGER audit_documents_trigger
    AFTER INSERT OR UPDATE OR DELETE ON documents
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_sources_trigger
    AFTER INSERT OR UPDATE OR DELETE ON sources
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_document_visibility_trigger
    AFTER INSERT OR UPDATE OR DELETE ON document_visibility
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Create view for audit log analysis
CREATE VIEW audit_summary AS
SELECT 
    table_name,
    operation,
    COUNT(*) as operation_count,
    COUNT(DISTINCT user_id) as unique_users,
    MIN(timestamp) as first_operation,
    MAX(timestamp) as last_operation
FROM audit_log
GROUP BY table_name, operation
ORDER BY table_name, operation;

-- Create function to clean old audit logs
CREATE OR REPLACE FUNCTION clean_old_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audit_log 
    WHERE timestamp < NOW() - INTERVAL '1 day' * retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ROLLBACK
-- Remove audit logging infrastructure

DROP TRIGGER IF EXISTS audit_documents_trigger ON documents;
DROP TRIGGER IF EXISTS audit_sources_trigger ON sources;
DROP TRIGGER IF EXISTS audit_document_visibility_trigger ON document_visibility;

DROP FUNCTION IF EXISTS audit_trigger_function();
DROP FUNCTION IF EXISTS clean_old_audit_logs(INTEGER);

DROP VIEW IF EXISTS audit_summary;

DROP TABLE IF EXISTS audit_log;
