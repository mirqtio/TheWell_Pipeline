-- Migration: Add alert rules system
-- Description: Creates tables for alert rules engine

BEGIN;

-- Alert rule types enum
CREATE TYPE alert_rule_type AS ENUM (
  'threshold',    -- Simple threshold comparison
  'pattern',      -- Pattern-based (count within window)
  'composite',    -- Complex rules with multiple conditions
  'anomaly'       -- Future: anomaly detection
);

-- Alert severity levels
CREATE TYPE alert_severity AS ENUM (
  'info',
  'warning',
  'error',
  'critical'
);

-- Alert states
CREATE TYPE alert_state AS ENUM (
  'normal',      -- Not triggered
  'pending',     -- Condition met but waiting for confirmation
  'alerting',    -- Currently alerting
  'resolved'     -- Was alerting but now resolved
);

-- Main alert rules table
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type alert_rule_type NOT NULL,
  conditions JSONB NOT NULL, -- Rule-specific conditions
  actions TEXT[] DEFAULT '{}', -- Array of action names
  severity alert_severity DEFAULT 'warning',
  is_active BOOLEAN DEFAULT true,
  cooldown INTEGER DEFAULT 0, -- Cooldown period in seconds
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_alert_rules_active (is_active),
  INDEX idx_alert_rules_type (type),
  INDEX idx_alert_rules_tags (tags),
  INDEX idx_alert_rules_created (created_at DESC)
);

-- Alert rule history (tracks state changes)
CREATE TABLE IF NOT EXISTS alert_history (
  id SERIAL PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  state alert_state NOT NULL,
  triggered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE,
  trigger_reason TEXT,
  data JSONB, -- Data that triggered the alert
  actions_executed TEXT[],
  action_errors JSONB,
  duration_ms INTEGER, -- How long the alert was active
  
  -- Indexes
  INDEX idx_alert_history_rule (rule_id),
  INDEX idx_alert_history_state (state),
  INDEX idx_alert_history_triggered (triggered_at DESC)
);

-- Pattern event tracking (for pattern-based rules)
CREATE TABLE IF NOT EXISTS alert_pattern_events (
  id SERIAL PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  event_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  
  -- Indexes
  INDEX idx_pattern_events_rule (rule_id),
  INDEX idx_pattern_events_type (event_type),
  INDEX idx_pattern_events_time (event_time DESC)
);

-- Alert actions configuration
CREATE TABLE IF NOT EXISTS alert_actions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  type VARCHAR(50) NOT NULL, -- email, slack, webhook, pagerduty, etc.
  configuration JSONB NOT NULL, -- Action-specific config
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Alert templates
CREATE TABLE IF NOT EXISTS alert_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  type alert_rule_type NOT NULL,
  default_conditions JSONB NOT NULL,
  default_actions TEXT[] DEFAULT '{}',
  default_severity alert_severity DEFAULT 'warning',
  default_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Alert metrics (for monitoring the alerting system itself)
CREATE TABLE IF NOT EXISTS alert_metrics (
  id SERIAL PRIMARY KEY,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  trigger_count INTEGER DEFAULT 0,
  false_positive_count INTEGER DEFAULT 0,
  action_success_count INTEGER DEFAULT 0,
  action_failure_count INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  
  -- Unique constraint for daily metrics per rule
  UNIQUE(rule_id, metric_date),
  
  -- Indexes
  INDEX idx_alert_metrics_rule_date (rule_id, metric_date DESC)
);

-- Notification preferences per user
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
  tag_filter TEXT[], -- Subscribe to rules with these tags
  severity_filter alert_severity[], -- Only get alerts of these severities
  notification_channels TEXT[] DEFAULT '{"email"}', -- How to notify
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_alert_subscriptions_user (user_id),
  INDEX idx_alert_subscriptions_rule (rule_id)
);

