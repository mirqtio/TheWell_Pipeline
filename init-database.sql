-- Complete database initialization script for TheWell Pipeline
-- This ensures all extensions, schemas, and tables are created properly

-- Create extensions first
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Try to create vector extension (may not be available)
DO $$ 
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'vector extension not available, continuing without it';
END $$;

-- Create the update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Now source the main schemas
-- These will be applied by the Docker entrypoint