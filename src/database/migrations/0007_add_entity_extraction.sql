-- Migration: Add entity extraction tables
-- Description: Creates tables for storing extracted entities from documents

BEGIN;

-- Entity types enum
CREATE TYPE entity_type AS ENUM (
  'PERSON',
  'ORGANIZATION', 
  'LOCATION',
  'DATE',
  'TIME',
  'EMAIL',
  'URL', 
  'MONEY',
  'PHONE',
  'CUSTOM'
);

-- Main extracted entities table
CREATE TABLE IF NOT EXISTS extracted_entities (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity_type entity_type NOT NULL,
  entity_text TEXT NOT NULL,
  entity_value JSONB, -- Additional structured data (e.g., parsed date, money amount)
  confidence DECIMAL(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_extracted_entities_document (document_id),
  INDEX idx_extracted_entities_type (entity_type),
  INDEX idx_extracted_entities_text (entity_text),
  INDEX idx_extracted_entities_confidence (confidence),
  INDEX idx_extracted_entities_created (created_at DESC)
);

-- Entity extraction jobs tracking
CREATE TABLE IF NOT EXISTS entity_extraction_jobs (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  entity_counts JSONB DEFAULT '{}', -- Count of each entity type found
  error_message TEXT,
  processing_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_extraction_jobs_document (document_id),
  INDEX idx_extraction_jobs_status (status),
  INDEX idx_extraction_jobs_created (created_at DESC)
);

-- Entity relationships (for linking related entities)
CREATE TABLE IF NOT EXISTS entity_relationships (
  id SERIAL PRIMARY KEY,
  source_entity_id INTEGER NOT NULL REFERENCES extracted_entities(id) ON DELETE CASCADE,
  target_entity_id INTEGER NOT NULL REFERENCES extracted_entities(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL,
  confidence DECIMAL(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Prevent duplicate relationships
  UNIQUE(source_entity_id, target_entity_id, relationship_type),
  
  -- Indexes
  INDEX idx_entity_relationships_source (source_entity_id),
  INDEX idx_entity_relationships_target (target_entity_id),
  INDEX idx_entity_relationships_type (relationship_type)
);

-- Custom entity patterns
CREATE TABLE IF NOT EXISTS custom_entity_patterns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  pattern TEXT NOT NULL, -- Regular expression pattern
  entity_type VARCHAR(50) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_custom_patterns_active (is_active),
  INDEX idx_custom_patterns_type (entity_type)
);

-- Entity statistics view
CREATE VIEW entity_statistics AS
SELECT 
  d.id AS document_id,
  d.title AS document_title,
  ee.entity_type,
  COUNT(*) AS entity_count,
  AVG(ee.confidence) AS avg_confidence,
  MIN(ee.created_at) AS first_extracted,
  MAX(ee.created_at) AS last_extracted
FROM documents d
LEFT JOIN extracted_entities ee ON d.id = ee.document_id
GROUP BY d.id, d.title, ee.entity_type;

-- Function to get top entities by type
CREATE OR REPLACE FUNCTION get_top_entities(
  p_entity_type entity_type,
  p_limit INTEGER DEFAULT 10,
  p_min_confidence DECIMAL DEFAULT 0.7
)
RETURNS TABLE (
  entity_text TEXT,
  occurrence_count BIGINT,
  avg_confidence DECIMAL,
  document_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ee.entity_text,
    COUNT(*) AS occurrence_count,
    AVG(ee.confidence) AS avg_confidence,
    COUNT(DISTINCT ee.document_id) AS document_count
  FROM extracted_entities ee
  WHERE ee.entity_type = p_entity_type
    AND ee.confidence >= p_min_confidence
  GROUP BY ee.entity_text
  ORDER BY occurrence_count DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to extract entities from new documents
CREATE OR REPLACE FUNCTION trigger_entity_extraction()
RETURNS TRIGGER AS $$
BEGIN
  -- Create a pending extraction job for new documents
  IF TG_OP = 'INSERT' THEN
    INSERT INTO entity_extraction_jobs (document_id, status)
    VALUES (NEW.id, 'pending');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically queue entity extraction
CREATE TRIGGER document_entity_extraction_trigger
AFTER INSERT ON documents
FOR EACH ROW
EXECUTE FUNCTION trigger_entity_extraction();

-- Updated_at trigger for extraction jobs
CREATE TRIGGER update_extraction_jobs_updated_at
BEFORE UPDATE ON entity_extraction_jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for custom patterns
CREATE TRIGGER update_custom_patterns_updated_at
BEFORE UPDATE ON custom_entity_patterns
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE extracted_entities IS 'Stores entities extracted from documents';
COMMENT ON TABLE entity_extraction_jobs IS 'Tracks entity extraction processing jobs';
COMMENT ON TABLE entity_relationships IS 'Stores relationships between extracted entities';
COMMENT ON TABLE custom_entity_patterns IS 'User-defined patterns for custom entity extraction';
COMMENT ON VIEW entity_statistics IS 'Aggregated statistics for extracted entities';

COMMIT;