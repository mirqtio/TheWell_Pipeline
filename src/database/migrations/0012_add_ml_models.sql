-- Migration: Add ML Models Schema
-- Version: 0012
-- Description: Add tables for machine learning models, training data, and performance metrics

-- Model types enum
CREATE TYPE ml_model_type AS ENUM (
    'classification',
    'clustering',
    'nlp',
    'sentiment',
    'topic_modeling',
    'ner',
    'similarity',
    'quality_scoring'
);

-- Model status enum
CREATE TYPE ml_model_status AS ENUM (
    'draft',
    'training',
    'trained',
    'evaluating',
    'deployed',
    'archived',
    'failed'
);

-- ML Models table
CREATE TABLE ml_models (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type ml_model_type NOT NULL,
    description TEXT,
    framework VARCHAR(100) DEFAULT 'tensorflow.js',
    version VARCHAR(50) NOT NULL,
    status ml_model_status DEFAULT 'draft',
    config JSONB DEFAULT '{}',
    hyperparameters JSONB DEFAULT '{}',
    feature_config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deployed_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER,
    UNIQUE(name, version)
);

-- Model versions table for tracking model history
CREATE TABLE ml_model_versions (
    id SERIAL PRIMARY KEY,
    model_id INTEGER REFERENCES ml_models(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL,
    parent_version_id INTEGER REFERENCES ml_model_versions(id),
    changelog TEXT,
    model_path TEXT,
    model_size_bytes BIGINT,
    training_duration_seconds INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER
);

-- Training datasets table
CREATE TABLE ml_training_datasets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    dataset_type VARCHAR(50),
    source_query TEXT,
    filters JSONB DEFAULT '{}',
    size INTEGER,
    split_config JSONB DEFAULT '{"train": 0.8, "validation": 0.1, "test": 0.1}',
    preprocessing_config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Training jobs table
CREATE TABLE ml_training_jobs (
    id SERIAL PRIMARY KEY,
    model_id INTEGER REFERENCES ml_models(id) ON DELETE CASCADE,
    dataset_id INTEGER REFERENCES ml_training_datasets(id),
    status VARCHAR(50) DEFAULT 'pending',
    config JSONB DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    logs TEXT,
    metrics JSONB DEFAULT '{}',
    resource_usage JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER
);

-- Model performance metrics table
CREATE TABLE ml_model_metrics (
    id SERIAL PRIMARY KEY,
    model_id INTEGER REFERENCES ml_models(id) ON DELETE CASCADE,
    training_job_id INTEGER REFERENCES ml_training_jobs(id),
    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value FLOAT NOT NULL,
    dataset_split VARCHAR(20),
    additional_data JSONB DEFAULT '{}',
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Prediction logs table for monitoring
CREATE TABLE ml_predictions (
    id SERIAL PRIMARY KEY,
    model_id INTEGER REFERENCES ml_models(id) ON DELETE CASCADE,
    input_data JSONB NOT NULL,
    prediction JSONB NOT NULL,
    confidence FLOAT,
    latency_ms INTEGER,
    feedback_score FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Feature sets table
CREATE TABLE ml_feature_sets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    features JSONB NOT NULL,
    preprocessing_steps JSONB DEFAULT '[]',
    version VARCHAR(50) DEFAULT '1.0.0',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Model-feature associations
CREATE TABLE ml_model_features (
    id SERIAL PRIMARY KEY,
    model_id INTEGER REFERENCES ml_models(id) ON DELETE CASCADE,
    feature_set_id INTEGER REFERENCES ml_feature_sets(id) ON DELETE CASCADE,
    feature_importance JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_id, feature_set_id)
);

-- Indexes for performance
CREATE INDEX idx_ml_models_type ON ml_models(type);
CREATE INDEX idx_ml_models_status ON ml_models(status);
CREATE INDEX idx_ml_models_created_at ON ml_models(created_at);
CREATE INDEX idx_ml_model_versions_model_id ON ml_model_versions(model_id);
CREATE INDEX idx_ml_training_jobs_model_id ON ml_training_jobs(model_id);
CREATE INDEX idx_ml_training_jobs_status ON ml_training_jobs(status);
CREATE INDEX idx_ml_model_metrics_model_id ON ml_model_metrics(model_id);
CREATE INDEX idx_ml_model_metrics_type ON ml_model_metrics(metric_type);
CREATE INDEX idx_ml_predictions_model_id ON ml_predictions(model_id);
CREATE INDEX idx_ml_predictions_created_at ON ml_predictions(created_at);

-- Add timestamp triggers
CREATE TRIGGER update_ml_models_updated_at
    BEFORE UPDATE ON ml_models
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ml_training_datasets_updated_at
    BEFORE UPDATE ON ml_training_datasets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ml_feature_sets_updated_at
    BEFORE UPDATE ON ml_feature_sets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();