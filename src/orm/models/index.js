/**
 * Models Index - Exports all ORM models
 * This provides a centralized way to import models
 */

// Note: Models are actually initialized in sequelize.js with database connection
// This file provides a way to import model classes for type checking and testing

const AuditLog = require('./AuditLog');
const CostAlert = require('./CostAlert');
const CostBudget = require('./CostBudget');
const CostEvent = require('./CostEvent');
const Document = require('./Document');
const DocumentFeedback = require('./DocumentFeedback');
const DocumentVisibility = require('./DocumentVisibility');
const FeedbackAggregate = require('./FeedbackAggregate');
const Job = require('./Job');
const JobDependency = require('./JobDependency');
const JobLog = require('./JobLog');
const Source = require('./Source');
const VisibilityAuditLog = require('./VisibilityAuditLog');
const VisibilityApproval = require('./VisibilityApproval');
const VisibilityRule = require('./VisibilityRule');

module.exports = {
  AuditLog,
  CostAlert,
  CostBudget,
  CostEvent,
  Document,
  DocumentFeedback,
  DocumentVisibility,
  FeedbackAggregate,
  Job,
  JobDependency,
  JobLog,
  Source,
  VisibilityAuditLog,
  VisibilityApproval,
  VisibilityRule
};
