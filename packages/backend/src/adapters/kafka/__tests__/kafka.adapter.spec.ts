import { KafkaAdapter } from '../kafka.adapter';
import { Kafka, Producer, Consumer, ConsumerRunConfig } from 'kafkajs';
import { Message, MessageDeliveryStatus } from '@webchat/common';

jest.mock('kafkajs');

describe('KafkaAdapter', () => {
  let adapter: KafkaAdapter;
  let mockProducer: jest.Mocked<Producer>;
  let mockConsumer: jest.Mocked<Consumer>;

  const mockTimestamp = new Date('2025-01-23T04:41:30.749Z');
  const mockMessage: Message = {
    id: '1',
    roomId: 'room1',
    senderId: 'user1',
    content: 'Test message',
    timestamp: mockTimestamp,
    status: MessageDeliveryStatus.SENT,
  };

  beforeEach(() => {
    mockProducer = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      send: jest.fn(),
      sendBatch: jest.fn(),
      isIdempotent: jest.fn(),
      events: {},
      on: jest.fn(),
      transaction: jest.fn(),
      logger: jest.fn() as any,
    } as unknown as jest.Mocked<Producer>;

    mockConsumer = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      subscribe: jest.fn(),
      run: jest.fn().mockImplementation((config: ConsumerRunConfig) => {
        if (config.eachMessage) {
          // Сохраняем callback для последующего вызова в тестах
          (mockConsumer as any).eachMessageCallback = config.eachMessage;
        }
        return Promise.resolve();
      }),
      stop: jest.fn(),
      seek: jest.fn(),
      describeGroup: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      commitOffsets: jest.fn(),
      resolveOffset: jest.fn(),
      on: jest.fn(),
      events: {},
      logger: jest.fn() as any,
    } as unknown as jest.Mocked<Consumer>;

    (Kafka as jest.Mock).mockImplementation(() => ({
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    }));

    adapter = new KafkaAdapter({
      brokers: ['localhost:9092'],
      clientId: 'test-client',
      groupId: 'test-group',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should connect producer and consumer', async () => {
      await adapter.onModuleInit();
      expect(mockProducer.connect).toHaveBeenCalled();
      expect(mockConsumer.connect).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect producer and consumer', async () => {
      await adapter.onModuleDestroy();
      expect(mockProducer.disconnect).toHaveBeenCalled();
      expect(mockConsumer.disconnect).toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('should publish message to kafka', async () => {
      await adapter.publish('test-topic', mockMessage);
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'test-topic',
        messages: [
          {
            key: mockMessage.id,
            value: JSON.stringify(mockMessage),
          },
        ],
      });
    });

    it('should handle publish error', async () => {
      const error = new Error('Publish failed');
      mockProducer.send.mockRejectedValue(error);
      await expect(adapter.publish('test-topic', mockMessage)).rejects.toThrow(error);
    });
  });

  describe('subscribe', () => {
    it('should subscribe to topic and handle messages', async () => {
      const mockHandler = jest.fn();
      await adapter.subscribe('test-topic', mockHandler);

      expect(mockConsumer.subscribe).toHaveBeenCalledWith({
        topic: 'test-topic',
        fromBeginning: true,
      });

      // Получаем сохраненный callback и вызываем его
      const mockEachMessage = {
        topic: 'test-topic',
        partition: 0,
        message: {
          value: Buffer.from(JSON.stringify(mockMessage)),
        },
      };

      await (mockConsumer as any).eachMessageCallback(mockEachMessage);
      expect(mockHandler).toHaveBeenCalledWith({
        ...mockMessage,
        timestamp: mockMessage.timestamp.toISOString(),
      });
    });

    it('should handle subscribe error', async () => {
      const error = new Error('Subscribe failed');
      mockConsumer.subscribe.mockRejectedValue(error);
      await expect(adapter.subscribe('test-topic', jest.fn())).rejects.toThrow(error);
    });

    it('should handle message parsing error', async () => {
      const mockHandler = jest.fn();
      await adapter.subscribe('test-topic', mockHandler);

      const mockEachMessage = {
        message: {
          value: Buffer.from('invalid json'),
        },
      };

      await (mockConsumer as any).eachMessageCallback(mockEachMessage);
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });
});
