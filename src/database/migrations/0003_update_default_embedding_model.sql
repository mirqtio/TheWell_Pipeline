-- Migration: Update default embedding model from text-embedding-ada-002 to text-embedding-3-small
-- Date: 2025-01-06
-- Description: Updates the default embedding model to use OpenAI's newer and more cost-effective model

-- Update the default value for the embedding_model column
ALTER TABLE documents 
ALTER COLUMN embedding_model SET DEFAULT 'text-embedding-3-small';

-- Note: This migration only changes the default for new documents
-- Existing documents will retain their current embedding model
-- If you need to regenerate embeddings for existing documents, run a separate batch process

-- Add index on embedding_model for faster queries filtering by model
CREATE INDEX IF NOT EXISTS idx_documents_embedding_model ON documents(embedding_model);

-- Record migration metadata
INSERT INTO schema_migrations (version, applied_at) 
VALUES ('0003_update_default_embedding_model', NOW())
ON CONFLICT (version) DO NOTHING;