-- Migration: Add Intelligent Search Tables and Indexes
-- This migration adds support for intelligent search functionality including
-- search indexes, query history, search analytics, and enhanced full-text search

-- =====================================================
-- SEARCH INDEXES TABLE
-- =====================================================

-- Search Indexes: Stores pre-computed search indexes for documents
CREATE TABLE search_indexes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Searchable content fields
    title_tokens TSVECTOR,
    content_tokens TSVECTOR,
    summary_tokens TSVECTOR,
    
    -- Metadata for filtering
    author_normalized TEXT,
    tags TEXT[],
    categories TEXT[],
    entities JSONB, -- Extracted entities with types
    
    -- Temporal data
    published_date DATE,
    published_year INTEGER,
    published_month INTEGER,
    
    -- Quality and relevance scores
    quality_score FLOAT,
    believability_score FLOAT,
    popularity_score FLOAT DEFAULT 0, -- Based on search interactions
    
    -- Search optimization
    search_vector TSVECTOR, -- Combined search vector
    last_indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- SEARCH QUERIES TABLE
-- =====================================================

-- Search Queries: Stores user search queries for analytics and suggestions
CREATE TABLE search_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Query details
    query_text TEXT NOT NULL,
    query_type VARCHAR(50) NOT NULL, -- 'semantic', 'exact', 'fuzzy', 'hybrid'
    query_params JSONB, -- Filters, options, etc.
    
    -- Query processing
    normalized_query TEXT, -- Normalized version for matching
    query_tokens TSVECTOR, -- Tokenized query for analysis
    query_embedding vector(1536), -- Query embedding for semantic search
    
    -- Results metadata
    result_count INTEGER,
    results_returned INTEGER,
    top_result_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    execution_time_ms INTEGER,
    
    -- User interaction
    clicked_results UUID[], -- Document IDs that were clicked
    session_id VARCHAR(255),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- SEARCH ANALYTICS TABLE
-- =====================================================

-- Search Analytics: Aggregated search metrics for optimization
CREATE TABLE search_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Time dimensions
    date DATE NOT NULL,
    hour INTEGER, -- 0-23
    
    -- Query metrics
    total_queries INTEGER DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    avg_query_length FLOAT,
    
    -- Performance metrics
    avg_execution_time_ms FLOAT,
    avg_result_count FLOAT,
    zero_result_queries INTEGER DEFAULT 0,
    
    -- Engagement metrics
    click_through_rate FLOAT, -- Percentage of queries with clicks
    avg_results_clicked FLOAT,
    
    -- Popular queries (top 100)
    popular_queries JSONB, -- Array of {query, count, avg_clicks}
    
    -- Search types distribution
    search_type_distribution JSONB, -- {semantic: %, exact: %, fuzzy: %}
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(date, hour)
);

-- =====================================================
-- SEARCH SUGGESTIONS TABLE
-- =====================================================

-- Search Suggestions: Pre-computed search suggestions
CREATE TABLE search_suggestions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Suggestion details
    suggestion_text TEXT NOT NULL,
    suggestion_type VARCHAR(50) NOT NULL, -- 'query', 'completion', 'correction'
    source_query TEXT, -- Original query that led to this suggestion
    
    -- Ranking factors
    frequency INTEGER DEFAULT 1, -- How often this suggestion appears
    click_through_rate FLOAT DEFAULT 0,
    relevance_score FLOAT DEFAULT 0,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(suggestion_text, suggestion_type)
);

-- =====================================================
-- SEARCH SYNONYMS TABLE
-- =====================================================

-- Search Synonyms: Custom synonyms for query expansion
CREATE TABLE search_synonyms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Synonym mapping
    term TEXT NOT NULL,
    synonyms TEXT[] NOT NULL,
    synonym_type VARCHAR(50) DEFAULT 'bidirectional', -- 'bidirectional', 'unidirectional'
    
    -- Configuration
    weight FLOAT DEFAULT 1.0, -- Synonym weight in scoring
    context TEXT, -- Optional context for conditional synonyms
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(term)
);

-- =====================================================
-- SEARCH FACETS TABLE
-- =====================================================

-- Search Facets: Pre-computed facets for filtering
CREATE TABLE search_facets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Facet definition
    facet_name VARCHAR(100) NOT NULL,
    facet_type VARCHAR(50) NOT NULL, -- 'category', 'tag', 'author', 'date_range', 'custom'
    facet_values JSONB NOT NULL, -- Array of {value, count, label}
    
    -- Update tracking
    last_computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(facet_name)
);

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update trigger for search_indexes
CREATE TRIGGER set_search_indexes_updated_at
BEFORE UPDATE ON search_indexes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Update trigger for search_analytics
CREATE TRIGGER set_search_analytics_updated_at
BEFORE UPDATE ON search_analytics
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Update trigger for search_suggestions
CREATE TRIGGER set_search_suggestions_updated_at
BEFORE UPDATE ON search_suggestions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Update trigger for search_synonyms
CREATE TRIGGER set_search_synonyms_updated_at
BEFORE UPDATE ON search_synonyms
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Update trigger for search_facets
CREATE TRIGGER set_search_facets_updated_at
BEFORE UPDATE ON search_facets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INDEXES
-- =====================================================

