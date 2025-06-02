/**
 * OpenAPI/Swagger Configuration
 * Comprehensive API documentation for TheWell Pipeline
 */

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TheWell Pipeline API',
      version: '1.0.0',
      description: 'Multi-source data ingestion and knowledge management system with RAG capabilities',
      contact: {
        name: 'TheWell Pipeline Team',
        email: 'support@thewellpipeline.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://api.thewellpipeline.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for authentication'
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token for authentication'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['success', 'error', 'message'],
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              example: 'Bad Request'
            },
            message: {
              type: 'string',
              example: 'Invalid input parameters'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-01T00:00:00.000Z'
            }
          }
        },
        Document: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              example: '123e4567-e89b-12d3-a456-426614174000'
            },
            title: {
              type: 'string',
              example: 'Sample Document'
            },
            content: {
              type: 'string',
              example: 'This is the document content...'
            },
            source: {
              type: 'string',
              example: 'web-scraper'
            },
            metadata: {
              type: 'object',
              additionalProperties: true
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            },
            updated_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Job: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            type: {
              type: 'string',
              enum: ['ingestion', 'processing', 'enrichment']
            },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed']
            },
            progress: {
              type: 'number',
              minimum: 0,
              maximum: 100
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            },
            completed_at: {
              type: 'string',
              format: 'date-time',
              nullable: true
            }
          }
        },
        RAGSearchRequest: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              minLength: 1,
              maxLength: 1000,
              example: 'What is machine learning?'
            },
            context: {
              type: 'object',
              properties: {
                conversationId: {
                  type: 'string',
                  example: 'conv-123'
                },
                previousQueries: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  maxItems: 5
                },
                userPreferences: {
                  type: 'object',
                  additionalProperties: true
                },
                sessionData: {
                  type: 'object',
                  additionalProperties: true
                }
              }
            },
            filters: {
              type: 'object',
              properties: {
                sources: {
                  type: 'array',
                  items: {
                    type: 'string'
                  }
                },
                dateRange: {
                  type: 'object',
                  properties: {
                    start: {
                      type: 'string',
                      format: 'date'
                    },
                    end: {
                      type: 'string',
                      format: 'date'
                    }
                  }
                },
                contentTypes: {
                  type: 'array',
                  items: {
                    type: 'string'
                  }
                },
                tags: {
                  type: 'array',
                  items: {
                    type: 'string'
                  }
                }
              }
            },
            options: {
              type: 'object',
              properties: {
                maxResults: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 50,
                  default: 10
                },
                includeMetadata: {
                  type: 'boolean',
                  default: true
                },
                includeSources: {
                  type: 'boolean',
                  default: true
                },
                responseFormat: {
                  type: 'string',
                  enum: ['json', 'text', 'markdown'],
                  default: 'json'
                }
              }
            }
          }
        },
        RAGSearchResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                answer: {
                  type: 'string',
                  example: 'Machine learning is a subset of artificial intelligence...'
                },
                sources: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      document_id: {
                        type: 'string',
                        format: 'uuid'
                      },
                      title: {
                        type: 'string'
                      },
                      relevance_score: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1
                      },
                      excerpt: {
                        type: 'string'
                      }
                    }
                  }
                },
                metadata: {
                  type: 'object',
                  properties: {
                    query_time_ms: {
                      type: 'number'
                    },
                    total_documents_searched: {
                      type: 'integer'
                    },
                    confidence_score: {
                      type: 'number',
                      minimum: 0,
                      maximum: 1
                    }
                  }
                }
              }
            },
            traceId: {
              type: 'string',
              example: 'trace-123'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        HealthStatus: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['healthy', 'degraded', 'unhealthy'],
                  example: 'healthy'
                },
                components: {
                  type: 'object',
                  properties: {
                    ragManager: {
                      type: 'object',
                      properties: {
                        status: {
                          type: 'string',
                          enum: ['healthy', 'degraded', 'unhealthy']
                        },
                        initialized: {
                          type: 'boolean'
                        }
                      }
                    },
                    cacheManager: {
                      type: 'object',
                      properties: {
                        status: {
                          type: 'string',
                          enum: ['healthy', 'degraded', 'unhealthy']
                        },
                        connected: {
                          type: 'boolean'
                        }
                      }
                    }
                  }
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time'
                }
              }
            }
          }
        },
        RAGCapabilities: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                version: {
                  type: 'string',
                  example: '1.0.0'
                },
                supportedFormats: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  example: ['json', 'text', 'markdown']
                },
                maxQueryLength: {
                  type: 'integer',
                  example: 1000
                },
                maxResults: {
                  type: 'integer',
                  example: 50
                },
                availableFilters: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  example: ['sources', 'dateRange', 'contentTypes', 'tags']
                },
                supportedSources: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  example: ['web-scraper', 'document-upload', 'api-ingestion']
                }
              }
            }
          }
        },
        RAGFeedback: {
          type: 'object',
          required: ['trace_id', 'rating', 'feedback_type'],
          properties: {
            trace_id: {
              type: 'string',
              example: 'trace-123'
            },
            rating: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              example: 4
            },
            feedback_type: {
              type: 'string',
              enum: ['helpful', 'not_helpful', 'incorrect', 'incomplete'],
              example: 'helpful'
            },
            comment: {
              type: 'string',
              maxLength: 1000,
              example: 'This response was very helpful and accurate.'
            },
            suggested_improvement: {
              type: 'string',
              maxLength: 1000,
              example: 'Could include more recent examples.'
            }
          }
        },
        FeedbackResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              properties: {
                feedback_id: {
                  type: 'string',
                  format: 'uuid',
                  example: '123e4567-e89b-12d3-a456-426614174000'
                },
                message: {
                  type: 'string',
                  example: 'Feedback submitted successfully'
                }
              }
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      },
      {
        BearerAuth: []
      }
    ]
  },
  apis: [
    './src/web/routes/*.js',
    './src/web/app.js'
  ]
};

const specs = swaggerJsdoc(options);

module.exports = {
  specs,
  swaggerUi,
  serve: swaggerUi.serve,
  setup: swaggerUi.setup(specs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'TheWell Pipeline API Documentation'
  })
};
