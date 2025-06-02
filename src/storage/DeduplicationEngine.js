/**
 * DeduplicationEngine - Advanced document deduplication with multiple strategies
 * 
 * Implements aggressive deduplication using:
 * - Content hash comparison (exact duplicates)
 * - Vector similarity search (semantic duplicates)
 * - URL normalization and comparison
 * - Title fuzzy matching
 * - Metadata-based deduplication
 */

const crypto = require('crypto');
const { Pool } = require('pg');
const logger = require('../utils/logger');

class DeduplicationEngine {
    constructor(config = {}) {
        this.config = {
            // Similarity thresholds
            vectorSimilarityThreshold: config.vectorSimilarityThreshold || 0.95,
            titleSimilarityThreshold: config.titleSimilarityThreshold || 0.85,
            contentSimilarityThreshold: config.contentSimilarityThreshold || 0.90,
            
            // Deduplication strategies
            enableContentHash: config.enableContentHash !== false,
            enableVectorSimilarity: config.enableVectorSimilarity !== false,
            enableUrlNormalization: config.enableUrlNormalization !== false,
            enableTitleFuzzy: config.enableTitleFuzzy !== false,
            
            // Processing limits
            maxCandidatesPerCheck: config.maxCandidatesPerCheck || 100,
            batchSize: config.batchSize || 50,
            
            // Database connection
            database: config.database || process.env.DATABASE_URL,
            
            ...config
        };
        
        this.db = new Pool({ connectionString: this.config.database });
        this.stats = {
            documentsProcessed: 0,
            duplicatesDetected: 0,
            duplicatesMerged: 0,
            strategiesUsed: new Map()
        };
    }

    /**
     * Check if a document is a duplicate of existing documents
     * @param {Object} document - Document to check
     * @returns {Object} - Deduplication result with duplicates found
     */
    async checkForDuplicates(document) {
        try {
            const duplicates = [];
            
            // Strategy 1: Content hash comparison (fastest, exact matches)
            if (this.config.enableContentHash && document.hash) {
                const hashDuplicates = await this.findContentHashDuplicates(document.hash, document.id);
                duplicates.push(...hashDuplicates.map(d => ({ ...d, strategy: 'content_hash', score: 1.0 })));
                this.stats.strategiesUsed.set('content_hash', (this.stats.strategiesUsed.get('content_hash') || 0) + 1);
            }

            // Strategy 2: URL normalization (common for web content)
            if (this.config.enableUrlNormalization && document.url) {
                const urlDuplicates = await this.findUrlDuplicates(document.url, document.id);
                duplicates.push(...urlDuplicates.map(d => ({ ...d, strategy: 'url', score: 1.0 })));
                this.stats.strategiesUsed.set('url', (this.stats.strategiesUsed.get('url') || 0) + 1);
            }

            // Strategy 3: Vector similarity (semantic duplicates)
            if (this.config.enableVectorSimilarity && document.embedding) {
                const vectorDuplicates = await this.findVectorSimilarityDuplicates(document.embedding, document.id);
                duplicates.push(...vectorDuplicates);
                this.stats.strategiesUsed.set('vector_similarity', (this.stats.strategiesUsed.get('vector_similarity') || 0) + 1);
            }

            // Strategy 4: Title fuzzy matching
            if (this.config.enableTitleFuzzy && document.title) {
                const titleDuplicates = await this.findTitleSimilarityDuplicates(document.title, document.id);
                duplicates.push(...titleDuplicates);
                this.stats.strategiesUsed.set('title_fuzzy', (this.stats.strategiesUsed.get('title_fuzzy') || 0) + 1);
            }

            // Remove duplicates from results and sort by confidence
            const uniqueDuplicates = this.deduplicateResults(duplicates);
            
            this.stats.documentsProcessed++;
            if (uniqueDuplicates.length > 0) {
                this.stats.duplicatesDetected++;
            }

            return {
                isDuplicate: uniqueDuplicates.length > 0,
                duplicates: uniqueDuplicates,
                strategies: Array.from(this.stats.strategiesUsed.keys())
            };

        } catch (error) {
            logger.error('Error in duplicate detection:', error);
            throw error;
        }
    }

