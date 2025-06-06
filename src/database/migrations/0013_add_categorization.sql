-- Migration: Add categorization system
-- Version: 0013
-- Description: Add support for hierarchical categorization with ML-based auto-categorization

-- Categories table for hierarchical taxonomy
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
    path TEXT NOT NULL UNIQUE, -- Full path like "Technology/AI/Machine Learning"
    depth INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient hierarchy queries
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_path ON categories(path);
CREATE INDEX idx_categories_path_pattern ON categories(path text_pattern_ops);
CREATE INDEX idx_categories_active ON categories(is_active) WHERE is_active = true;

-- Document-category associations with confidence scores
CREATE TABLE IF NOT EXISTS document_categories (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    confidence DECIMAL(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    is_manual BOOLEAN DEFAULT false,
    method VARCHAR(50), -- 'rules', 'keywords', 'ml', 'entities', 'manual'
    explanation TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, category_id)
);

-- Indexes for document categories
CREATE INDEX idx_document_categories_document ON document_categories(document_id);
CREATE INDEX idx_document_categories_category ON document_categories(category_id);
CREATE INDEX idx_document_categories_confidence ON document_categories(confidence);
CREATE INDEX idx_document_categories_manual ON document_categories(is_manual);

-- Category rules for rule-based categorization
CREATE TABLE IF NOT EXISTS category_rules (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    rule_type VARCHAR(50) NOT NULL, -- 'regex', 'contains', 'entity', 'metadata'
    pattern TEXT NOT NULL,
    confidence DECIMAL(3,2) NOT NULL DEFAULT 0.8,
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for category rules
CREATE INDEX idx_category_rules_category ON category_rules(category_id);
CREATE INDEX idx_category_rules_active ON category_rules(is_active) WHERE is_active = true;

-- Category keywords for keyword-based matching
CREATE TABLE IF NOT EXISTS category_keywords (
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    term VARCHAR(255) NOT NULL,
    weight DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (category_id, term)
);

-- Index for keyword lookups
CREATE INDEX idx_category_keywords_term ON category_keywords(term);

-- Entity patterns for entity-based categorization
CREATE TABLE IF NOT EXISTS category_entity_patterns (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    pattern JSONB NOT NULL, -- {"people": ["Elon Musk"], "organizations": ["SpaceX"]}
    weight DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for entity patterns
CREATE INDEX idx_category_entity_patterns_category ON category_entity_patterns(category_id);

-- Categorization feedback for improving accuracy
CREATE TABLE IF NOT EXISTS categorization_feedback (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    feedback_type VARCHAR(50) NOT NULL, -- 'accept', 'reject', 'adjust'
    is_correct BOOLEAN,
    confidence_delta DECIMAL(3,2), -- Suggested confidence adjustment
    user_id INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for feedback
CREATE INDEX idx_categorization_feedback_document ON categorization_feedback(document_id);
CREATE INDEX idx_categorization_feedback_category ON categorization_feedback(category_id);
CREATE INDEX idx_categorization_feedback_created ON categorization_feedback(created_at);

-- Categorization metrics for performance tracking
CREATE TABLE IF NOT EXISTS categorization_metrics (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    category_count INTEGER NOT NULL,
    avg_confidence DECIMAL(3,2),
    methods_used JSONB, -- Array of methods used
    processing_time INTEGER, -- milliseconds
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for metrics queries
CREATE INDEX idx_categorization_metrics_created ON categorization_metrics(created_at);

-- ML models storage for categorization
CREATE TABLE IF NOT EXISTS ml_models (
    id SERIAL PRIMARY KEY,
    model_type VARCHAR(50) NOT NULL, -- 'classifier', 'embeddings'
    model_name VARCHAR(255) NOT NULL,
    model_data TEXT, -- Serialized model
    metadata JSONB DEFAULT '{}',
    accuracy DECIMAL(3,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_type, model_name)
);

-- Category statistics view
CREATE OR REPLACE VIEW category_statistics AS
SELECT 
    c.id,
    c.name,
    c.path,
    c.depth,
    COUNT(DISTINCT dc.document_id) as document_count,
    AVG(dc.confidence) as avg_confidence,
    COUNT(DISTINCT cr.id) as rule_count,
    COUNT(DISTINCT cc.id) as child_count
FROM categories c
LEFT JOIN document_categories dc ON dc.category_id = c.id
LEFT JOIN category_rules cr ON cr.category_id = c.id AND cr.is_active = true
LEFT JOIN categories cc ON cc.parent_id = c.id
WHERE c.is_active = true
GROUP BY c.id, c.name, c.path, c.depth;

-- Function to update category paths when parent changes
CREATE OR REPLACE FUNCTION update_category_paths() 
RETURNS TRIGGER AS $$
DECLARE
    old_path TEXT;
    new_path TEXT;
BEGIN
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.name != OLD.name THEN
        -- Calculate new path
        IF NEW.parent_id IS NULL THEN
            NEW.path = NEW.name;
            NEW.depth = 0;
        ELSE
            SELECT path || '/' || NEW.name, depth + 1
            INTO NEW.path, NEW.depth
            FROM categories
            WHERE id = NEW.parent_id;
        END IF;
        
        -- Update all child paths recursively
        old_path = OLD.path;
        new_path = NEW.path;
        
        UPDATE categories
        SET path = REPLACE(path, old_path, new_path),
            updated_at = CURRENT_TIMESTAMP
        WHERE path LIKE old_path || '/%';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for category path updates
CREATE TRIGGER trigger_update_category_paths
BEFORE UPDATE ON categories
FOR EACH ROW
EXECUTE FUNCTION update_category_paths();

-- Function to calculate category depth
CREATE OR REPLACE FUNCTION calculate_category_depth(category_path TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN array_length(string_to_array(category_path, '/'), 1) - 1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Insert default categories
INSERT INTO categories (name, description, parent_id, path, depth) VALUES
('Technology', 'Technology and computing topics', NULL, 'Technology', 0),
('Business', 'Business and finance topics', NULL, 'Business', 0),
('Science', 'Scientific topics and research', NULL, 'Science', 0),
('Health', 'Health and medical topics', NULL, 'Health', 0),
('Education', 'Educational content and resources', NULL, 'Education', 0),
('Arts & Culture', 'Arts, culture, and entertainment', NULL, 'Arts & Culture', 0);

-- Insert technology subcategories
INSERT INTO categories (name, description, parent_id, path, depth)
SELECT 'Artificial Intelligence', 'AI and machine learning topics', id, 'Technology/Artificial Intelligence', 1
FROM categories WHERE path = 'Technology';

INSERT INTO categories (name, description, parent_id, path, depth)
SELECT 'Software Development', 'Programming and software engineering', id, 'Technology/Software Development', 1
FROM categories WHERE path = 'Technology';

INSERT INTO categories (name, description, parent_id, path, depth)
SELECT 'Cybersecurity', 'Security and privacy topics', id, 'Technology/Cybersecurity', 1
FROM categories WHERE path = 'Technology';

-- Add check constraint for confidence values
ALTER TABLE document_categories
ADD CONSTRAINT check_confidence_range 
CHECK (confidence >= 0 AND confidence <= 1);

-- Create function for category hierarchy queries
CREATE OR REPLACE FUNCTION get_category_ancestors(category_id INTEGER)
RETURNS TABLE(id INTEGER, name VARCHAR, path TEXT, depth INTEGER) AS $$
WITH RECURSIVE ancestors AS (
    SELECT c.id, c.name, c.path, c.depth, c.parent_id
    FROM categories c
    WHERE c.id = category_id
    
    UNION ALL
    
    SELECT c.id, c.name, c.path, c.depth, c.parent_id
    FROM categories c
    JOIN ancestors a ON c.id = a.parent_id
)
SELECT id, name, path, depth
FROM ancestors
ORDER BY depth;
$$ LANGUAGE sql;

-- Create function for category descendants
CREATE OR REPLACE FUNCTION get_category_descendants(category_id INTEGER)
RETURNS TABLE(id INTEGER, name VARCHAR, path TEXT, depth INTEGER) AS $$
WITH RECURSIVE descendants AS (
    SELECT c.id, c.name, c.path, c.depth
    FROM categories c
    WHERE c.id = category_id
    
    UNION ALL
    
    SELECT c.id, c.name, c.path, c.depth
    FROM categories c
    JOIN descendants d ON c.parent_id = d.id
)
SELECT id, name, path, depth
FROM descendants
ORDER BY depth, name;
$$ LANGUAGE sql;

-- Add indexes for performance
CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_document_categories_created ON document_categories(created_at);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO web_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_categories TO web_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON category_rules TO web_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON category_keywords TO web_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON category_entity_patterns TO web_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON categorization_feedback TO web_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON categorization_metrics TO web_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ml_models TO web_user;
GRANT SELECT ON category_statistics TO web_user;
GRANT USAGE ON SEQUENCE categories_id_seq TO web_user;
GRANT USAGE ON SEQUENCE category_rules_id_seq TO web_user;
GRANT USAGE ON SEQUENCE category_entity_patterns_id_seq TO web_user;
GRANT USAGE ON SEQUENCE categorization_feedback_id_seq TO web_user;
GRANT USAGE ON SEQUENCE categorization_metrics_id_seq TO web_user;
GRANT USAGE ON SEQUENCE ml_models_id_seq TO web_user;