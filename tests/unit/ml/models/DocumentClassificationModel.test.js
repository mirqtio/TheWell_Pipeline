const DocumentClassificationModel = require('../../../../src/ml/models/DocumentClassificationModel');
const tf = require('@tensorflow/tfjs-node');

// Mock TensorFlow.js
jest.mock('@tensorflow/tfjs-node', () => {
  const actualTf = jest.requireActual('@tensorflow/tfjs-node');
  
  return {
    ...actualTf,
    input: jest.fn(() => 'input'),
    layers: {
      embedding: jest.fn(() => ({
        apply: jest.fn(() => 'embedding')
      })),
      conv1d: jest.fn(() => ({
        apply: jest.fn(() => 'conv1d')
      })),
      maxPooling1d: jest.fn(() => ({
        apply: jest.fn(() => 'maxPool')
      })),
      globalMaxPooling1d: jest.fn(() => ({
        apply: jest.fn(() => 'globalPool')
      })),
      dropout: jest.fn(() => ({
        apply: jest.fn(() => 'dropout')
      })),
      dense: jest.fn(() => ({
        apply: jest.fn(() => 'dense')
      })),
      concatenate: jest.fn(() => ({
        apply: jest.fn(() => 'concat')
      }))
    },
    model: jest.fn(() => ({
      compile: jest.fn(),
      fit: jest.fn().mockResolvedValue({
        history: { loss: [0.5, 0.3], accuracy: [0.7, 0.85] }
      }),
      predict: jest.fn(() => ({
        array: jest.fn().mockResolvedValue([[0.1, 0.7, 0.2]]),
        dispose: jest.fn()
      })),
      evaluate: jest.fn(() => ({
        dataSync: jest.fn().mockReturnValue([0.85])
      }))
    })),
    train: {
      adam: jest.fn()
    },
    tensor2d: jest.fn(() => ({
      dispose: jest.fn()
    })),
    tensor1d: jest.fn(() => ({
      dispose: jest.fn()
    })),
    oneHot: jest.fn(() => ({
      dispose: jest.fn()
    })),
    gather: jest.fn(() => ({
      dispose: jest.fn()
    })),
    util: {
      createShuffledIndices: jest.fn(() => [0, 1, 2, 3, 4])
    }
  };
});

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('DocumentClassificationModel', () => {
  let model;

  beforeEach(() => {
    jest.clearAllMocks();
    model = new DocumentClassificationModel({
      numClasses: 3,
      classes: ['tech', 'sports', 'politics'],
      maxLength: 100,
      vocabSize: 1000
    });
  });

  describe('initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(model.numClasses).toBe(3);
      expect(model.classes).toEqual(['tech', 'sports', 'politics']);
      expect(model.maxLength).toBe(100);
      expect(model.vocabSize).toBe(1000);
      expect(model.type).toBe('classification');
    });

    it('should use default values when not specified', () => {
      const defaultModel = new DocumentClassificationModel();
      
      expect(defaultModel.numClasses).toBe(10);
      expect(defaultModel.maxLength).toBe(1000);
      expect(defaultModel.vocabSize).toBe(10000);
    });
  });

  describe('model building', () => {
    it('should build the model architecture', async () => {
      await model.buildModel();
      
      expect(model.model).toBeDefined();
      expect(tf.model).toHaveBeenCalled();
      expect(tf.layers.embedding).toHaveBeenCalledWith({
        inputDim: 1000,
        outputDim: 128,
        inputLength: 100,
        maskZero: true
      });
      expect(tf.layers.conv1d).toHaveBeenCalled();
      expect(tf.layers.dense).toHaveBeenCalled();
    });
  });

  describe('preprocessing', () => {
    it('should preprocess single text input', async () => {
      const text = 'This is a test document about technology';
      const result = await model.preprocessInput(text);
      
      expect(tf.tensor2d).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should preprocess multiple text inputs', async () => {
      const texts = [
        'First document',
        'Second document with more words'
      ];
      
      const result = await model.preprocessInput(texts);
      
      expect(tf.tensor2d).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should handle long texts by truncating', async () => {
      const longText = 'word '.repeat(200); // 200 words, exceeds maxLength
      const result = await model.preprocessInput(longText);
      
      expect(tf.tensor2d).toHaveBeenCalled();
      // Check that the tensor was created with maxLength dimension
      const callArgs = tf.tensor2d.mock.calls[0][0];
      expect(callArgs[0].length).toBe(100); // maxLength
    });

    it('should pad short texts', async () => {
      const shortText = 'short';
      const result = await model.preprocessInput(shortText);
      
      const callArgs = tf.tensor2d.mock.calls[0][0];
      expect(callArgs[0].length).toBe(100); // maxLength
      // Check padding (most values should be 0)
      const nonZeroCount = callArgs[0].filter(v => v !== 0).length;
      expect(nonZeroCount).toBeLessThan(10);
    });
  });

  describe('postprocessing', () => {
    it('should postprocess model output with class names', async () => {
      const mockOutput = {
        array: jest.fn().mockResolvedValue([[0.1, 0.7, 0.2]]),
        dispose: jest.fn()
      };
      
      const result = await model.postprocessOutput(mockOutput);
      
      expect(result).toEqual({
        class: 'sports',
        classIndex: 1,
        confidence: 0.7,
        probabilities: {
          tech: 0.1,
          sports: 0.7,
          politics: 0.2
        }
      });
      expect(mockOutput.dispose).toHaveBeenCalled();
    });

    it('should handle batch predictions', async () => {
      const mockOutput = {
        array: jest.fn().mockResolvedValue([
          [0.8, 0.1, 0.1],
          [0.2, 0.3, 0.5]
        ]),
        dispose: jest.fn()
      };
      
      const results = await model.postprocessOutput(mockOutput);
      
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(2);
      expect(results[0].class).toBe('tech');
      expect(results[1].class).toBe('politics');
    });

    it('should handle missing class names', async () => {
      model.classes = [];
      
      const mockOutput = {
        array: jest.fn().mockResolvedValue([[0.1, 0.7, 0.2]]),
        dispose: jest.fn()
      };
      
      const result = await model.postprocessOutput(mockOutput);
      
      expect(result.class).toBe('class_1');
      expect(result.probabilities).toEqual([0.1, 0.7, 0.2]);
    });
  });

  describe('training', () => {
    beforeEach(async () => {
      await model.buildModel();
    });

    it('should train with text data', async () => {
      const texts = [
        'Tech article about AI',
        'Sports news about football',
        'Political debate coverage'
      ];
      const labels = [0, 1, 2]; // tech, sports, politics
      
      const history = await model.trainWithTexts(texts, labels, 0.2, {
        epochs: 5,
        batchSize: 16
      });
      
      expect(history).toBeDefined();
      expect(history.history).toBeDefined();
      expect(tf.oneHot).toHaveBeenCalled();
      expect(tf.gather).toHaveBeenCalled();
    });

    it('should handle validation split', async () => {
      const texts = Array(10).fill('Sample text');
      const labels = Array(10).fill(0);
      
      await model.trainWithTexts(texts, labels, 0.3);
      
      // Check that data was split
      expect(tf.util.createShuffledIndices).toHaveBeenCalledWith(10);
      expect(tf.gather).toHaveBeenCalled();
    });
  });

  describe('prediction', () => {
    beforeEach(async () => {
      await model.buildModel();
    });

    it('should make predictions on new text', async () => {
      const text = 'New technology breakthrough in AI';
      
      model.model.predict = jest.fn(() => ({
        array: jest.fn().mockResolvedValue([[0.8, 0.15, 0.05]]),
        dispose: jest.fn()
      }));
      
      const prediction = await model.predict(text);
      
      expect(prediction).toEqual({
        class: 'tech',
        classIndex: 0,
        confidence: 0.8,
        probabilities: {
          tech: 0.8,
          sports: 0.15,
          politics: 0.05
        }
      });
    });
  });

  describe('error handling', () => {
    it('should handle preprocessing errors gracefully', async () => {
      tf.tensor2d.mockImplementationOnce(() => {
        throw new Error('Tensor creation failed');
      });
      
      await expect(model.preprocessInput('test')).rejects.toThrow('Tensor creation failed');
    });

    it('should handle prediction errors', async () => {
      await model.buildModel();
      
      model.model.predict = jest.fn(() => {
        throw new Error('Prediction failed');
      });
      
      await expect(model.predict('test')).rejects.toThrow('Prediction failed');
    });
  });
});