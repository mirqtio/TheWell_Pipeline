const FeedbackDAO = require('../../../src/database/FeedbackDAO');

describe('FeedbackDAO', () => {
  let feedbackDAO;
  let mockDb;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockDb = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient),
      pool: {
        connect: jest.fn().mockResolvedValue(mockClient)
      }
    };

    feedbackDAO = new FeedbackDAO(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createFeedback', () => {
    it('should create feedback successfully', async () => {
      const feedbackData = {
        documentId: 'doc-123',
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 4, comment: 'Good quality document' },
        userId: 'user-456',
        sessionId: 'session-789'
      };

      const mockFeedback = {
        id: 'feedback-789',
        document_id: 'doc-123',
        app_id: 'test-app',
        feedback_type: 'rating',
        content: JSON.stringify({ rating: 4, comment: 'Good quality document' }),
        user_id: 'user-456',
        session_id: 'session-789',
        created_at: new Date()
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockFeedback] }) // createFeedback
        .mockResolvedValueOnce({ rows: [{ total_feedback_count: 1, average_rating: 4 }] }) // calculate aggregates
        .mockResolvedValueOnce({ rows: [{ document_id: 'doc-123', total_feedback_count: 1, overall_score: 4 }] }); // upsert aggregates

      const result = await feedbackDAO.createFeedback(feedbackData);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feedback'),
        ['doc-123', 'test-app', 'rating', JSON.stringify({ rating: 4, comment: 'Good quality document' }), 'user-456', 'session-789']
      );
      expect(result).toEqual(mockFeedback);
    });

    it('should handle errors during feedback creation', async () => {
      const feedbackData = {
        documentId: 'doc-123',
        appId: 'test-app',
        feedbackType: 'rating',
        content: { rating: 4 },
        userId: 'user-456'
      };

      mockDb.query.mockRejectedValueOnce(new Error('Database error'));

      await expect(feedbackDAO.createFeedback(feedbackData)).rejects.toThrow('Database error');
    });
  });

  describe('createDocumentFeedback', () => {
    it('should create legacy document feedback successfully', async () => {
      const feedbackData = {
        documentId: 'doc-123',
        userId: 'user-456',
        feedbackType: 'quality',
        rating: 4,
        comment: 'Good quality document',
        metadata: { source: 'manual' }
      };

      const mockFeedback = {
        id: 'feedback-789',
        document_id: 'doc-123',
        user_id: 'user-456',
        feedback_type: 'quality',
        rating: 4,
        comment: 'Good quality document',
        metadata: JSON.stringify({ source: 'manual' }),
        created_at: new Date()
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockFeedback] }) // createDocumentFeedback
        .mockResolvedValueOnce({ rows: [{ total_feedback_count: 1, average_rating: 4 }] }) // calculate aggregates
        .mockResolvedValueOnce({ rows: [{ document_id: 'doc-123', total_feedback_count: 1, overall_score: 4 }] }); // upsert aggregates

      const result = await feedbackDAO.createDocumentFeedback(feedbackData);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO document_feedback'),
        ['doc-123', 'user-456', 'quality', 4, 'Good quality document', JSON.stringify({ source: 'manual' })]
      );
      expect(result).toEqual(mockFeedback);
    });
  });

  describe('getFeedbackById', () => {
    it('should get feedback by ID successfully', async () => {
      const feedbackId = 'feedback-123';
      const mockFeedback = {
        id: feedbackId,
        document_id: 'doc-456',
        app_id: 'test-app',
        feedback_type: 'rating',
        content: JSON.stringify({ rating: 5, comment: 'Excellent' }),
        user_id: 'user-123',
        session_id: 'session-456'
      };

      mockDb.query.mockResolvedValue({ rows: [mockFeedback] });

      const result = await feedbackDAO.getFeedbackById(feedbackId);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM feedback WHERE id = $1',
        [feedbackId]
      );
      expect(result.content).toEqual({ rating: 5, comment: 'Excellent' });
    });

    it('should return null when feedback not found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await feedbackDAO.getFeedbackById('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle get feedback by ID errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.getFeedbackById('feedback-123')).rejects.toThrow('Database error');
    });
  });

  describe('getFeedbackByDocumentId', () => {
    it('should get feedback by document ID with default options', async () => {
      const documentId = 'doc-123';
      const mockFeedback = [
        { 
          id: 'feedback-1', 
          document_id: documentId, 
          content: JSON.stringify({ rating: 4, comment: 'Good' }),
          feedback_type: 'rating'
        },
        { 
          id: 'feedback-2', 
          document_id: documentId, 
          content: JSON.stringify({ rating: 5, comment: 'Excellent' }),
          feedback_type: 'rating'
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockFeedback });

      const result = await feedbackDAO.getFeedbackByDocumentId(documentId);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM feedback WHERE document_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [documentId, 50, 0]
      );
      expect(result).toHaveLength(2);
      expect(result[0].content).toEqual({ rating: 4, comment: 'Good' });
      expect(result[1].content).toEqual({ rating: 5, comment: 'Excellent' });
    });

    it('should get feedback by document ID with feedback type filter', async () => {
      const documentId = 'doc-123';
      const feedbackType = 'rating';
      const mockFeedback = [
        { 
          id: 'feedback-1', 
          document_id: documentId, 
          feedback_type: feedbackType, 
          content: JSON.stringify({ rating: 4, comment: 'Good' })
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockFeedback });

      const result = await feedbackDAO.getFeedbackByDocumentId(documentId, { feedbackType });

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM feedback WHERE document_id = $1 AND feedback_type = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
        [documentId, feedbackType, 50, 0]
      );
      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual({ rating: 4, comment: 'Good' });
    });

    it('should get feedback by document ID with custom pagination', async () => {
      const documentId = 'doc-123';
      const options = { limit: 10, offset: 20 };

      mockDb.query.mockResolvedValue({ rows: [] });

      await feedbackDAO.getFeedbackByDocumentId(documentId, options);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM feedback WHERE document_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [documentId, 10, 20]
      );
    });

    it('should handle get feedback by document ID errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.getFeedbackByDocumentId('doc-123')).rejects.toThrow('Database error');
    });
  });

  describe('getFeedbackByUserId', () => {
    it('should get feedback by user ID successfully', async () => {
      const userId = 'user-123';
      const mockFeedback = [
        { 
          id: 'feedback-1', 
          user_id: userId, 
          content: JSON.stringify({ rating: 4, comment: 'Good' }),
          feedback_type: 'rating'
        },
        { 
          id: 'feedback-2', 
          user_id: userId, 
          content: JSON.stringify({ rating: 5, comment: 'Excellent' }),
          feedback_type: 'rating'
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockFeedback });

      const result = await feedbackDAO.getFeedbackByUserId(userId);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, 50, 0]
      );
      expect(result).toHaveLength(2);
      expect(result[0].content).toEqual({ rating: 4, comment: 'Good' });
      expect(result[1].content).toEqual({ rating: 5, comment: 'Excellent' });
    });

    it('should handle get feedback by user ID errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.getFeedbackByUserId('user-123')).rejects.toThrow('Database error');
    });
  });

  describe('updateFeedback', () => {
    it('should update feedback successfully', async () => {
      const feedbackId = 'feedback-123';
      const updateData = {
        content: { rating: 5, comment: 'Updated comment' },
        user_id: 'user-456',
        session_id: 'session-789'
      };

      const mockUpdatedFeedback = {
        id: feedbackId,
        document_id: 'doc-456',
        feedback_type: 'rating',
        content: JSON.stringify({ rating: 5, comment: 'Updated comment' }),
        user_id: 'user-456',
        session_id: 'session-789',
        updated_at: new Date()
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockUpdatedFeedback] }) // updateFeedback
        .mockResolvedValueOnce({ rows: [{ total_feedback_count: 1, average_rating: 5 }] }) // calculate aggregates
        .mockResolvedValueOnce({ rows: [{ document_id: 'doc-456', total_feedback_count: 1, overall_score: 5 }] }); // upsert aggregates

      const result = await feedbackDAO.updateFeedback(feedbackId, updateData);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE feedback'),
        [JSON.stringify({ rating: 5, comment: 'Updated comment' }), 'user-456', 'session-789', feedbackId]
      );
      expect(result.content).toEqual({ rating: 5, comment: 'Updated comment' });
    });

    it('should throw error when no valid fields to update', async () => {
      const feedbackId = 'feedback-123';
      const updateData = { invalidField: 'value' };

      await expect(feedbackDAO.updateFeedback(feedbackId, updateData)).rejects.toThrow('No valid fields to update');
    });

    it('should throw error when feedback not found', async () => {
      const feedbackId = 'feedback-123';
      const updateData = { content: { rating: 5 } };

      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(feedbackDAO.updateFeedback(feedbackId, updateData)).rejects.toThrow('Feedback not found');
    });

    it('should handle update feedback errors', async () => {
      const feedbackId = 'feedback-123';
      const updateData = { content: { rating: 5 } };

      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.updateFeedback(feedbackId, updateData)).rejects.toThrow('Database error');
    });
  });

  describe('deleteFeedback', () => {
    it('should delete feedback successfully', async () => {
      const feedbackId = 'feedback-123';
      const mockFeedback = {
        id: feedbackId,
        document_id: 'doc-456'
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [{ document_id: 'doc-456' }] }) // get document_id
        .mockResolvedValueOnce({ rows: [mockFeedback] }) // delete feedback
        .mockResolvedValueOnce({ rows: [{ total_feedback_count: 0, average_rating: 0 }] }) // calculate aggregates
        .mockResolvedValueOnce({ rows: [{ document_id: 'doc-456', total_feedback_count: 0, overall_score: 0 }] }); // upsert aggregates

      const result = await feedbackDAO.deleteFeedback(feedbackId);

      expect(mockDb.query).toHaveBeenCalledWith(
        'DELETE FROM feedback WHERE id = $1 RETURNING *',
        [feedbackId]
      );
      expect(result).toEqual(mockFeedback);
    });

    it('should throw error when feedback not found for deletion', async () => {
      const feedbackId = 'feedback-123';

      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(feedbackDAO.deleteFeedback(feedbackId)).rejects.toThrow('Feedback not found');
    });

    it('should handle delete feedback errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.deleteFeedback('feedback-123')).rejects.toThrow('Database error');
    });
  });

  describe('getFeedbackAggregates', () => {
    it('should get feedback aggregates successfully', async () => {
      const documentId = 'doc-123';
      const mockAggregates = {
        document_id: documentId,
        total_feedback_count: 10,
        overall_score: 4.5
      };

      const expectedResult = {
        document_id: documentId,
        total_feedback: 10,
        average_rating: 4.5,
        last_updated: undefined
      };

      mockDb.query.mockResolvedValue({ rows: [mockAggregates] });

      const result = await feedbackDAO.getFeedbackAggregates(documentId);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT * FROM feedback_aggregates WHERE document_id = $1',
        [documentId]
      );
      expect(result).toEqual(expectedResult);
    });

    it('should return null when aggregates not found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await feedbackDAO.getFeedbackAggregates('doc-123');

      expect(result).toBeNull();
    });

    it('should handle get feedback aggregates errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.getFeedbackAggregates('doc-123')).rejects.toThrow('Database error');
    });
  });

  describe('updateFeedbackAggregates', () => {
    it('should update feedback aggregates successfully', async () => {
      const documentId = 'doc-123';
      const mockStats = {
        total_feedback_count: '5',
        average_rating: '4.2'
      };

      const mockUpdatedAggregates = {
        document_id: documentId,
        total_feedback_count: 5,
        overall_score: 4.2
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockStats] }) // calculate aggregates
        .mockResolvedValueOnce({ rows: [mockUpdatedAggregates] }); // upsert aggregates

      const result = await feedbackDAO.updateFeedbackAggregates(documentId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feedback_aggregates'),
        [documentId, 5, 4.2]
      );
      expect(result).toEqual(mockUpdatedAggregates);
    });

    it('should handle null values in aggregates calculation', async () => {
      const documentId = 'doc-123';
      const mockStats = {
        total_feedback_count: '0',
        average_rating: null
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [mockStats] })
        .mockResolvedValueOnce({ rows: [{}] });

      await feedbackDAO.updateFeedbackAggregates(documentId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO feedback_aggregates'),
        [documentId, 0, null]
      );
    });

    it('should handle update feedback aggregates errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.updateFeedbackAggregates('doc-123')).rejects.toThrow('Database error');
    });
  });

  describe('getFeedbackStatistics', () => {
    it('should get feedback statistics for all documents', async () => {
      const mockStats = [
        { 
          total_feedback: '10', 
          average_rating: '4.5', 
          feedback_type: 'rating',
          rating_count: '8',
          comment_count: '2',
          quality_count: '0',
          relevance_count: '0',
          accuracy_count: '0',
          usefulness_count: '0'
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockStats });

      const result = await feedbackDAO.getFeedbackStatistics();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM feedback'),
        []
      );
      expect(result).toEqual({
        total_feedback: 10,
        average_rating: 4.5,
        feedback_by_type: { rating: 10 }
      });
    });

    it('should get feedback statistics for specific documents', async () => {
      const documentIds = ['doc-1', 'doc-2'];
      const mockStats = [
        { 
          total_feedback: '5', 
          average_rating: '4.2', 
          feedback_type: 'rating',
          rating_count: '5',
          comment_count: '0',
          quality_count: '0',
          relevance_count: '0',
          accuracy_count: '0',
          usefulness_count: '0'
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockStats });

      const result = await feedbackDAO.getFeedbackStatistics(documentIds);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE document_id = ANY($1)'),
        [documentIds]
      );
      expect(result).toEqual({
        total_feedback: 5,
        average_rating: 4.2,
        feedback_by_type: { rating: 5 }
      });
    });

    it('should handle get feedback statistics errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.getFeedbackStatistics()).rejects.toThrow('Database error');
    });
  });

  describe('getFeedbackTrends', () => {
    it('should get feedback trends with default options', async () => {
      const mockTrends = [
        { period: '2024-01-01', feedback_count: '5', average_rating: '4.2' },
        { period: '2024-01-02', feedback_count: '3', average_rating: '4.5' }
      ];

      mockDb.query.mockResolvedValue({ rows: mockTrends });

      const result = await feedbackDAO.getFeedbackTrends();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringMatching(/TO_CHAR\(combined_feedback\.created_at, 'YYYY-MM-DD'\)/),
        []
      );
      expect(result).toEqual(mockTrends);
    });

    it('should get feedback trends with filters', async () => {
      const options = {
        documentId: 'doc-123',
        feedbackType: 'quality',
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        groupBy: 'week'
      };

      mockDb.query.mockResolvedValue({ rows: [] });

      await feedbackDAO.getFeedbackTrends(options);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringMatching(/TO_CHAR\(combined_feedback\.created_at, 'YYYY-"W"WW'\)/),
        ['doc-123', 'quality', '2024-01-01', '2024-01-31']
      );
    });

    it('should handle get feedback trends errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));

      await expect(feedbackDAO.getFeedbackTrends()).rejects.toThrow('Database error');
    });
  });

  describe('bulkCreateFeedback', () => {
    it('should bulk create feedback successfully', async () => {
      const feedbackEntries = [
        {
          documentId: 'doc-1',
          appId: 'test-app',
          feedbackType: 'rating',
          content: { rating: 4, comment: 'Good' },
          userId: 'user-1',
          sessionId: 'session-1'
        },
        {
          documentId: 'doc-2',
          appId: 'test-app',
          feedbackType: 'relevance',
          content: { rating: 5, comment: 'Excellent' },
          userId: 'user-2',
          sessionId: 'session-2'
        }
      ];

      const mockResults = [
        { id: 'feedback-1', ...feedbackEntries[0] },
        { id: 'feedback-2', ...feedbackEntries[1] }
      ];

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [mockResults[0]] }) // first insert
        .mockResolvedValueOnce({ rows: [mockResults[1]] }) // second insert
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await feedbackDAO.bulkCreateFeedback(feedbackEntries);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(result).toEqual(mockResults);
    });

    it('should throw error for invalid feedback entries', async () => {
      await expect(feedbackDAO.bulkCreateFeedback([])).rejects.toThrow('Invalid feedback entries array');
      await expect(feedbackDAO.bulkCreateFeedback(null)).rejects.toThrow('Invalid feedback entries array');
    });

    it('should rollback on error', async () => {
      const feedbackEntries = [
        {
          documentId: 'doc-1',
          appId: 'test-app',
          feedbackType: 'rating',
          content: { rating: 4 },
          userId: 'user-1'
        }
      ];

      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('Insert error')); // first insert fails

      await expect(feedbackDAO.bulkCreateFeedback(feedbackEntries)).rejects.toThrow('Insert error');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
