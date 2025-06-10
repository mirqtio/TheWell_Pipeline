-- Migration 0006: Add Source Quality Scoring System
-- Support for believability weighting and source reliability tracking

-- Table for tracking source events (success/failure/response times)
CREATE TABLE IF NOT EXISTS source_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'success', 'error', 'online', 'offline'
    response_time INTEGER, -- Response time in milliseconds
    error_type VARCHAR(100), -- Type of error if event_type is 'error'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing source quality scores
CREATE TABLE IF NOT EXISTS source_quality_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id VARCHAR(255) NOT NULL,
    believability_weight DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    reliability_score DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    content_quality_avg DECIMAL(4,3) DEFAULT NULL,
    overall_score DECIMAL(4,3) NOT NULL,
    score_factors JSONB DEFAULT '{}', -- Store breakdown of scoring factors
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_id)
);

-- Table for tracking source scoring history
CREATE TABLE IF NOT EXISTS source_quality_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id VARCHAR(255) NOT NULL,
    believability_weight DECIMAL(4,3) NOT NULL,
    reliability_score DECIMAL(4,3) NOT NULL,
    overall_score DECIMAL(4,3) NOT NULL,
    score_factors JSONB DEFAULT '{}',
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for content quality analysis results
CREATE TABLE IF NOT EXISTS content_quality_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID,
    source_id VARCHAR(255) NOT NULL,
    length_score DECIMAL(4,3),
    readability_score DECIMAL(4,3),
    freshness_score DECIMAL(4,3),
    credibility_score DECIMAL(4,3),
    structure_score DECIMAL(4,3),
    overall_quality DECIMAL(4,3) NOT NULL,
    analysis_metadata JSONB DEFAULT '{}',
    analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_source_events_source_id ON source_events(source_id);
CREATE INDEX IF NOT EXISTS idx_source_events_type ON source_events(event_type);
CREATE INDEX IF NOT EXISTS idx_source_events_created_at ON source_events(created_at);
CREATE INDEX IF NOT EXISTS idx_source_events_source_created ON source_events(source_id, created_at);

CREATE INDEX IF NOT EXISTS idx_source_quality_scores_source_id ON source_quality_scores(source_id);
CREATE INDEX IF NOT EXISTS idx_source_quality_scores_overall ON source_quality_scores(overall_score);
CREATE INDEX IF NOT EXISTS idx_source_quality_scores_updated ON source_quality_scores(updated_at);