-- View for active alerts
CREATE VIEW active_alerts AS
SELECT 
  ah.id,
  ah.rule_id,
  ar.name AS rule_name,
  ar.severity,
  ah.state,
  ah.triggered_at,
  ah.trigger_reason,
  ah.data,
  EXTRACT(EPOCH FROM (NOW() - ah.triggered_at)) AS duration_seconds
FROM alert_history ah
JOIN alert_rules ar ON ah.rule_id = ar.id
WHERE ah.state = 'alerting'
  AND ah.resolved_at IS NULL
ORDER BY ar.severity DESC, ah.triggered_at DESC;

-- Function to clean up old pattern events
CREATE OR REPLACE FUNCTION cleanup_old_pattern_events()
RETURNS void AS $$
BEGIN
  -- Delete events older than 7 days by default
  DELETE FROM alert_pattern_events
  WHERE event_time < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Function to calculate alert metrics
CREATE OR REPLACE FUNCTION update_alert_metrics(
  p_rule_id UUID,
  p_triggered BOOLEAN,
  p_action_success BOOLEAN DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO alert_metrics (
    rule_id,
    metric_date,
    trigger_count,
    action_success_count,
    action_failure_count
  )
  VALUES (
    p_rule_id,
    CURRENT_DATE,
    CASE WHEN p_triggered THEN 1 ELSE 0 END,
    CASE WHEN p_action_success = true THEN 1 ELSE 0 END,
    CASE WHEN p_action_success = false THEN 1 ELSE 0 END
  )
  ON CONFLICT (rule_id, metric_date) 
  DO UPDATE SET
    trigger_count = alert_metrics.trigger_count + 
      CASE WHEN p_triggered THEN 1 ELSE 0 END,
    action_success_count = alert_metrics.action_success_count + 
      CASE WHEN p_action_success = true THEN 1 ELSE 0 END,
    action_failure_count = alert_metrics.action_failure_count + 
      CASE WHEN p_action_success = false THEN 1 ELSE 0 END;
END;
$$ LANGUAGE plpgsql;

-- Default alert actions
INSERT INTO alert_actions (name, type, configuration) VALUES
  ('email', 'email', '{"default_recipients": []}'),
  ('slack', 'slack', '{"webhook_url": null, "channel": "#alerts"}'),
  ('log', 'log', '{"level": "warn"}'),
  ('webhook', 'webhook', '{"url": null, "method": "POST"}')
ON CONFLICT (name) DO NOTHING;

-- Default alert templates
INSERT INTO alert_templates (name, description, type, default_conditions, default_actions, default_severity) VALUES
  ('high_error_rate', 'Alert when error rate exceeds threshold', 'threshold', 
   '{"metric": "error_rate", "operator": ">", "value": 0.05}', 
   '{"email", "slack"}', 'error'),
  ('api_degradation', 'Alert on API performance degradation', 'composite',
   '{"all": [{"metric": "response_time_p95", "operator": ">", "value": 1000}, {"metric": "error_rate", "operator": ">", "value": 0.01}]}',
   '{"slack", "pagerduty"}', 'warning'),
  ('security_pattern', 'Detect suspicious security patterns', 'pattern',
   '{"pattern": "failed_login", "count": 5, "window": 300}',
   '{"email", "security_team"}', 'critical')
ON CONFLICT (name) DO NOTHING;

-- Trigger to update updated_at
CREATE TRIGGER update_alert_rules_updated_at
BEFORE UPDATE ON alert_rules
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alert_actions_updated_at
BEFORE UPDATE ON alert_actions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE alert_rules IS 'Stores alert rule definitions';
COMMENT ON TABLE alert_history IS 'Tracks alert state changes and history';
COMMENT ON TABLE alert_pattern_events IS 'Stores events for pattern-based alert rules';
COMMENT ON TABLE alert_actions IS 'Configures available alert actions';
COMMENT ON TABLE alert_templates IS 'Predefined alert rule templates';
COMMENT ON TABLE alert_metrics IS 'Metrics about alert rule performance';
COMMENT ON TABLE alert_subscriptions IS 'User subscriptions to alerts';

COMMIT;