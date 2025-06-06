-- Migration: Add recommendation system
-- Description: Creates tables for recommendation engine

BEGIN;

-- User profiles for recommendations
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB DEFAULT '{}',
  interests TEXT[] DEFAULT '{}',
  viewed_documents TEXT[] DEFAULT '{}',
  liked_documents TEXT[] DEFAULT '{}',
  last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User interactions tracking
CREATE TABLE IF NOT EXISTS user_interactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id VARCHAR(255) NOT NULL,
  interaction_type VARCHAR(50) NOT NULL, -- view, like, share, save, click, dwell
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_user_interactions_user (user_id),
  INDEX idx_user_interactions_document (document_id),
  INDEX idx_user_interactions_type (interaction_type),
  INDEX idx_user_interactions_created (created_at DESC)
);

-- Recommendation impressions
CREATE TABLE IF NOT EXISTS recommendation_impressions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id VARCHAR(255) NOT NULL,
  algorithm VARCHAR(50) NOT NULL,
  position INTEGER,
  clicked BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_impressions_user (user_id),
  INDEX idx_impressions_algorithm (algorithm),
  INDEX idx_impressions_created (created_at DESC)
);

-- A/B test configurations
CREATE TABLE IF NOT EXISTS ab_tests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  variants JSONB NOT NULL, -- {control: 'algorithm1', variant: 'algorithm2'}
  is_active BOOLEAN DEFAULT true,
  start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- A/B test participants
CREATE TABLE IF NOT EXISTS ab_test_participants (
  test_id INTEGER NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (test_id, user_id),
  INDEX idx_ab_participants_test (test_id),
  INDEX idx_ab_participants_user (user_id)
);

-- Recommendation cache
CREATE TABLE IF NOT EXISTS recommendation_cache (
  id SERIAL PRIMARY KEY,
  cache_key VARCHAR(255) NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  recommendations JSONB NOT NULL,
  algorithm VARCHAR(50),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_rec_cache_user (user_id),
  INDEX idx_rec_cache_expires (expires_at)
);

-- Document similarity cache
CREATE TABLE IF NOT EXISTS document_similarity (
  document_id_1 VARCHAR(255) NOT NULL,
  document_id_2 VARCHAR(255) NOT NULL,
  similarity_score FLOAT NOT NULL,
  algorithm VARCHAR(50) DEFAULT 'cosine',
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (document_id_1, document_id_2, algorithm),
  INDEX idx_similarity_doc1 (document_id_1),
  INDEX idx_similarity_doc2 (document_id_2),
  INDEX idx_similarity_score (similarity_score DESC)
);

-- Trending content metrics
CREATE TABLE IF NOT EXISTS trending_metrics (
  document_id VARCHAR(255) NOT NULL,
  metric_date DATE NOT NULL,
  view_count INTEGER DEFAULT 0,
  interaction_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  trending_score FLOAT DEFAULT 0,
  
  PRIMARY KEY (document_id, metric_date),
  INDEX idx_trending_date (metric_date DESC),
  INDEX idx_trending_score (trending_score DESC)
);

-- Recommendation feedback
CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id VARCHAR(255) NOT NULL,
  algorithm VARCHAR(50),
  feedback_type VARCHAR(50), -- helpful, not_helpful, wrong_category, etc.
  feedback_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_rec_feedback_user (user_id),
  INDEX idx_rec_feedback_algorithm (algorithm)
);

-- Views for analytics

-- User engagement summary
CREATE VIEW user_engagement_summary AS
SELECT 
  u.id as user_id,
  u.email,
  COALESCE(up.last_active, u.created_at) as last_active,
  COALESCE(array_length(up.viewed_documents, 1), 0) as documents_viewed,
  COALESCE(array_length(up.liked_documents, 1), 0) as documents_liked,
  COALESCE(ui.interaction_count, 0) as total_interactions