    /**
     * Find exact content hash duplicates
     */
    async findContentHashDuplicates(hash, excludeId = null) {
        const query = `
            SELECT id, title, url, created_at, hash
            FROM documents 
            WHERE hash = $1 
            ${excludeId ? 'AND id != $2' : ''}
            LIMIT $${excludeId ? '3' : '2'}
        `;
        
        const params = excludeId ? [hash, excludeId, this.config.maxCandidatesPerCheck] : [hash, this.config.maxCandidatesPerCheck];
        const result = await this.db.query(query, params);
        
        return result.rows;
    }

    /**
     * Find URL-based duplicates with normalization
     */
    async findUrlDuplicates(url, excludeId = null) {
        const normalizedUrl = this.normalizeUrl(url);
        
        const query = `
            SELECT id, title, url, created_at, hash
            FROM documents 
            WHERE url = $1 OR url = $2
            ${excludeId ? 'AND id != $3' : ''}
            LIMIT $${excludeId ? '4' : '3'}
        `;
        
        const params = excludeId ? [url, normalizedUrl, excludeId, this.config.maxCandidatesPerCheck] : [url, normalizedUrl, this.config.maxCandidatesPerCheck];
        const result = await this.db.query(query, params);
        
        return result.rows;
    }

    /**
     * Find semantically similar documents using vector similarity
     */
    async findVectorSimilarityDuplicates(embedding, excludeId = null) {
        const query = `
            SELECT id, title, url, created_at, hash,
                   1 - (embedding <=> $1::vector) as similarity_score
            FROM documents 
            WHERE embedding IS NOT NULL 
            ${excludeId ? 'AND id != $2' : ''}
            AND 1 - (embedding <=> $1::vector) > $${excludeId ? '3' : '2'}
            ORDER BY embedding <=> $1::vector
            LIMIT $${excludeId ? '4' : '3'}
        `;
        
        const params = excludeId ? 
            [JSON.stringify(embedding), excludeId, this.config.vectorSimilarityThreshold, this.config.maxCandidatesPerCheck] :
            [JSON.stringify(embedding), this.config.vectorSimilarityThreshold, this.config.maxCandidatesPerCheck];
            
        const result = await this.db.query(query, params);
        
        return result.rows.map(row => ({
            ...row,
            strategy: 'vector_similarity',
            score: row.similarity_score
        }));
    }

    /**
     * Find title similarity duplicates using fuzzy matching
     */
    async findTitleSimilarityDuplicates(title, excludeId = null) {
        const query = `
            SELECT id, title, url, created_at, hash,
                   similarity(title, $1) as similarity_score
            FROM documents 
            WHERE similarity(title, $1) > $2
            ${excludeId ? 'AND id != $3' : ''}
            ORDER BY similarity(title, $1) DESC
            LIMIT $${excludeId ? '4' : '3'}
        `;
        
        const params = excludeId ? 
            [title, this.config.titleSimilarityThreshold, excludeId, this.config.maxCandidatesPerCheck] :
            [title, this.config.titleSimilarityThreshold, this.config.maxCandidatesPerCheck];
            
        const result = await this.db.query(query, params);
        
        return result.rows.map(row => ({
            ...row,
            strategy: 'title_fuzzy',
            score: row.similarity_score
        }));
    }

    /**
     * Record duplicate detection in the database
     */
    async recordDuplicate(primaryDocumentId, duplicateDocumentId, similarityType, similarityScore, detectionMethod) {
        const query = `
            INSERT INTO document_duplicates 
            (primary_document_id, duplicate_document_id, similarity_type, similarity_score, detection_method, status)
            VALUES ($1, $2, $3, $4, $5, 'detected')
            ON CONFLICT (primary_document_id, duplicate_document_id) 
            DO UPDATE SET 
                similarity_score = EXCLUDED.similarity_score,
                detection_method = EXCLUDED.detection_method,
                created_at = NOW()
            RETURNING id
        `;
        
        const result = await this.db.query(query, [
            primaryDocumentId, 
            duplicateDocumentId, 
            similarityType, 
            similarityScore, 
            detectionMethod
        ]);
        
        return result.rows[0];
    }