CREATE INDEX IF NOT EXISTS idx_source_quality_history_source_id ON source_quality_history(source_id);
CREATE INDEX IF NOT EXISTS idx_source_quality_history_recorded ON source_quality_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_source_quality_history_source_recorded ON source_quality_history(source_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_content_quality_analysis_document_id ON content_quality_analysis(document_id);
CREATE INDEX IF NOT EXISTS idx_content_quality_analysis_source_id ON content_quality_analysis(source_id);
CREATE INDEX IF NOT EXISTS idx_content_quality_analysis_analyzed ON content_quality_analysis(analyzed_at);

-- Update trigger for source_quality_scores
CREATE OR REPLACE FUNCTION update_source_quality_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_source_quality_timestamp
    BEFORE UPDATE ON source_quality_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_source_quality_timestamp();

-- Function to calculate source uptime percentage
CREATE OR REPLACE FUNCTION calculate_source_uptime(
    p_source_id VARCHAR(255),
    p_timeframe INTERVAL DEFAULT INTERVAL '30 days'
)
RETURNS DECIMAL(5,2) AS $$
DECLARE
    total_events INTEGER;
    success_events INTEGER;
    uptime_percentage DECIMAL(5,2);
BEGIN
    SELECT 
        COUNT(*),
        COUNT(CASE WHEN event_type = 'success' THEN 1 END)
    INTO total_events, success_events
    FROM source_events 
    WHERE source_id = p_source_id 
      AND created_at >= NOW() - p_timeframe
      AND event_type IN ('success', 'error');
    
    IF total_events = 0 THEN
        RETURN 100.00; -- Default to 100% for new sources
    END IF;
    
    uptime_percentage := (success_events::DECIMAL / total_events::DECIMAL) * 100;
    RETURN ROUND(uptime_percentage, 2);
END;
$$ LANGUAGE plpgsql;

-- Function to get source reliability metrics
CREATE OR REPLACE FUNCTION get_source_reliability_metrics(
    p_source_id VARCHAR(255),
    p_timeframe INTERVAL DEFAULT INTERVAL '30 days'
)
RETURNS TABLE (
    source_id VARCHAR(255),
    total_events INTEGER,
    success_events INTEGER,
    error_events INTEGER,
    avg_response_time DECIMAL(10,2),
    uptime_percentage DECIMAL(5,2),
    error_rate DECIMAL(5,2),
    last_failure_time TIMESTAMP WITH TIME ZONE,
    consecutive_successes INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH event_stats AS (
        SELECT 
            se.source_id,
            COUNT(*) as total_count,
            COUNT(CASE WHEN se.event_type = 'success' THEN 1 END) as success_count,
            COUNT(CASE WHEN se.event_type = 'error' THEN 1 END) as error_count,
            AVG(se.response_time) as avg_resp_time,
            MAX(CASE WHEN se.event_type = 'error' THEN se.created_at END) as last_error
        FROM source_events se
        WHERE se.source_id = p_source_id 
          AND se.created_at >= NOW() - p_timeframe
          AND se.event_type IN ('success', 'error')
        GROUP BY se.source_id
    ),
    consecutive_calc AS (
        SELECT 
            COUNT(*) as consecutive_count
        FROM (
            SELECT 
                se.event_type,
                ROW_NUMBER() OVER (ORDER BY se.created_at DESC) as rn
            FROM source_events se
            WHERE se.source_id = p_source_id
              AND se.event_type IN ('success', 'error')
            ORDER BY se.created_at DESC
            LIMIT 100
        ) recent
        WHERE recent.event_type = 'success'
          AND recent.rn = (
            SELECT MIN(rn) 
            FROM (
                SELECT 
                    se2.event_type,
                    ROW_NUMBER() OVER (ORDER BY se2.created_at DESC) as rn
                FROM source_events se2
                WHERE se2.source_id = p_source_id
                  AND se2.event_type IN ('success', 'error')
                ORDER BY se2.created_at DESC
                LIMIT 100
            ) recent2
            WHERE recent2.rn >= recent.rn
              AND recent2.event_type = 'error'
          ) OR NOT EXISTS (
            SELECT 1 
            FROM (
                SELECT 
                    se3.event_type,
                    ROW_NUMBER() OVER (ORDER BY se3.created_at DESC) as rn
                FROM source_events se3
                WHERE se3.source_id = p_source_id
                  AND se3.event_type IN ('success', 'error')
                ORDER BY se3.created_at DESC
                LIMIT 100
            ) recent3
            WHERE recent3.rn >= recent.rn
              AND recent3.event_type = 'error'
          )
    )
    SELECT 
        p_source_id,
        COALESCE(es.total_count, 0)::INTEGER,
        COALESCE(es.success_count, 0)::INTEGER,
        COALESCE(es.error_count, 0)::INTEGER,
        ROUND(COALESCE(es.avg_resp_time, 1000), 2)::DECIMAL(10,2),
        CASE 
            WHEN COALESCE(es.total_count, 0) = 0 THEN 100.00
            ELSE ROUND((COALESCE(es.success_count, 0)::DECIMAL / es.total_count::DECIMAL) * 100, 2)
        END::DECIMAL(5,2),
        CASE 
            WHEN COALESCE(es.total_count, 0) = 0 THEN 0.00
            ELSE ROUND((COALESCE(es.error_count, 0)::DECIMAL / es.total_count::DECIMAL) * 100, 2)
        END::DECIMAL(5,2),
        es.last_error,
        COALESCE(cc.consecutive_count, 0)::INTEGER
    FROM event_stats es
    FULL OUTER JOIN consecutive_calc cc ON true;
END;
$$ LANGUAGE plpgsql;

-- Function to record source quality score history
CREATE OR REPLACE FUNCTION record_source_quality_history()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO source_quality_history (
        source_id,
        believability_weight,
        reliability_score,
        overall_score,
        score_factors,
        recorded_at
    ) VALUES (
        NEW.source_id,
        NEW.believability_weight,
        NEW.reliability_score,
        NEW.overall_score,
        NEW.score_factors,
        NEW.updated_at
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically record quality score history
CREATE TRIGGER trigger_record_source_quality_history
    AFTER INSERT OR UPDATE ON source_quality_scores
    FOR EACH ROW
    EXECUTE FUNCTION record_source_quality_history();

-- Function to clean up old source events (data retention)
CREATE OR REPLACE FUNCTION cleanup_old_source_events(
    p_retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM source_events 
    WHERE created_at < NOW() - INTERVAL '1 day' * p_retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get top sources by quality score
CREATE OR REPLACE FUNCTION get_top_quality_sources(
    p_limit INTEGER DEFAULT 10,
    p_min_events INTEGER DEFAULT 10
)
RETURNS TABLE (
    source_id VARCHAR(255),
    source_name VARCHAR(255),
    overall_score DECIMAL(4,3),
    believability_weight DECIMAL(4,3),
    reliability_score DECIMAL(4,3),
    total_events BIGINT,
    last_updated TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sqs.source_id,
        s.name as source_name,
        sqs.overall_score,
        sqs.believability_weight,
        sqs.reliability_score,
        COALESCE(event_counts.total_events, 0) as total_events,
        sqs.updated_at as last_updated
    FROM source_quality_scores sqs
    LEFT JOIN sources s ON s.id = sqs.source_id
    LEFT JOIN (
        SELECT 
            source_id,
            COUNT(*) as total_events
        FROM source_events
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY source_id
    ) event_counts ON event_counts.source_id = sqs.source_id
    WHERE COALESCE(event_counts.total_events, 0) >= p_min_events
    ORDER BY sqs.overall_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON source_events TO thewell_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON source_quality_scores TO thewell_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON source_quality_history TO thewell_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON content_quality_analysis TO thewell_user;

GRANT EXECUTE ON FUNCTION calculate_source_uptime TO thewell_user;
GRANT EXECUTE ON FUNCTION get_source_reliability_metrics TO thewell_user;
GRANT EXECUTE ON FUNCTION cleanup_old_source_events TO thewell_user;
GRANT EXECUTE ON FUNCTION get_top_quality_sources TO thewell_user;