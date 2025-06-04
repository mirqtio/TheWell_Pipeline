-- Migration: Consolidate visibility schema
-- Date: 2025-01-06
-- Description: Aligns visibility tables between ORM and raw SQL implementations

BEGIN;

-- First, ensure we have the comprehensive visibility tables
-- Document visibility states table
CREATE TABLE IF NOT EXISTS document_visibility_new (
    id SERIAL PRIMARY KEY,
    document_id VARCHAR(255) NOT NULL UNIQUE,
    visibility VARCHAR(50) NOT NULL CHECK (visibility IN ('internal', 'external', 'restricted', 'public', 'private', 'draft', 'archived')),
    previous_visibility VARCHAR(50),
    set_by VARCHAR(255) NOT NULL,
    set_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migrate data from old document_visibility table if it exists differently
DO $$
BEGIN
    -- Check if the old table has different structure
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'document_visibility' 
        AND column_name = 'visibility_level'
    ) THEN
        -- Migrate data from old structure
        INSERT INTO document_visibility_new (
            document_id, 
            visibility, 
            previous_visibility,
            set_by,
            set_at,
            reason,
            metadata,
            created_at,
            updated_at
        )
        SELECT 
            document_id,
            COALESCE(visibility_level, 'internal'),
            NULL,
            COALESCE(approved_by, set_by, 'system'),
            COALESCE(approved_at, created_at),
            reason,
            metadata,
            created_at,
            updated_at
        FROM document_visibility
        ON CONFLICT (document_id) DO NOTHING;
        
        -- Drop old table
        DROP TABLE document_visibility CASCADE;
    END IF;
END $$;

-- Rename new table to document_visibility
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_visibility_new') THEN
        -- Drop old table if exists
        DROP TABLE IF EXISTS document_visibility CASCADE;
        -- Rename new table
        ALTER TABLE document_visibility_new RENAME TO document_visibility;
    END IF;
END $$;

-- Create indexes for document_visibility
CREATE INDEX IF NOT EXISTS idx_document_visibility_document_id ON document_visibility (document_id);
CREATE INDEX IF NOT EXISTS idx_document_visibility_visibility ON document_visibility (visibility);
CREATE INDEX IF NOT EXISTS idx_document_visibility_set_by ON document_visibility (set_by);
CREATE INDEX IF NOT EXISTS idx_document_visibility_set_at ON document_visibility (set_at);

-- Create indexes for visibility_approvals
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_approval_id ON visibility_approvals (approval_id);
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_document_id ON visibility_approvals (document_id);
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_status ON visibility_approvals (status);
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_requested_by ON visibility_approvals (requested_by);
CREATE INDEX IF NOT EXISTS idx_visibility_approvals_requested_at ON visibility_approvals (requested_at);

-- Add foreign key constraints
ALTER TABLE document_visibility 
    ADD CONSTRAINT fk_document_visibility_document 
    FOREIGN KEY (document_id) 
    REFERENCES documents(id) 
    ON DELETE CASCADE;

ALTER TABLE visibility_approvals 
    ADD CONSTRAINT fk_visibility_approvals_document 
    FOREIGN KEY (document_id) 
    REFERENCES documents(id) 
    ON DELETE CASCADE;

-- Create or update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_document_visibility_updated_at 
    BEFORE UPDATE ON document_visibility 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_visibility_approvals_updated_at 
    BEFORE UPDATE ON visibility_approvals 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Remove visibility column from documents table if we're using separate visibility table
-- Only do this if all documents have visibility records
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'documents' 
        AND column_name = 'visibility'
    ) THEN
        -- Ensure all documents have visibility records
        INSERT INTO document_visibility (document_id, visibility, set_by, reason)
        SELECT id, COALESCE(visibility, 'internal'), 'migration', 'Migrated from documents table'
        FROM documents
        WHERE NOT EXISTS (
            SELECT 1 FROM document_visibility dv WHERE dv.document_id = documents.id::varchar
        );
        
        -- Now we can safely drop the column
        -- ALTER TABLE documents DROP COLUMN visibility;
        -- Note: Commented out for safety - uncomment after verifying migration
    END IF;
END $$;

COMMIT;