    /**
     * Merge duplicate documents
     */
    async mergeDuplicates(primaryDocumentId, duplicateDocumentIds, mergeStrategy = 'keep_primary') {
        const client = await this.db.connect();
        
        try {
            await client.query('BEGIN');
            
            for (const duplicateId of duplicateDocumentIds) {
                // Update duplicate record status
                await client.query(
                    'UPDATE document_duplicates SET status = $1, reviewed_at = NOW() WHERE duplicate_document_id = $2',
                    ['merged', duplicateId]
                );
                
                // Handle merge strategy
                if (mergeStrategy === 'keep_primary') {
                    // Soft delete duplicate document
                    await client.query(
                        'UPDATE documents SET visibility = $1 WHERE id = $2',
                        ['merged_duplicate', duplicateId]
                    );
                } else if (mergeStrategy === 'merge_metadata') {
                    // Merge metadata and keep primary
                    await this.mergeDocumentMetadata(client, primaryDocumentId, duplicateId);
                }
            }
            
            await client.query('COMMIT');
            this.stats.duplicatesMerged += duplicateDocumentIds.length;
            
            logger.info(`Merged ${duplicateDocumentIds.length} duplicates into document ${primaryDocumentId}`);
            
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error merging duplicates:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Merge metadata from duplicate into primary document
     */
    async mergeDocumentMetadata(client, primaryId, duplicateId) {
        const primaryDoc = await client.query('SELECT metadata FROM documents WHERE id = $1', [primaryId]);
        const duplicateDoc = await client.query('SELECT metadata FROM documents WHERE id = $1', [duplicateId]);
        
        const mergedMetadata = {
            ...duplicateDoc.rows[0].metadata,
            ...primaryDoc.rows[0].metadata,
            merged_from: duplicateId,
            merged_at: new Date().toISOString()
        };
        
        await client.query(
            'UPDATE documents SET metadata = $1 WHERE id = $2',
            [JSON.stringify(mergedMetadata), primaryId]
        );
    }

    /**
     * Remove duplicate results and sort by confidence
     */
    deduplicateResults(duplicates) {
        const seen = new Set();
        const unique = [];
        
        // Sort by score descending
        duplicates.sort((a, b) => (b.score || 0) - (a.score || 0));
        
        for (const duplicate of duplicates) {
            if (!seen.has(duplicate.id)) {
                seen.add(duplicate.id);
                unique.push(duplicate);
            }
        }
        
        return unique;
    }

    /**
     * Normalize URL for comparison
     */
    normalizeUrl(url) {
        try {
            const parsed = new URL(url);
            // Remove common tracking parameters
            const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'source'];
            trackingParams.forEach(param => parsed.searchParams.delete(param));
            
            // Remove trailing slash
            parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/';
            
            // Sort query parameters for consistency
            parsed.searchParams.sort();
            
            return parsed.toString();
        } catch (error) {
            return url; // Return original if parsing fails
        }
    }

    /**
     * Generate content hash for document
     */
    generateContentHash(content, title = '') {
        const normalizedContent = (content + title).toLowerCase().replace(/\s+/g, ' ').trim();
        return crypto.createHash('sha256').update(normalizedContent).digest('hex');
    }

    /**
     * Get deduplication statistics
     */
    getStats() {
        return {
            ...this.stats,
            strategiesUsed: Object.fromEntries(this.stats.strategiesUsed)
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            documentsProcessed: 0,
            duplicatesDetected: 0,
            duplicatesMerged: 0,
            strategiesUsed: new Map()
        };
    }

    /**
     * Close database connections
     */
    async close() {
        await this.db.end();
    }
}

module.exports = DeduplicationEngine;
