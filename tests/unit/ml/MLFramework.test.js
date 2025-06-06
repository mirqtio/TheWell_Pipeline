const MLFramework = require('../../../src/ml/MLFramework');
const path = require('path');
const fs = require('fs').promises;

// Mock TensorFlow.js
jest.mock('@tensorflow/tfjs-node', () => ({
  setBackend: jest.fn().mockResolvedValue(true),
  getBackend: jest.fn().mockReturnValue('tensorflow'),
  loadLayersModel: jest.fn().mockResolvedValue({
    predict: jest.fn().mockReturnValue({
      array: jest.fn().mockResolvedValue([[0.8, 0.2]])
    }),
    save: jest.fn().mockResolvedValue(true)
  })
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('MLFramework', () => {
  let mlFramework;
  const testModelsDir = path.join(__dirname, 'test-models');

  beforeEach(() => {
    jest.clearAllMocks();
    mlFramework = new MLFramework({
      modelsDir: testModelsDir,
      maxModelVersions: 3
    });
  });

  afterEach(async () => {
    // Clean up test models directory
    try {
      await fs.rm(testModelsDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should initialize the framework successfully', async () => {
      await mlFramework.initialize();
      
      expect(mlFramework.models).toBeDefined();
      expect(mlFramework.activeModels).toBeDefined();
      expect(mlFramework.trainingJobs).toBeDefined();
    });

    it('should create models directory if it does not exist', async () => {
      await mlFramework.initialize();
      
      const dirExists = await fs.access(testModelsDir)
        .then(() => true)
        .catch(() => false);
      
      expect(dirExists).toBe(true);
    });
  });

  describe('model registration', () => {
    it('should register a model type successfully', () => {
      class TestModel {}
      
      mlFramework.registerModelType('test', TestModel);
      
      expect(mlFramework.models.has('test')).toBe(true);
      expect(mlFramework.models.get('test')).toBe(TestModel);
    });

    it('should throw error for invalid model class', () => {
      expect(() => {
        mlFramework.registerModelType('invalid', null);
      }).toThrow('Invalid model class');
    });
  });

  describe('model creation', () => {
    beforeEach(() => {
      class MockModel {
        constructor(config) {
          this.config = config;
          this.id = config.id;
          this.metadata = {
            id: config.id,
            type: config.type
          };
        }
        async initialize() {
          this.initialized = true;
        }
      }
      
      mlFramework.registerModelType('mock', MockModel);
    });

    it('should create a new model instance', async () => {
      const model = await mlFramework.createModel('mock', {
        name: 'test-model'
      });
      
      expect(model).toBeDefined();
      expect(model.id).toBeDefined();
      expect(model.metadata.type).toBe('mock');
      expect(mlFramework.activeModels.has(model.id)).toBe(true);
    });

    it('should throw error for unknown model type', async () => {
      await expect(mlFramework.createModel('unknown')).rejects.toThrow('Unknown model type: unknown');
    });
  });

  describe('model loading', () => {
    it('should load a model from disk', async () => {
      const modelPath = path.join(testModelsDir, 'test-model');
      const model = await mlFramework.loadModel(modelPath, {
        name: 'test-model',
        type: 'classification'
      });
      
      expect(model).toBeDefined();
      expect(model.id).toBeDefined();
      expect(model.metadata.name).toBe('test-model');
      expect(mlFramework.activeModels.has(model.id)).toBe(true);
    });

    it('should handle model loading errors', async () => {
      const tf = require('@tensorflow/tfjs-node');
      tf.loadLayersModel.mockRejectedValueOnce(new Error('Load failed'));
      
      await expect(mlFramework.loadModel('/invalid/path')).rejects.toThrow('Load failed');
    });
  });

  describe('model saving', () => {
    beforeEach(async () => {
      await mlFramework.initialize();
      
      // Create a mock model
      const mockModel = {
        id: 'test-model-id',
        model: {
          save: jest.fn().mockResolvedValue(true)
        },
        metadata: {
          name: 'test-model'
        }
      };
      
      mlFramework.activeModels.set('test-model-id', mockModel);
    });

    it('should save a model with versioning', async () => {
      const savedPath = await mlFramework.saveModel('test-model-id', '1.0.0');
      
      expect(savedPath).toContain('test-model');
      expect(savedPath).toContain('1.0.0');
      
      // Check metadata file was created
      const metadataPath = path.join(savedPath, 'metadata.json');
      const metadataExists = await fs.access(metadataPath)
        .then(() => true)
        .catch(() => false);
      
      expect(metadataExists).toBe(true);
    });

    it('should throw error for non-existent model', async () => {
      await expect(mlFramework.saveModel('non-existent', '1.0.0')).rejects.toThrow('Model not found: non-existent');
    });
  });

  describe('model training', () => {
    let mockModel;

    beforeEach(async () => {
      await mlFramework.initialize();
      
      mockModel = {
        id: 'train-model-id',
        metadata: {},
        train: jest.fn().mockResolvedValue({
          history: {
            loss: [0.5, 0.3, 0.1],
            accuracy: [0.6, 0.8, 0.9]
          }
        })
      };
      
      mlFramework.activeModels.set('train-model-id', mockModel);
    });

    it('should train a model successfully', async () => {
      const trainingData = { x: [[1, 2]], y: [[0, 1]] };
      const validationData = { x: [[3, 4]], y: [[1, 0]] };
      
      const job = await mlFramework.trainModel(
        'train-model-id',
        trainingData,
        validationData,
        { epochs: 3 }
      );
      
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.status).toBe('completed');
      expect(job.history).toBeDefined();
      expect(mockModel.train).toHaveBeenCalledWith(
        trainingData,
        validationData,
        expect.objectContaining({ epochs: 3 })
      );
    });

    it('should handle training failures', async () => {
      mockModel.train.mockRejectedValueOnce(new Error('Training failed'));
      
      const trainingData = { x: [[1, 2]], y: [[0, 1]] };
      const validationData = { x: [[3, 4]], y: [[1, 0]] };
      
      await expect(
        mlFramework.trainModel('train-model-id', trainingData, validationData)
      ).rejects.toThrow('Training failed');
    });
  });

  describe('model evaluation', () => {
    let mockModel;

    beforeEach(async () => {
      await mlFramework.initialize();
      
      mockModel = {
        id: 'eval-model-id',
        evaluate: jest.fn().mockResolvedValue({
          accuracy: 0.92,
          loss: 0.15
        })
      };
      
      mlFramework.activeModels.set('eval-model-id', mockModel);
    });

    it('should evaluate a model', async () => {
      const testData = { x: [[5, 6]], y: [[1, 0]] };
      const results = await mlFramework.evaluateModel('eval-model-id', testData, ['accuracy', 'loss']);
      
      expect(results).toEqual({
        accuracy: 0.92,
        loss: 0.15
      });
      expect(mockModel.evaluate).toHaveBeenCalledWith(testData, ['accuracy', 'loss']);
    });
  });

  describe('predictions', () => {
    let mockModel;

    beforeEach(async () => {
      await mlFramework.initialize();
      
      mockModel = {
        id: 'predict-model-id',
        predict: jest.fn().mockResolvedValue({
          class: 'positive',
          confidence: 0.87
        })
      };
      
      mlFramework.activeModels.set('predict-model-id', mockModel);
    });

    it('should make predictions', async () => {
      const input = 'Test document';
      const prediction = await mlFramework.predict('predict-model-id', input);
      
      expect(prediction).toBeDefined();
      expect(prediction.prediction).toEqual({
        class: 'positive',
        confidence: 0.87
      });
      expect(prediction.modelId).toBe('predict-model-id');
      expect(prediction.latency).toBeDefined();
      expect(mockModel.predict).toHaveBeenCalledWith(input, {});
    });

    it('should throw error for non-deployed model', async () => {
      await expect(mlFramework.predict('non-existent', 'input')).rejects.toThrow('Model not found: non-existent');
    });
  });

  describe('model deployment', () => {
    let mockModel;

    beforeEach(async () => {
      await mlFramework.initialize();
      
      mockModel = {
        id: 'deploy-model-id',
        metadata: {
          status: 'trained'
        }
      };
      
      mlFramework.activeModels.set('deploy-model-id', mockModel);
    });

    it('should deploy a model', async () => {
      const deployed = await mlFramework.deployModel('deploy-model-id', '1.0.0');
      
      expect(deployed.metadata.status).toBe('deployed');
      expect(deployed.metadata.deployedAt).toBeDefined();
      expect(deployed.metadata.deployedVersion).toBe('1.0.0');
    });
  });

  describe('model archiving', () => {
    let mockModel;

    beforeEach(async () => {
      await mlFramework.initialize();
      
      mockModel = {
        id: 'archive-model-id',
        metadata: {
          status: 'deployed'
        }
      };
      
      mlFramework.activeModels.set('archive-model-id', mockModel);
    });

    it('should archive a model', async () => {
      await mlFramework.archiveModel('archive-model-id');
      
      expect(mockModel.metadata.status).toBe('archived');
      expect(mockModel.metadata.archivedAt).toBeDefined();
      expect(mlFramework.activeModels.has('archive-model-id')).toBe(false);
    });
  });

  describe('model info and listing', () => {
    beforeEach(async () => {
      await mlFramework.initialize();
      
      mlFramework.activeModels.set('model1', {
        metadata: {
          type: 'classification',
          status: 'deployed',
          version: '1.0.0'
        }
      });
      
      mlFramework.activeModels.set('model2', {
        metadata: {
          type: 'sentiment',
          status: 'trained',
          version: '2.0.0'
        }
      });
    });

    it('should get model info', () => {
      const info = mlFramework.getModelInfo('model1');
      
      expect(info).toEqual({
        id: 'model1',
        type: 'classification',
        status: 'deployed',
        version: '1.0.0',
        createdAt: undefined,
        deployedAt: undefined,
        metrics: undefined
      });
    });

    it('should list all active models', () => {
      const models = mlFramework.listActiveModels();
      
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('model1');
      expect(models[1].id).toBe('model2');
    });
  });

  describe('cleanup', () => {
    it('should dispose of resources', async () => {
      await mlFramework.initialize();
      
      const mockModel = {
        id: 'dispose-model-id',
        dispose: jest.fn()
      };
      
      mlFramework.activeModels.set('dispose-model-id', mockModel);
      
      mlFramework.dispose();
      
      expect(mockModel.dispose).toHaveBeenCalled();
      expect(mlFramework.activeModels.size).toBe(0);
      expect(mlFramework.trainingJobs.size).toBe(0);
    });
  });
});