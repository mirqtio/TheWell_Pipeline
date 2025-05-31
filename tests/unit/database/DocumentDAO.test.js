const DocumentDAO = require('../../../src/database/DocumentDAO');

describe('DocumentDAO', () => {
    let documentDAO;
    let mockDb;

    beforeEach(() => {
        mockDb = {
            query: jest.fn(),
            transaction: jest.fn()
        };
        documentDAO = new DocumentDAO(mockDb);
    });

    describe('create', () => {
        it('should create a document successfully', async () => {
            const documentData = {
                source_id: 'source-123',
                external_id: 'ext-456',
                title: 'Test Document',
                content: 'This is test content',
                content_type: 'text/plain',
                url: 'https://example.com/doc',
                metadata: { author: 'Test Author' },
                hash: 'abc123',
                word_count: 4,
                language: 'en'
            };

            const expectedResult = { id: 'doc-123', ...documentData };
            mockDb.query.mockResolvedValue({ rows: [expectedResult] });

            const result = await documentDAO.create(documentData);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO documents'),
                [
                    'source-123', 'ext-456', 'Test Document', 'This is test content',
                    'text/plain', 'https://example.com/doc', '{"author":"Test Author"}',
                    'abc123', 4, 'en'
                ]
            );
            expect(result).toEqual(expectedResult);
        });

        it('should handle creation errors', async () => {
            const documentData = { title: 'Test' };
            const error = new Error('Database error');
            mockDb.query.mockRejectedValue(error);

            await expect(documentDAO.create(documentData)).rejects.toThrow('Database error');
        });

        it('should use default values for optional fields', async () => {
            const documentData = {
                title: 'Test Document',
                content: 'Test content'
            };

            mockDb.query.mockResolvedValue({ rows: [{ id: 'doc-123' }] });

            await documentDAO.create(documentData);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO documents'),
                [
                    undefined, undefined, 'Test Document', 'Test content',
                    'text/plain', undefined, '{}', undefined, undefined, undefined
                ]
            );
        });
    });

    describe('findById', () => {
        it('should find document by ID', async () => {
            const documentId = 'doc-123';
            const expectedDoc = {
                id: documentId,
                title: 'Test Document',
                visibility_level: 'internal'
            };

            mockDb.query.mockResolvedValue({ rows: [expectedDoc] });

            const result = await documentDAO.findById(documentId);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT d.*, dv.visibility_level'),
                [documentId]
            );
            expect(result).toEqual(expectedDoc);
        });

        it('should return null when document not found', async () => {
            mockDb.query.mockResolvedValue({ rows: [] });

            const result = await documentDAO.findById('nonexistent');

            expect(result).toBeNull();
        });

        it('should handle query errors', async () => {
            const error = new Error('Database error');
            mockDb.query.mockRejectedValue(error);

            await expect(documentDAO.findById('doc-123')).rejects.toThrow('Database error');
        });
    });

    describe('findByHash', () => {
        it('should find document by hash', async () => {
            const hash = 'abc123';
            const expectedDoc = { id: 'doc-123', hash };

            mockDb.query.mockResolvedValue({ rows: [expectedDoc] });

            const result = await documentDAO.findByHash(hash);

            expect(mockDb.query).toHaveBeenCalledWith(
                'SELECT * FROM documents WHERE hash = $1',
                [hash]
            );
            expect(result).toEqual(expectedDoc);
        });

        it('should return null when hash not found', async () => {
            mockDb.query.mockResolvedValue({ rows: [] });

            const result = await documentDAO.findByHash('nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('search', () => {
        it('should search documents with basic query', async () => {
            const searchTerm = 'test query';
            const expectedDocs = [
                { id: 'doc-1', title: 'Test Document 1', rank: 0.8 },
                { id: 'doc-2', title: 'Test Document 2', rank: 0.6 }
            ];

            mockDb.query.mockResolvedValue({ rows: expectedDocs });

            const result = await documentDAO.search(searchTerm);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('search_vector @@ plainto_tsquery'),
                [searchTerm, 50, 0]
            );
            expect(result).toEqual(expectedDocs);
        });

        it('should search with filters', async () => {
            const searchTerm = 'test';
            const options = {
                source_id: 'source-123',
                visibility_level: 'public',
                content_type: 'text/html',
                language: 'en',
                limit: 25,
                offset: 10
            };

            mockDb.query.mockResolvedValue({ rows: [] });

            await documentDAO.search(searchTerm, options);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('AND d.source_id = $2'),
                [searchTerm, 'source-123', 'public', 'text/html', 'en', 25, 10]
            );
        });

        it('should handle search errors', async () => {
            const error = new Error('Search error');
            mockDb.query.mockRejectedValue(error);

            await expect(documentDAO.search('test')).rejects.toThrow('Search error');
        });
    });

    describe('findBySource', () => {
        it('should find documents by source', async () => {
            const sourceId = 'source-123';
            const expectedDocs = [
                { id: 'doc-1', source_id: sourceId },
                { id: 'doc-2', source_id: sourceId }
            ];

            mockDb.query.mockResolvedValue({ rows: expectedDocs });

            const result = await documentDAO.findBySource(sourceId);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE d.source_id = $1'),
                [sourceId, 100, 0]
            );
            expect(result).toEqual(expectedDocs);
        });

        it('should use custom options', async () => {
            const sourceId = 'source-123';
            const options = {
                limit: 50,
                offset: 25,
                order: 'title ASC'
            };

            mockDb.query.mockResolvedValue({ rows: [] });

            await documentDAO.findBySource(sourceId, options);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('ORDER BY title ASC'),
                [sourceId, 50, 25]
            );
        });
    });

    describe('update', () => {
        it('should update document successfully', async () => {
            const documentId = 'doc-123';
            const updateData = {
                title: 'Updated Title',
                content: 'Updated content',
                metadata: { updated: true }
            };
            const expectedResult = { id: documentId, ...updateData };

            mockDb.query.mockResolvedValue({ rows: [expectedResult] });

            const result = await documentDAO.update(documentId, updateData);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE documents'),
                ['Updated Title', 'Updated content', '{"updated":true}', documentId]
            );
            expect(result).toEqual(expectedResult);
        });

        it('should throw error when no fields to update', async () => {
            await expect(documentDAO.update('doc-123', {})).rejects.toThrow('No fields to update');
        });

        it('should throw error when document not found', async () => {
            mockDb.query.mockResolvedValue({ rows: [] });

            await expect(documentDAO.update('doc-123', { title: 'New Title' }))
                .rejects.toThrow('Document not found');
        });
    });

    describe('delete', () => {
        it('should delete document successfully', async () => {
            const documentId = 'doc-123';
            mockDb.query.mockResolvedValue({ rows: [{ id: documentId }] });

            const result = await documentDAO.delete(documentId);

            expect(mockDb.query).toHaveBeenCalledWith(
                'DELETE FROM documents WHERE id = $1 RETURNING id',
                [documentId]
            );
            expect(result).toBe(true);
        });

        it('should throw error when document not found', async () => {
            mockDb.query.mockResolvedValue({ rows: [] });

            await expect(documentDAO.delete('nonexistent')).rejects.toThrow('Document not found');
        });
    });

    describe('findPendingReview', () => {
        it('should find documents pending review', async () => {
            const expectedDocs = [
                { id: 'doc-1', title: 'Pending Doc 1' },
                { id: 'doc-2', title: 'Pending Doc 2' }
            ];

            mockDb.query.mockResolvedValue({ rows: expectedDocs });

            const result = await documentDAO.findPendingReview();

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE dr.id IS NULL'),
                [50, 0]
            );
            expect(result).toEqual(expectedDocs);
        });

        it('should use custom options', async () => {
            const options = { limit: 25, offset: 10 };
            mockDb.query.mockResolvedValue({ rows: [] });

            await documentDAO.findPendingReview(options);

            expect(mockDb.query).toHaveBeenCalledWith(
                expect.anything(),
                [25, 10]
            );
        });
    });

    describe('getStats', () => {
        it('should return document statistics', async () => {
            mockDb.query
                .mockResolvedValueOnce({ rows: [{ count: '1000' }] }) // total
                .mockResolvedValueOnce({ rows: [
                    { visibility_level: 'public', count: '500' },
                    { visibility_level: 'internal', count: '300' }
                ]}) // by_visibility
                .mockResolvedValueOnce({ rows: [
                    { content_type: 'text/plain', count: '600' },
                    { content_type: 'text/html', count: '400' }
                ]}) // by_content_type
                .mockResolvedValueOnce({ rows: [{ count: '50' }] }); // recent

            const stats = await documentDAO.getStats();

            expect(stats.total).toBe(1000);
            expect(stats.by_visibility).toHaveLength(2);
            expect(stats.by_content_type).toHaveLength(2);
            expect(stats.recent).toBe(50);
        });
    });

    describe('bulkCreate', () => {
        it('should create multiple documents in transaction', async () => {
            const documents = [
                { title: 'Doc 1', content: 'Content 1' },
                { title: 'Doc 2', content: 'Content 2' }
            ];

            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] })
                    .mockResolvedValueOnce({ rows: [{ id: 'doc-2' }] })
            };

            mockDb.transaction.mockImplementation(async (callback) => {
                return await callback(mockClient);
            });

            const result = await documentDAO.bulkCreate(documents);

            expect(mockDb.transaction).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('doc-1');
            expect(result[1].id).toBe('doc-2');
        });

        it('should handle bulk creation errors', async () => {
            const documents = [{ title: 'Doc 1' }];
            const error = new Error('Transaction error');
            
            mockDb.transaction.mockRejectedValue(error);

            await expect(documentDAO.bulkCreate(documents)).rejects.toThrow('Transaction error');
        });
    });
});