FROM users u
LEFT JOIN user_profiles up ON u.id = up.user_id
LEFT JOIN (
  SELECT user_id, COUNT(*) as interaction_count
  FROM user_interactions
  GROUP BY user_id
) ui ON u.id = ui.user_id;

-- Algorithm performance
CREATE VIEW algorithm_performance AS
SELECT 
  algorithm,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_impressions,
  COUNT(CASE WHEN clicked = true THEN 1 END) as clicks,
  COUNT(CASE WHEN clicked = true THEN 1 END)::float / NULLIF(COUNT(*), 0) as ctr,
  DATE_TRUNC('day', created_at) as date
FROM recommendation_impressions
GROUP BY algorithm, DATE_TRUNC('day', created_at);

-- Functions

-- Calculate trending score
CREATE OR REPLACE FUNCTION calculate_trending_score(
  p_view_count INTEGER,
  p_interaction_count INTEGER,
  p_share_count INTEGER,
  p_age_hours INTEGER
)
RETURNS FLOAT AS $$
BEGIN
  -- Simple trending algorithm: (views + 2*interactions + 3*shares) / (age_hours + 2)
  RETURN (p_view_count + 2 * p_interaction_count + 3 * p_share_count)::float / (p_age_hours + 2);
END;
$$ LANGUAGE plpgsql;

-- Update trending metrics
CREATE OR REPLACE FUNCTION update_trending_metrics()
RETURNS void AS $$
BEGIN
  INSERT INTO trending_metrics (document_id, metric_date, view_count, interaction_count, share_count, trending_score)
  SELECT 
    document_id,
    CURRENT_DATE,
    COUNT(CASE WHEN interaction_type = 'view' THEN 1 END) as view_count,
    COUNT(CASE WHEN interaction_type NOT IN ('view', 'share') THEN 1 END) as interaction_count,
    COUNT(CASE WHEN interaction_type = 'share' THEN 1 END) as share_count,
    calculate_trending_score(
      COUNT(CASE WHEN interaction_type = 'view' THEN 1 END),
      COUNT(CASE WHEN interaction_type NOT IN ('view', 'share') THEN 1 END),
      COUNT(CASE WHEN interaction_type = 'share' THEN 1 END),
      24
    ) as trending_score
  FROM user_interactions
  WHERE created_at >= CURRENT_DATE
  GROUP BY document_id
  ON CONFLICT (document_id, metric_date) 
  DO UPDATE SET
    view_count = EXCLUDED.view_count,
    interaction_count = EXCLUDED.interaction_count,
    share_count = EXCLUDED.share_count,
    trending_score = EXCLUDED.trending_score;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old data
CREATE OR REPLACE FUNCTION cleanup_old_recommendation_data()
RETURNS void AS $$
BEGIN
  -- Delete old impressions (keep 30 days)
  DELETE FROM recommendation_impressions 
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  -- Delete old interactions (keep 90 days)
  DELETE FROM user_interactions 
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  -- Delete expired cache
  DELETE FROM recommendation_cache 
  WHERE expires_at < NOW();
  
  -- Delete old trending metrics (keep 7 days)
  DELETE FROM trending_metrics 
  WHERE metric_date < CURRENT_DATE - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER update_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Default data
INSERT INTO ab_tests (name, description, variants, is_active) VALUES
  ('default_algorithm_test', 'Test hybrid vs collaborative filtering', 
   '{"control": "hybrid", "variant": "collaborative"}', false)
ON CONFLICT (name) DO NOTHING;

-- Comments
COMMENT ON TABLE user_profiles IS 'User profiles for personalized recommendations';
COMMENT ON TABLE user_interactions IS 'Tracks all user interactions with documents';
COMMENT ON TABLE recommendation_impressions IS 'Tracks which recommendations were shown and clicked';
COMMENT ON TABLE ab_tests IS 'A/B test configurations for recommendation algorithms';
COMMENT ON TABLE document_similarity IS 'Pre-computed document similarity scores';
COMMENT ON TABLE trending_metrics IS 'Daily trending metrics for documents';

COMMIT;