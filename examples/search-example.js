/**
 * Example: Using the Intelligent Search Feature
 * 
 * This example demonstrates how to use the SearchService to perform
 * various types of searches in TheWell Pipeline.
 */

const SearchService = require('../src/services/SearchService');
const logger = require('../src/utils/logger');

async function runSearchExamples() {
  // Initialize the search service
  const searchService = new SearchService({
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'thewell_db'
    },
    embedding: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small'
    },
    cache: {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      }
    }
  });

  try {
    logger.info('Initializing search service...');
    await searchService.initialize();

    // Example 1: Basic hybrid search
    logger.info('\n=== Example 1: Basic Hybrid Search ===');
    const basicResults = await searchService.search('artificial intelligence machine learning', {
      limit: 5
    });
    
    logger.info(`Found ${basicResults.total} results`);
    basicResults.items.forEach((item, idx) => {
      logger.info(`${idx + 1}. ${item.title} (relevance: ${item.relevanceScore.toFixed(3)})`);
    });

    // Example 2: Semantic search only
    logger.info('\n=== Example 2: Semantic Search ===');
    const semanticResults = await searchService.search('How does AI impact healthcare?', {
      mode: 'semantic',
      limit: 3
    });
    
    logger.info(`Found ${semanticResults.total} semantic matches`);
    semanticResults.items.forEach((item, idx) => {
      logger.info(`${idx + 1}. ${item.title} (similarity: ${item.relevanceScore.toFixed(3)})`);
    });

    // Example 3: Exact match search
    logger.info('\n=== Example 3: Exact Match Search ===');
    const exactResults = await searchService.search('database management', {
      mode: 'exact',
      limit: 3
    });
    
    logger.info(`Found ${exactResults.total} exact matches`);

    // Example 4: Fuzzy search
    logger.info('\n=== Example 4: Fuzzy Search ===');
    const fuzzyResults = await searchService.search('artifical inteligence', { // Intentional typos
      mode: 'fuzzy',
      limit: 3
    });
    
    logger.info(`Found ${fuzzyResults.total} fuzzy matches (despite typos)`);

    // Example 5: Filtered search
    logger.info('\n=== Example 5: Filtered Search ===');
    const filteredResults = await searchService.search('technology', {
      filters: {
        author: 'Dr. Smith',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        minQuality: 0.7,
        tags: ['ai', 'innovation']
      },
      limit: 5
    });
    
    logger.info(`Found ${filteredResults.total} filtered results`);

    // Example 6: Search with facets
    logger.info('\n=== Example 6: Search with Facets ===');
    const facetedResults = await searchService.search('machine learning', {
      facets: ['author', 'tags', 'quality'],
      includeFacets: true,
      limit: 10
    });
    
    if (facetedResults.facets) {
      logger.info('Facets:');
      Object.entries(facetedResults.facets).forEach(([facetType, values]) => {
        logger.info(`  ${facetType}:`);
        values.slice(0, 3).forEach(facet => {
          logger.info(`    - ${facet.value}: ${facet.count} documents`);
        });
      });
    }

    // Example 7: Get search suggestions
    logger.info('\n=== Example 7: Search Suggestions ===');
    const suggestions = await searchService.getSuggestions('arti', { limit: 5 });
    
    logger.info('Suggestions for "arti":');
    suggestions.forEach(suggestion => {
      logger.info(`  - ${suggestion.suggestion_text} (${suggestion.suggestion_type})`);
    });

    // Example 8: Index a new document
    logger.info('\n=== Example 8: Index New Document ===');
    const newDocument = {
      id: 'example-doc-123',
      title: 'Introduction to Quantum Computing',
      content: 'Quantum computing represents a fundamental shift in how we process information...',
      author: 'Dr. Jane Smith',
      tags: ['quantum', 'computing', 'physics', 'technology'],
      categories: ['Technology', 'Science'],
      published_at: new Date('2024-03-15'),
      quality_score: 0.95,
      believability_score: 0.9
    };

    await searchService.indexDocument(newDocument.id, newDocument);
    logger.info('Document indexed successfully');

    // Example 9: Complex query with boolean operators
    logger.info('\n=== Example 9: Complex Boolean Query ===');
    const complexResults = await searchService.search(
      '(artificial intelligence OR machine learning) AND healthcare NOT diagnosis',
      {
        mode: 'hybrid',
        limit: 5
      }
    );
    
    logger.info(`Found ${complexResults.total} results for complex query`);

    // Example 10: Get search analytics (admin only)
    logger.info('\n=== Example 10: Search Analytics ===');
    const analytics = await searchService.getSearchAnalytics({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      groupBy: 'day'
    });
    
    if (analytics.length > 0) {
      logger.info('Recent search analytics:');
      analytics.slice(0, 3).forEach(day => {
        logger.info(`  ${day.date}: ${day.total_queries} queries, ${day.unique_users} unique users`);
      });
    }

    // Example 11: Batch indexing
    logger.info('\n=== Example 11: Batch Document Indexing ===');
    const documentsToIndex = [
      {
        id: 'batch-1',
        title: 'Deep Learning Fundamentals',
        content: 'Deep learning is a subset of machine learning...',
        author: 'Prof. Johnson',
        tags: ['deep-learning', 'neural-networks']
      },
      {
        id: 'batch-2',
        title: 'Natural Language Processing',
        content: 'NLP enables computers to understand human language...',
        author: 'Dr. Chen',
        tags: ['nlp', 'ai', 'linguistics']
      }
    ];

    const batchResults = await searchService.batchIndexDocuments(documentsToIndex);
    logger.info(`Batch indexing: ${batchResults.successful}/${batchResults.total} successful`);

    // Get service status
    logger.info('\n=== Service Status ===');
    const status = await searchService.getStatus();
    logger.info('Search service status:', JSON.stringify(status, null, 2));

  } catch (error) {
    logger.error('Search example error:', error);
  } finally {
    // Shutdown the service
    await searchService.shutdown();
    logger.info('Search service shutdown complete');
  }
}

// Run the examples
if (require.main === module) {
  runSearchExamples()
    .then(() => {
      logger.info('Search examples completed');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { runSearchExamples };