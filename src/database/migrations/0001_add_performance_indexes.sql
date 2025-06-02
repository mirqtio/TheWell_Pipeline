-- Migration: Add Performance Indexes
-- Version: 0001
-- Created: 2025-06-02T11:51:00.000Z

-- Forward migration
-- Add performance-critical indexes for common query patterns

-- Index for document visibility filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_visibility_created_at 
ON documents(visibility, created_at DESC);

-- Index for metadata JSONB queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_metadata_gin 
ON documents USING gin(metadata);

-- Index for full-text search on title and content
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_fulltext 
ON documents USING gin(to_tsvector('english', title || ' ' || COALESCE(content, '')));

-- Index for source-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_source_id_created_at 
ON documents(source_id, created_at DESC);

-- Index for hash-based deduplication
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_hash 
ON documents(hash) WHERE hash IS NOT NULL;

-- Index for embedding similarity searches (if using pgvector)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_embedding_cosine 
ON documents USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100) WHERE embedding IS NOT NULL;

-- Index for quality and believability filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_quality_scores 
ON documents(quality_score, believability_score) 
WHERE quality_score IS NOT NULL OR believability_score IS NOT NULL;

-- Index for enrichment status tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_enrichment_status 
ON documents((metadata->>'enrichment_status'), updated_at);

-- Composite index for common filtering patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_visibility_quality_created 
ON documents(visibility, quality_score, created_at DESC) 
WHERE quality_score IS NOT NULL;

-- ROLLBACK
-- Remove performance indexes

DROP INDEX CONCURRENTLY IF EXISTS idx_documents_visibility_created_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_metadata_gin;
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_fulltext;
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_source_id_created_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_hash;
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_embedding_cosine;
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_quality_scores;
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_enrichment_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_visibility_quality_created;