-- Search index indexes
CREATE INDEX idx_search_indexes_document_id ON search_indexes(document_id);
CREATE INDEX idx_search_indexes_search_vector ON search_indexes USING gin(search_vector);
CREATE INDEX idx_search_indexes_title_tokens ON search_indexes USING gin(title_tokens);
CREATE INDEX idx_search_indexes_content_tokens ON search_indexes USING gin(content_tokens);
CREATE INDEX idx_search_indexes_tags ON search_indexes USING gin(tags);
CREATE INDEX idx_search_indexes_published_date ON search_indexes(published_date);
CREATE INDEX idx_search_indexes_quality_score ON search_indexes(quality_score DESC);
CREATE INDEX idx_search_indexes_popularity_score ON search_indexes(popularity_score DESC);

-- Search query indexes
CREATE INDEX idx_search_queries_user_id ON search_queries(user_id);
CREATE INDEX idx_search_queries_created_at ON search_queries(created_at);
CREATE INDEX idx_search_queries_query_type ON search_queries(query_type);
CREATE INDEX idx_search_queries_normalized_query ON search_queries(normalized_query);
CREATE INDEX idx_search_queries_query_tokens ON search_queries USING gin(query_tokens);
CREATE INDEX idx_search_queries_query_embedding ON search_queries USING ivfflat (query_embedding vector_cosine_ops) WITH (lists = 100);

-- Search analytics indexes
CREATE INDEX idx_search_analytics_date ON search_analytics(date);
CREATE INDEX idx_search_analytics_date_hour ON search_analytics(date, hour);

-- Search suggestions indexes
CREATE INDEX idx_search_suggestions_suggestion_text ON search_suggestions(suggestion_text);
CREATE INDEX idx_search_suggestions_frequency ON search_suggestions(frequency DESC);
CREATE INDEX idx_search_suggestions_relevance ON search_suggestions(relevance_score DESC);
CREATE INDEX idx_search_suggestions_is_active ON search_suggestions(is_active);

-- Search synonyms indexes
CREATE INDEX idx_search_synonyms_term ON search_synonyms(term);
CREATE INDEX idx_search_synonyms_is_active ON search_synonyms(is_active);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to update search vector
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(COALESCE(NEW.title_tokens, ''), 'A') ||
        setweight(COALESCE(NEW.content_tokens, ''), 'B') ||
        setweight(COALESCE(NEW.summary_tokens, ''), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update search vector
CREATE TRIGGER update_search_indexes_search_vector
BEFORE INSERT OR UPDATE OF title_tokens, content_tokens, summary_tokens
ON search_indexes
FOR EACH ROW
EXECUTE FUNCTION update_search_vector();

-- Function to normalize author names
CREATE OR REPLACE FUNCTION normalize_author(author_name TEXT)
RETURNS TEXT AS $$
BEGIN
    IF author_name IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Remove extra spaces, convert to lowercase, remove special characters
    RETURN LOWER(REGEXP_REPLACE(TRIM(author_name), '[^a-zA-Z0-9\s]', '', 'g'));
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- INITIAL DATA
-- =====================================================

-- Insert common search synonyms
INSERT INTO search_synonyms (term, synonyms, synonym_type, weight) VALUES
('ai', ARRAY['artificial intelligence', 'machine learning', 'ml', 'deep learning'], 'bidirectional', 1.0),
('llm', ARRAY['large language model', 'language model', 'gpt', 'claude'], 'bidirectional', 0.9),
('api', ARRAY['application programming interface', 'endpoint', 'service'], 'bidirectional', 0.8),
('database', ARRAY['db', 'data store', 'storage'], 'bidirectional', 0.9),
('search', ARRAY['query', 'find', 'lookup', 'retrieve'], 'bidirectional', 0.8),
('document', ARRAY['article', 'content', 'text', 'page'], 'bidirectional', 0.7),
('user', ARRAY['person', 'individual', 'member'], 'bidirectional', 0.7),
('error', ARRAY['bug', 'issue', 'problem', 'fault'], 'bidirectional', 0.8),
('create', ARRAY['make', 'build', 'generate', 'produce'], 'bidirectional', 0.7),
('delete', ARRAY['remove', 'erase', 'clear', 'purge'], 'bidirectional', 0.8);

-- Initialize search facets
INSERT INTO search_facets (facet_name, facet_type, facet_values) VALUES
('content_type', 'category', '[]'::JSONB),
('author', 'author', '[]'::JSONB),
('tags', 'tag', '[]'::JSONB),
('date_range', 'date_range', '[]'::JSONB),
('quality', 'custom', '[{"value": "high", "label": "High Quality", "count": 0}, {"value": "medium", "label": "Medium Quality", "count": 0}, {"value": "low", "label": "Low Quality", "count": 0}]'::JSONB);