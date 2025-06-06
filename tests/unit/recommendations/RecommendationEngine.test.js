/**
 * Unit tests for RecommendationEngine
 */

const RecommendationEngine = require('../../../src/recommendations/RecommendationEngine');
const { Document, UserInteraction } = require('../../../src/orm/models');

jest.mock('../../../src/orm/models');
jest.mock('../../../src/utils/logger');
// Mock pg module
jest.mock('pg', () => {
  const mockPool = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn()
  };
  
  return {
    Pool: jest.fn(() => mockPool)
  };
});

describe('RecommendationEngine', () => {
  let engine;
  let mockEmbeddingService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEmbeddingService = {
      generateEmbedding: jest.fn()
    };

    engine = new RecommendationEngine(mockEmbeddingService);
  });

  describe('getRecommendations', () => {
    it('should return recommendations for a user', async () => {
      const userId = 'user123';
      const mockRecommendations = [
        { id: 1, title: 'Doc 1', score: 0.9 },
        { id: 2, title: 'Doc 2', score: 0.8 }
      ];

      UserInteraction.count = jest.fn().mockResolvedValue(10);
      
      // Mock algorithm recommendation
      engine.algorithms.hybrid.recommend = jest.fn()
        .mockResolvedValue(mockRecommendations);

      const result = await engine.getRecommendations(userId, {
        limit: 10,
        algorithm: 'hybrid'
      });

      expect(result).toEqual(mockRecommendations);
      expect(engine.algorithms.hybrid.recommend).toHaveBeenCalledWith(
        userId,
        10,
        {},
        {}
      );
    });

    it('should handle cold start for new users', async () => {
      const userId = 'newuser123';
      const mockColdStartRecs = [
        { id: 3, title: 'Popular Doc', trending: true },
        { id: 4, title: 'Diverse Doc' }
      ];

      UserInteraction.count = jest.fn().mockResolvedValue(2); // Less than 5
      engine.getColdStartRecommendations = jest.fn()
        .mockResolvedValue(mockColdStartRecs);

      const result = await engine.getRecommendations(userId, {
        limit: 10
      });

      expect(result).toEqual(mockColdStartRecs);
      expect(engine.getColdStartRecommendations).toHaveBeenCalledWith(10, {});
    });

    it('should fallback to trending on error', async () => {
      const userId = 'user123';
      const mockTrending = [{ id: 5, title: 'Trending Doc' }];

      UserInteraction.count = jest.fn().mockResolvedValue(10);
      engine.algorithms.hybrid.recommend = jest.fn()
        .mockRejectedValue(new Error('Algorithm error'));
      engine.algorithms.trending.recommend = jest.fn()
        .mockResolvedValue(mockTrending);

      const result = await engine.getRecommendations(userId, {
        limit: 10
      });

      expect(result).toEqual(mockTrending);
      expect(engine.algorithms.trending.recommend).toHaveBeenCalled();
    });
  });

  describe('getSimilarDocuments', () => {
    it('should find similar documents', async () => {
      const documentId = '123';
      const mockDocument = {
        id: documentId,
        title: 'Source Doc',
        embedding: JSON.stringify([0.1, 0.2, 0.3])
      };
      const mockSimilar = [
        { id: '456', title: 'Similar Doc 1' },
        { id: '789', title: 'Similar Doc 2' }
      ];

      Document.findByPk = jest.fn().mockResolvedValue(mockDocument);
      engine.algorithms.contentBased.findSimilar = jest.fn()
        .mockResolvedValue(mockSimilar);

      const result = await engine.getSimilarDocuments(documentId, 5);

      expect(result).toEqual(mockSimilar);
      expect(Document.findByPk).toHaveBeenCalledWith(documentId);
      expect(engine.algorithms.contentBased.findSimilar).toHaveBeenCalledWith(
        mockDocument,
        5
      );
    });

    it('should return empty array if document not found', async () => {
      Document.findByPk = jest.fn().mockResolvedValue(null);

      const result = await engine.getSimilarDocuments('999', 5);

      expect(result).toEqual([]);
    });
  });

  describe('getColdStartRecommendations', () => {
    it('should combine popular and diverse content', async () => {
      const mockPopular = [
        { id: 1, title: 'Popular 1' },
        { id: 2, title: 'Popular 2' }
      ];
      const mockDiverse = [
        { id: 3, title: 'Diverse 1' },
        { id: 4, title: 'Diverse 2' }
      ];

      engine.algorithms.trending.recommend = jest.fn()
        .mockResolvedValue(mockPopular);
      engine.getDiverseContent = jest.fn()
        .mockResolvedValue(mockDiverse);

      const result = await engine.getColdStartRecommendations(4, {});

      expect(result).toHaveLength(4);
      expect(result).toEqual([...mockPopular, ...mockDiverse]);
    });
  });

  describe('postProcessRecommendations', () => {
    it('should filter seen items when excludeSeen is true', async () => {
      const recommendations = [
        { id: '1', title: 'Doc 1' },
        { id: '2', title: 'Doc 2' },
        { id: '3', title: 'Doc 3' }
      ];
      const userId = 'user123';

      UserInteraction.findAll = jest.fn().mockResolvedValue([
        { documentId: '2' }
      ]);

      const result = await engine.postProcessRecommendations(
        recommendations,
        userId,
        { excludeSeen: true }
      );

      expect(result).toHaveLength(2);
      expect(result.map(r => r.id)).toEqual(['1', '3']);
    });

    it('should add explanations when includeExplanation is true', async () => {
      const recommendations = [
        { id: '1', title: 'Doc 1', score: 0.9 }
      ];
      const userId = 'user123';

      const result = await engine.postProcessRecommendations(
        recommendations,
        userId,
        { includeExplanation: true }
      );

      expect(result[0]).toHaveProperty('explanation');
      expect(typeof result[0].explanation).toBe('string');
    });

    it('should deduplicate recommendations', async () => {
      const recommendations = [
        { id: '1', title: 'Doc 1' },
        { id: '2', title: 'Doc 2' },
        { id: '1', title: 'Doc 1' } // Duplicate
      ];
      const userId = 'user123';

      const result = await engine.postProcessRecommendations(
        recommendations,
        userId,
        {}
      );

      expect(result).toHaveLength(2);
      expect(result.map(r => r.id)).toEqual(['1', '2']);
    });
  });

  describe('ContentBasedFiltering', () => {
    let contentFilter;

    beforeEach(() => {
      contentFilter = engine.algorithms.contentBased;
    });

    it('should calculate cosine similarity correctly', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      const vec3 = [1, 0, 0];

      expect(contentFilter.cosineSimilarity(vec1, vec2)).toBeCloseTo(0);
      expect(contentFilter.cosineSimilarity(vec1, vec3)).toBeCloseTo(1);
    });

    it('should build user profile from interactions', async () => {
      const interactions = [
        {
          Document: {
            category: 'tech',
            tags: ['ai', 'ml'],
            embedding: JSON.stringify([0.1, 0.2])
          }
        },
        {
          Document: {
            category: 'tech',
            tags: ['ai', 'deep-learning'],
            embedding: JSON.stringify([0.2, 0.3])
          }
        },
        {
          Document: {
            category: 'science',
            tags: ['physics'],
            embedding: JSON.stringify([0.3, 0.4])
          }
        }
      ];

      const profile = await contentFilter.buildUserProfile(interactions);

      expect(profile.categories).toHaveProperty('tech', 2);
      expect(profile.categories).toHaveProperty('science', 1);
      expect(profile.keywords).toHaveProperty('ai', 2);
      expect(profile.keywords).toHaveProperty('ml', 1);
      expect(profile.embedding).toBeDefined();
    });
  });

  describe('HybridRecommender', () => {
    let hybrid;

    beforeEach(() => {
      hybrid = engine.algorithms.hybrid;
    });

    it('should combine recommendations from multiple algorithms', () => {
      const collabRecs = [
        { id: '1', title: 'Collab 1' },
        { id: '2', title: 'Collab 2' }
      ];
      const contentRecs = [
        { id: '2', title: 'Content 2' },
        { id: '3', title: 'Content 3' }
      ];
      const trendingRecs = [
        { id: '4', title: 'Trending 1' }
      ];

      const combined = hybrid.combineRecommendations(
        collabRecs,
        contentRecs,
        trendingRecs
      );

      expect(combined).toHaveLength(4);
      expect(combined.find(r => r.id === '2').hybridScore).toBeGreaterThan(
        combined.find(r => r.id === '1').hybridScore
      ); // Should have higher score as it appears in multiple lists
    });
  });

  describe('TrendingRecommender', () => {
    it('should get trending items for time window', async () => {
      const mockTrending = [
        { id: 1, title: 'Trending 1', dataValues: { interactionCount: 100, avgRating: 4.5 } },
        { id: 2, title: 'Trending 2', dataValues: { interactionCount: 80, avgRating: 4.2 } }
      ];

      Document.findAll = jest.fn().mockResolvedValue(
        mockTrending.map(item => ({
          ...item,
          toJSON: () => item
        }))
      );

      const result = await engine.algorithms.trending.recommend(
        null,
        10,
        { timeWindow: 'week' },
        {}
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('trending', true);
      expect(result[0]).toHaveProperty('trendingScore', 100);
      expect(result[0]).toHaveProperty('trendingWindow', 'week');
    });
  });
});