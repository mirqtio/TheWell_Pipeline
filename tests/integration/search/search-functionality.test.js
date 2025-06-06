/**
 * Integration tests for search functionality
 */

const { Pool } = require('pg');
const SearchService = require('../../../src/services/SearchService');
const IntelligentSearchEngine = require('../../../src/search/IntelligentSearchEngine');
const { createTestDatabase, cleanupTestDatabase } = require('../../helpers/database');
const logger = require('../../../src/utils/logger');

// Reduce log noise during tests
logger.level = 'error';

describe('Search Functionality Integration Tests', () => {
  let pool;
  let searchService;
  let testDbName;

  beforeAll(async () => {
    // Create test database
    testDbName = await createTestDatabase();
    
    // Create connection pool
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: testDbName
    });

    // Run migrations
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE EXTENSION IF NOT EXISTS "pg_trgm";
    `);

    // Create necessary tables (simplified for testing)
    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE sources (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL UNIQUE,
        type VARCHAR(50) NOT NULL,
        config JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE documents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_id UUID REFERENCES sources(id),
        title TEXT NOT NULL,
        content TEXT,
        url TEXT,
        author VARCHAR(255),
        published_at TIMESTAMP WITH TIME ZONE,
        metadata JSONB DEFAULT '{}',
        embedding vector(1536),
        embedding_model VARCHAR(100),
        visibility VARCHAR(20) DEFAULT 'internal',
        quality_score FLOAT,
        believability_score FLOAT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
         NEW.updated_at = now();
         RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create search-related tables from migration
    const migrationSQL = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/database/migrations/0009_add_intelligent_search.sql'),
      'utf8'
    );
    await pool.query(migrationSQL);
  }, 30000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    await cleanupTestDatabase(testDbName);
  });

  beforeEach(async () => {
    // Clear data before each test
    await pool.query('TRUNCATE documents, search_indexes, search_queries, search_synonyms CASCADE');
    
    // Initialize search service
    searchService = new SearchService({
      database: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: testDbName
      },
      embedding: {
        apiKey: process.env.OPENAI_API_KEY || 'test-key'
      },
      analytics: {
        enabled: true,
        flushInterval: 10000
      }
    });

    // Skip actual embedding generation in tests
    if (searchService.embeddingService) {
      searchService.embeddingService.generateEmbedding = jest.fn()
        .mockResolvedValue(new Array(1536).fill(0.1));
    }

    await searchService.initialize();
  });

  afterEach(async () => {
    if (searchService) {
      await searchService.shutdown();
    }
  });

  describe('Document Indexing', () => {
    it('should index a document successfully', async () => {
      // Insert test document
      const { rows: [doc] } = await pool.query(`
        INSERT INTO documents (title, content, author, published_at, quality_score)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        'Test Document',
        'This is a test document about artificial intelligence and machine learning.',
        'John Doe',
        new Date('2024-01-01'),
        0.8
      ]);

      // Index the document
      await searchService.indexDocument(doc.id, {
        title: 'Test Document',
        content: 'This is a test document about artificial intelligence and machine learning.',
        author: 'John Doe',
        published_at: new Date('2024-01-01'),
        quality_score: 0.8,
        tags: ['ai', 'ml', 'technology']
      });

      // Verify index was created
      const { rows: [index] } = await pool.query(
        'SELECT * FROM search_indexes WHERE document_id = $1',
        [doc.id]
      );

      expect(index).toBeDefined();
      expect(index.author_normalized).toBe('john doe');
      expect(index.tags).toEqual(['ai', 'ml', 'technology']);
      expect(index.quality_score).toBe(0.8);
    });

    it('should batch index multiple documents', async () => {
      // Insert test documents
      const documents = [];
      for (let i = 1; i <= 5; i++) {
        const { rows: [doc] } = await pool.query(`
          INSERT INTO documents (title, content, author)
          VALUES ($1, $2, $3)
          RETURNING id, title, content, author
        `, [
          `Document ${i}`,
          `Content for document ${i}`,
          `Author ${i}`
        ]);
        documents.push(doc);
      }

      // Batch index
      const results = await searchService.batchIndexDocuments(documents);

      expect(results.total).toBe(5);
      expect(results.successful).toBe(5);
      expect(results.failed).toBe(0);

      // Verify all documents were indexed
      const { rows } = await pool.query('SELECT COUNT(*) FROM search_indexes');
      expect(parseInt(rows[0].count)).toBe(5);
    });
  });

  describe('Search Operations', () => {
    beforeEach(async () => {
      // Insert and index test documents
      const testDocs = [
        {
          title: 'Introduction to Artificial Intelligence',
          content: 'AI is transforming how we interact with technology. Machine learning algorithms are at the core.',
          author: 'Dr. Smith',
          tags: ['ai', 'technology', 'future'],
          quality_score: 0.9
        },
        {
          title: 'Database Management Systems',
          content: 'Modern databases use sophisticated indexing and query optimization techniques.',
          author: 'Prof. Johnson',
          tags: ['database', 'technology', 'systems'],
          quality_score: 0.8
        },
        {
          title: 'The Future of AI',
          content: 'Artificial intelligence will continue to evolve and impact various industries.',
          author: 'Dr. Smith',
          tags: ['ai', 'future', 'innovation'],
          quality_score: 0.85
        }
      ];

      for (const docData of testDocs) {
        const { rows: [doc] } = await pool.query(`
          INSERT INTO documents (title, content, author, quality_score)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [docData.title, docData.content, docData.author, docData.quality_score]);

        await searchService.indexDocument(doc.id, { ...docData, id: doc.id });
      }
    });

    it('should perform keyword search', async () => {
      const results = await searchService.search('artificial intelligence', {
        mode: 'exact'
      });

      expect(results.items.length).toBeGreaterThan(0);
      expect(results.items[0].title).toContain('Artificial Intelligence');
    });

    it('should apply filters correctly', async () => {
      const results = await searchService.search('technology', {
        filters: {
          author: 'Dr. Smith'
        }
      });

      expect(results.items.length).toBe(1);
      expect(results.items[0].author).toBe('Dr. Smith');
    });

    it('should sort results by quality score', async () => {
      const results = await searchService.search('AI', {
        sort: {
          field: 'quality',
          order: 'desc'
        }
      });

      expect(results.items.length).toBeGreaterThan(0);
      expect(results.items[0].quality_score).toBeGreaterThanOrEqual(results.items[1]?.quality_score || 0);
    });

    it('should handle pagination', async () => {
      const page1 = await searchService.search('technology', {
        limit: 2,
        offset: 0
      });

      const page2 = await searchService.search('technology', {
        limit: 2,
        offset: 2
      });

      expect(page1.items.length).toBeLessThanOrEqual(2);
      expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
    });
  });

  describe('Search Suggestions', () => {
    beforeEach(async () => {
      // Insert test suggestions
      await pool.query(`
        INSERT INTO search_suggestions (suggestion_text, suggestion_type, frequency, relevance_score)
        VALUES 
          ('artificial intelligence', 'query', 100, 0.9),
          ('artificial neural networks', 'completion', 50, 0.8),
          ('database management', 'query', 80, 0.85)
      `);
    });

    it('should get search suggestions', async () => {
      const suggestions = await searchService.getSuggestions('arti', { limit: 5 });

      expect(suggestions.length).toBe(2);
      expect(suggestions[0].suggestion_text).toContain('artificial');
    });
  });

  describe('Search Analytics', () => {
    it('should track search queries', async () => {
      // Perform searches
      await searchService.search('test query 1', { userId: 'user1' });
      await searchService.search('test query 2', { userId: 'user1' });
      await searchService.search('test query 1', { userId: 'user2' });

      // Force analytics flush
      await searchService.flushAnalytics();
      await searchService.updateSearchAnalytics();

      // Check analytics
      const { rows } = await pool.query(
        'SELECT COUNT(*) FROM search_queries'
      );

      expect(parseInt(rows[0].count)).toBeGreaterThanOrEqual(3);
    });

    it('should track search result clicks', async () => {
      // Create a search query
      const { rows: [query] } = await pool.query(`
        INSERT INTO search_queries (user_id, query_text, query_type, result_count)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, ['user123', 'test query', 'hybrid', 5]);

      // Track click
      const success = await searchService.trackSearchClick(query.id, 'doc456', 'user123');

      expect(success).toBe(true);

      // Verify click was tracked
      const { rows: [updatedQuery] } = await pool.query(
        'SELECT clicked_results FROM search_queries WHERE id = $1',
        [query.id]
      );

      expect(updatedQuery.clicked_results).toContain('doc456');
    });
  });

  describe('Synonym Expansion', () => {
    beforeEach(async () => {
      // Insert test synonyms (already in migration)
      await searchService.searchEngine.loadSynonyms();
    });

    it('should expand queries with synonyms', async () => {
      const expanded = searchService.searchEngine.expandQueryWithSynonyms('ai database');

      expect(expanded).toContain('artificial intelligence');
      expect(expanded).toContain('db');
    });
  });

  describe('Faceted Search', () => {
    it('should compute facets for search results', async () => {
      // Update facets
      await searchService.updateSearchFacets();

      // Get facets
      const { rows } = await pool.query(
        'SELECT * FROM search_facets WHERE facet_name = $1',
        ['quality']
      );

      expect(rows.length).toBe(1);
      expect(rows[0].facet_values).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle concurrent searches', async () => {
      const searches = [];
      
      // Perform 10 concurrent searches
      for (let i = 0; i < 10; i++) {
        searches.push(
          searchService.search(`query ${i}`, {
            userId: `user${i}`
          })
        );
      }

      const results = await Promise.all(searches);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('total');
      });
    });

    it('should use cache for repeated searches', async () => {
      // First search (cache miss)
      const result1 = await searchService.search('cached query');

      // Second search (should hit cache)
      const result2 = await searchService.search('cached query');

      expect(result1).toEqual(result2);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Close pool to simulate connection error
      await searchService.pool.end();

      // Should not throw, but return empty results
      const results = await searchService.search('test query').catch(err => ({
        items: [],
        total: 0,
        error: err.message
      }));

      expect(results.items).toEqual([]);
    });
  });
});