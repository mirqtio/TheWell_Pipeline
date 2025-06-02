const DatabaseManager = require('../../src/database/DatabaseManager');
const DocumentDAO = require('../../src/database/DocumentDAO');
const QueryCache = require('../../src/cache/QueryCache');
const EmbeddingCache = require('../../src/cache/EmbeddingCache');
const { performance } = require('perf_hooks');

/**
 * Performance Test Runner for load testing and benchmarking
 */
class PerformanceTestRunner {
    constructor() {
        this.db = new DatabaseManager();
        this.documentDAO = new DocumentDAO(this.db);
        this.queryCache = new QueryCache();
        this.embeddingCache = new EmbeddingCache();
        this.results = [];
    }

    /**
     * Initialize test environment
     */
    async initialize() {
        await this.db.connect();
        console.log('Performance test environment initialized');
    }

    /**
     * Cleanup test environment
     */
    async cleanup() {
        await this.db.disconnect();
        console.log('Performance test environment cleaned up');
    }

    /**
     * Measure execution time of a function
     */
    async measureTime(name, fn) {
        const start = performance.now();
        const result = await fn();
        const end = performance.now();
        const duration = end - start;
        
        this.results.push({
            test: name,
            duration: duration,
            timestamp: new Date().toISOString()
        });
        
        console.log(`${name}: ${duration.toFixed(2)}ms`);
        return { result, duration };
    }

    /**
     * Generate test documents for load testing
     */
    generateTestDocuments(count = 1000) {
        const documents = [];
        
        for (let i = 0; i < count; i++) {
            documents.push({
                title: `Test Document ${i}`,
                content: `This is test content for document ${i}. `.repeat(Math.floor(Math.random() * 100) + 50),
                url: `https://example.com/doc/${i}`,
                metadata: {
                    test: true,
                    index: i,
                    category: `category_${i % 10}`,
                    priority: Math.floor(Math.random() * 5) + 1
                },
                visibility: i % 2 === 0 ? 'public' : 'internal'
            });
        }
        
        return documents;
    }

    /**
     * Test database insertion performance
     */
    async testDatabaseInsertionPerformance(documentCount = 1000) {
        console.log(`\n=== Database Insertion Performance Test (${documentCount} documents) ===`);
        
        const documents = this.generateTestDocuments(documentCount);
        
        // Test single insertions
        const singleInsertResults = await this.measureTime(
            'Single Document Insertions',
            async () => {
                const results = [];
                for (const doc of documents.slice(0, 100)) { // Test first 100
                    const result = await this.documentDAO.create(doc);
                    results.push(result);
                }
                return results;
            }
        );
        
        // Test batch insertions
        const batchInsertResults = await this.measureTime(
            'Batch Document Insertions',
            async () => {
                return await this.documentDAO.createMany(documents.slice(100, 600)); // Test 500 docs
            }
        );
        
        return {
            singleInserts: singleInsertResults,
            batchInserts: batchInsertResults
        };
    }

    /**
     * Test database query performance
     */
    async testDatabaseQueryPerformance() {
        console.log('\n=== Database Query Performance Test ===');
        
        // Test simple queries
        await this.measureTime(
            'Simple Document Count Query',
            async () => {
                return await this.db.query('SELECT COUNT(*) FROM documents WHERE metadata @> $1', [{ test: true }]);
            }
        );
        
        // Test complex queries with joins
        await this.measureTime(
            'Complex Query with Metadata Filter',
            async () => {
                return await this.db.query(`
                    SELECT d.id, d.title, d.content, d.metadata, d.visibility
                    FROM documents d
                    WHERE d.metadata @> $1
                    AND d.visibility = $2
                    ORDER BY d.created_at DESC
                    LIMIT 100
                `, [{ test: true }, 'public']);
            }
        );
        
        // Test vector similarity queries (if embeddings exist)
        await this.measureTime(
            'Vector Similarity Query',
            async () => {
                const sampleEmbedding = new Array(1536).fill(0).map(() => Math.random());
                return await this.db.query(`
                    SELECT id, title, embedding <-> $1 as distance
                    FROM documents
                    WHERE embedding IS NOT NULL
                    ORDER BY embedding <-> $1
                    LIMIT 10
                `, [JSON.stringify(sampleEmbedding)]);
            }
        );
        
        // Test full-text search
        await this.measureTime(
            'Full-Text Search Query',
            async () => {
                return await this.db.query(`
                    SELECT id, title, content
                    FROM documents
                    WHERE to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)
                    LIMIT 50
                `, ['test document']);
            }
        );
    }

