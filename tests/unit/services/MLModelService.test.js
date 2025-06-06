const MLModelService = require('../../../src/services/MLModelService');
const DatabaseManager = require('../../../src/database/DatabaseManager');
const MLFramework = require('../../../src/ml/MLFramework');

// Mock dependencies
jest.mock('../../../src/database/DatabaseManager');
jest.mock('../../../src/ml/MLFramework');
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('MLModelService', () => {
  let mlService;
  let mockDbManager;
  let mockMLFramework;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock database manager
    mockDbManager = {
      initialize: jest.fn(),
      query: jest.fn(),
      beginTransaction: jest.fn().mockResolvedValue({
        commit: jest.fn(),
        rollback: jest.fn()
      }),
      close: jest.fn()
    };
    DatabaseManager.mockImplementation(() => mockDbManager);
    
    // Setup mock ML framework
    mockMLFramework = {
      initialize: jest.fn(),
      registerModelType: jest.fn(),
      createModel: jest.fn(),
      loadModel: jest.fn(),
      saveModel: jest.fn(),
      predict: jest.fn(),
      archiveModel: jest.fn(),
      dispose: jest.fn()
    };
    MLFramework.mockImplementation(() => mockMLFramework);
    
    mlService = new MLModelService({
      modelsDir: '/test/models'
    });
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      mockDbManager.query.mockResolvedValue([]);
      
      await mlService.initialize();
      
      expect(mockDbManager.initialize).toHaveBeenCalled();
      expect(mockMLFramework.initialize).toHaveBeenCalled();
      expect(mockMLFramework.registerModelType).toHaveBeenCalledTimes(6); // 6 model types
    });

    it('should load existing deployed models', async () => {
      const deployedModels = [
        {
          id: 1,
          name: 'sentiment-model',
          type: 'sentiment',
          version: '1.0.0',
          status: 'deployed',
          model_path: '/models/sentiment/1.0.0'
        }
      ];
      
      mockDbManager.query.mockResolvedValue(deployedModels);
      mockMLFramework.loadModel.mockResolvedValue({ id: 'model-1' });
      
      await mlService.initialize();
      
      expect(mockMLFramework.loadModel).toHaveBeenCalledWith(
        '/models/sentiment/1.0.0',
        deployedModels[0]
      );
      expect(mlService.modelRegistry.has(1)).toBe(true);
    });

    it('should handle model loading failures gracefully', async () => {
      const deployedModels = [
        {
          id: 1,
          name: 'failing-model',
          type: 'classification',
          model_path: '/models/failing'
        }
      ];
      
      mockDbManager.query.mockResolvedValue(deployedModels);
      mockMLFramework.loadModel.mockRejectedValue(new Error('Load failed'));
      
      await mlService.initialize();
      
      // Should not throw, just log error
      expect(mlService.modelRegistry.has(1)).toBe(false);
    });
  });

  describe('model creation', () => {
    beforeEach(async () => {
      await mlService.initialize();
    });

    it('should create a new model', async () => {
      const mockModel = {
        id: 'ml-model-1',
        metadata: {}
      };
      
      mockMLFramework.createModel.mockResolvedValue(mockModel);
      mockDbManager.query.mockResolvedValue([{ id: 1 }]);
      
      const result = await mlService.createModel('classification', {
        name: 'doc-classifier',
        hyperparameters: { learningRate: 0.001 }
      });
      
      expect(result).toEqual({
        id: 1,
        modelInstanceId: 'ml-model-1',
        type: 'classification',
        status: 'draft'
      });
      
      expect(mockMLFramework.createModel).toHaveBeenCalledWith('classification', expect.any(Object));
      expect(mockDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ml_models'),
        expect.any(Array)
      );
    });

    it('should rollback transaction on error', async () => {
      const transaction = {
        commit: jest.fn(),
        rollback: jest.fn()
      };
      
      mockDbManager.beginTransaction.mockResolvedValue(transaction);
      mockMLFramework.createModel.mockRejectedValue(new Error('Creation failed'));
      
      await expect(mlService.createModel('classification')).rejects.toThrow('Creation failed');
      
      expect(transaction.rollback).toHaveBeenCalled();
      expect(transaction.commit).not.toHaveBeenCalled();
    });
  });

  describe('training data preparation', () => {
    beforeEach(async () => {
      await mlService.initialize();
    });

    it('should prepare training dataset', async () => {
      const datasetConfig = {
        name: 'test-dataset',
        description: 'Test dataset',
        type: 'classification',
        sourceQuery: 'SELECT * FROM documents',
        filters: { status: 'approved' }
      };
      
      mockDbManager.query
        .mockResolvedValueOnce([{ id: 1 }]) // Insert dataset
        .mockResolvedValueOnce([
          { id: 1, content: 'Doc 1', label: 'tech' },
          { id: 2, content: 'Doc 2', label: 'sports' }
        ]) // Fetch data
        .mockResolvedValueOnce([]); // Update size
      
      const result = await mlService.prepareTrainingData(datasetConfig);
      
      expect(result).toEqual({
        datasetId: 1,
        data: [
          { id: 1, content: 'Doc 1', label: 'tech' },
          { id: 2, content: 'Doc 2', label: 'sports' }
        ],
        size: 2
      });
    });
  });

  describe('model training', () => {
    beforeEach(async () => {
      await mlService.initialize();
      
      // Add model to registry
      mlService.modelRegistry.set(1, {
        id: 'model-1',
        metadata: { type: 'classification' },
        train: jest.fn().mockResolvedValue({ loss: [0.5, 0.3] }),
        evaluate: jest.fn().mockResolvedValue({ accuracy: 0.85 })
      });
    });

    it('should start training job', async () => {
      mockDbManager.query.mockResolvedValue([{ id: 1 }]);
      
      const result = await mlService.trainModel(1, 1, {
        epochs: 10,
        batchSize: 32
      });
      
      expect(result).toMatchObject({
        status: 'started',
        modelId: 1,
        datasetId: 1
      });
      
      expect(mockDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ml_training_jobs'),
        expect.any(Array)
      );
    });

    it('should throw error if model not found', async () => {
      await expect(mlService.trainModel(999, 1)).rejects.toThrow('Model not found: 999');
    });

    it('should enforce concurrent training limit', async () => {
      mlService.config.maxConcurrentTraining = 1;
      mlService.activeTrainingJobs.set('job-1', { status: 'running' });
      
      await expect(mlService.trainModel(1, 1)).rejects.toThrow('Maximum concurrent training jobs reached');
    });
  });

  describe('model deployment', () => {
    beforeEach(async () => {
      await mlService.initialize();
    });

    it('should deploy a model', async () => {
      const modelInfo = {
        id: 1,
        name: 'sentiment-model',
        type: 'sentiment',
        model_path: '/models/sentiment/1.0.0',
        deploy_version: '1.0.0'
      };
      
      mockDbManager.query.mockResolvedValue([modelInfo]);
      mockMLFramework.loadModel.mockResolvedValue({ id: 'model-instance' });
      
      const result = await mlService.deployModel(1, '1.0.0');
      
      expect(result).toEqual({
        modelId: 1,
        name: 'sentiment-model',
        type: 'sentiment',
        version: '1.0.0',
        status: 'deployed'
      });
      
      expect(mockDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ml_models'),
        ['deployed', '1.0.0', 1]
      );
    });

    it('should load model if not in registry', async () => {
      const modelInfo = {
        id: 2,
        model_path: '/models/new-model'
      };
      
      mockDbManager.query.mockResolvedValue([modelInfo]);
      mockMLFramework.loadModel.mockResolvedValue({ id: 'new-model-instance' });
      
      await mlService.deployModel(2);
      
      expect(mockMLFramework.loadModel).toHaveBeenCalledWith(
        '/models/new-model',
        modelInfo
      );
      expect(mlService.modelRegistry.has(2)).toBe(true);
    });
  });

  describe('predictions', () => {
    beforeEach(async () => {
      await mlService.initialize();
      
      mlService.modelRegistry.set(1, { id: 'model-1' });
      mockMLFramework.predict.mockResolvedValue({
        prediction: { class: 'positive', confidence: 0.9 },
        latency: 50
      });
    });

    it('should make predictions', async () => {
      const input = 'Test document';
      const result = await mlService.predict(1, input);
      
      expect(result).toEqual({
        prediction: { class: 'positive', confidence: 0.9 },
        latency: 50
      });
      
      expect(mockMLFramework.predict).toHaveBeenCalledWith('model-1', input, {});
    });

    it('should log predictions', async () => {
      await mlService.predict(1, 'Test input');
      
      expect(mockDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ml_predictions'),
        expect.arrayContaining([1, expect.any(String)])
      );
    });

    it('should throw error for non-deployed model', async () => {
      await expect(mlService.predict(999, 'input')).rejects.toThrow('Model not deployed: 999');
    });
  });

  describe('model metrics', () => {
    beforeEach(async () => {
      await mlService.initialize();
    });

    it('should retrieve model metrics', async () => {
      const metrics = [
        { metric_type: 'evaluation', metric_name: 'accuracy', metric_value: 0.92 },
        { metric_type: 'evaluation', metric_name: 'loss', metric_value: 0.15 }
      ];
      
      mockDbManager.query.mockResolvedValue(metrics);
      
      const result = await mlService.getModelMetrics(1, 'evaluation');
      
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: 'evaluation',
        name: 'accuracy',
        value: 0.92
      });
    });
  });

  describe('model listing', () => {
    beforeEach(async () => {
      await mlService.initialize();
    });

    it('should list models with filters', async () => {
      const models = [
        {
          id: 1,
          name: 'classifier',
          type: 'classification',
          status: 'deployed',
          version_count: '3',
          training_count: '5'
        }
      ];
      
      mockDbManager.query.mockResolvedValue(models);
      
      const result = await mlService.listModels({ type: 'classification' });
      
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        name: 'classifier',
        type: 'classification',
        versionCount: 3,
        trainingCount: 5
      });
    });
  });

  describe('model archiving', () => {
    beforeEach(async () => {
      await mlService.initialize();
      
      mlService.modelRegistry.set(1, { id: 'model-1' });
      mockMLFramework.archiveModel.mockResolvedValue();
    });

    it('should archive a model', async () => {
      await mlService.archiveModel(1);
      
      expect(mockDbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ml_models SET status = $1'),
        ['archived', 1]
      );
      
      expect(mockMLFramework.archiveModel).toHaveBeenCalledWith('model-1');
      expect(mlService.modelRegistry.has(1)).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources on shutdown', async () => {
      await mlService.initialize();
      
      // Add active training job
      mlService.activeTrainingJobs.set('job-1', { status: 'running' });
      
      await mlService.cleanup();
      
      expect(mockMLFramework.dispose).toHaveBeenCalled();
      expect(mockDbManager.close).toHaveBeenCalled();
      expect(mlService.activeTrainingJobs.size).toBe(0);
    });
  });
});