    /**
     * Test cache performance
     */
    async testCachePerformance() {
        console.log('\n=== Cache Performance Test ===');
        
        const testQueries = [
            'test query 1',
            'test query 2',
            'test query 3',
            'test query 4',
            'test query 5'
        ];
        
        const testResults = [
            { documents: [{ id: '1', title: 'Test 1' }] },
            { documents: [{ id: '2', title: 'Test 2' }] },
            { documents: [{ id: '3', title: 'Test 3' }] },
            { documents: [{ id: '4', title: 'Test 4' }] },
            { documents: [{ id: '5', title: 'Test 5' }] }
        ];
        
        // Test cache writes
        await this.measureTime(
            'Cache Write Operations',
            async () => {
                for (let i = 0; i < testQueries.length; i++) {
                    await this.queryCache.set(testQueries[i], testResults[i]);
                }
            }
        );
        
        // Test cache reads
        await this.measureTime(
            'Cache Read Operations',
            async () => {
                const results = [];
                for (const query of testQueries) {
                    const result = await this.queryCache.get(query);
                    results.push(result);
                }
                return results;
            }
        );
        
        // Test cache misses
        await this.measureTime(
            'Cache Miss Operations',
            async () => {
                const results = [];
                for (let i = 0; i < 100; i++) {
                    const result = await this.queryCache.get(`non-existent-query-${i}`);
                    results.push(result);
                }
                return results;
            }
        );
    }

    /**
     * Test concurrent operations
     */
    async testConcurrentOperations(concurrency = 10) {
        console.log(`\n=== Concurrent Operations Test (${concurrency} concurrent) ===`);
        
        const testDocuments = this.generateTestDocuments(concurrency);
        
        // Test concurrent insertions
        await this.measureTime(
            'Concurrent Document Insertions',
            async () => {
                const promises = testDocuments.map(doc => this.documentDAO.create(doc));
                return await Promise.all(promises);
            }
        );
        
        // Test concurrent queries
        await this.measureTime(
            'Concurrent Query Operations',
            async () => {
                const promises = Array(concurrency).fill(0).map((_, i) => 
                    this.db.query('SELECT COUNT(*) FROM documents WHERE metadata @> $1', [{ test: true }])
                );
                return await Promise.all(promises);
            }
        );
        
        // Test concurrent cache operations
        await this.measureTime(
            'Concurrent Cache Operations',
            async () => {
                const promises = Array(concurrency).fill(0).map((_, i) => 
                    this.queryCache.set(`concurrent-test-${i}`, { data: `test-${i}` })
                );
                return await Promise.all(promises);
            }
        );
    }

    /**
     * Test memory usage patterns
     */
    async testMemoryUsage() {
        console.log('\n=== Memory Usage Test ===');
        
        const getMemoryUsage = () => {
            const usage = process.memoryUsage();
            return {
                rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100,
                heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
                heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
                external: Math.round(usage.external / 1024 / 1024 * 100) / 100
            };
        };
        
        const initialMemory = getMemoryUsage();
        console.log('Initial memory usage:', initialMemory);
        
        // Create large dataset in memory
        const largeDataset = this.generateTestDocuments(10000);
        const afterDatasetMemory = getMemoryUsage();
        console.log('Memory after creating large dataset:', afterDatasetMemory);
        
        // Process dataset
        let processedCount = 0;
        for (const doc of largeDataset) {
            // Simulate processing
            JSON.stringify(doc);
            processedCount++;
            
            if (processedCount % 1000 === 0) {
                const currentMemory = getMemoryUsage();
                console.log(`Memory after processing ${processedCount} documents:`, currentMemory);
            }
        }
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            const afterGCMemory = getMemoryUsage();
            console.log('Memory after garbage collection:', afterGCMemory);
        }
        
        return {
            initial: initialMemory,
            afterDataset: afterDatasetMemory,
            final: getMemoryUsage()
        };
    }

    /**
     * Run comprehensive performance test suite
     */
    async runFullTestSuite() {
        console.log('Starting comprehensive performance test suite...\n');
        
        await this.initialize();
        
        try {
            // Database performance tests
            await this.testDatabaseInsertionPerformance(1000);
            await this.testDatabaseQueryPerformance();
            
            // Cache performance tests
            await this.testCachePerformance();
            
            // Concurrent operations tests
            await this.testConcurrentOperations(10);
            await this.testConcurrentOperations(50);
            
            // Memory usage tests
            await this.testMemoryUsage();
            
            // Generate performance report
            this.generatePerformanceReport();
            
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Generate performance report
     */
    generatePerformanceReport() {
        console.log('\n=== Performance Test Report ===');
        
        const report = {
            testRun: new Date().toISOString(),
            totalTests: this.results.length,
            results: this.results,
            summary: {
                averageDuration: this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length,
                slowestTest: this.results.reduce((max, r) => r.duration > max.duration ? r : max),
                fastestTest: this.results.reduce((min, r) => r.duration < min.duration ? r : min)
            }
        };
        
        console.log('Total tests run:', report.totalTests);
        console.log('Average test duration:', report.summary.averageDuration.toFixed(2) + 'ms');
        console.log('Slowest test:', report.summary.slowestTest.test, '-', report.summary.slowestTest.duration.toFixed(2) + 'ms');
        console.log('Fastest test:', report.summary.fastestTest.test, '-', report.summary.fastestTest.duration.toFixed(2) + 'ms');
        
        // Save report to file
        const fs = require('fs').promises;
        const reportPath = `./performance-report-${Date.now()}.json`;
        fs.writeFile(reportPath, JSON.stringify(report, null, 2))
            .then(() => console.log(`Performance report saved to: ${reportPath}`))
            .catch(err => console.error('Failed to save performance report:', err));
        
        return report;
    }
}

module.exports = { PerformanceTestRunner };
