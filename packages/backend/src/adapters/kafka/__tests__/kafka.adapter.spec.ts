import { KafkaAdapter } from '../kafka.adapter';
import { Kafka, Producer, Consumer, ConsumerRunConfig } from 'kafkajs';
import { Message, MessageDeliveryStatus } from '@webchat/common';
import { Logger } from '@nestjs/common';

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
    jest.setTimeout(10000);

    it('should disconnect producer and consumer', async () => {
      await adapter.onModuleDestroy();
      expect(mockProducer.disconnect).toHaveBeenCalled();
      expect(mockConsumer.disconnect).toHaveBeenCalled();
    });

    it('should pause consumer before disconnecting', async () => {
      // Сначала запускаем consumer
      await adapter.subscribe('test-topic', jest.fn());
      await adapter.onModuleDestroy();
      expect(mockConsumer.pause).toHaveBeenCalledWith([{ topic: '*' }]);
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

    it('should reject publishing when shutting down', async () => {
      jest.setTimeout(10000);
      await adapter.onModuleDestroy();
      await expect(adapter.publish('test-topic', mockMessage)).rejects.toThrow('Service is shutting down');
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

    it('should reject subscription when shutting down', async () => {
      jest.setTimeout(10000);
      await adapter.onModuleDestroy();
      await expect(adapter.subscribe('test-topic', jest.fn())).rejects.toThrow('Service is shutting down');
    });

    it('should handle multiple topic subscriptions', async () => {
      const mockHandler1 = jest.fn();
      const mockHandler2 = jest.fn();
      
      await adapter.subscribe('topic1', mockHandler1);
      await adapter.subscribe('topic2', mockHandler2);

      const message1 = { ...mockMessage, id: '1' };
      const message2 = { ...mockMessage, id: '2' };

      // Симулируем сообщения из разных топиков
      await (mockConsumer as any).eachMessageCallback({
        topic: 'topic1',
        partition: 0,
        message: { value: Buffer.from(JSON.stringify(message1)) },
      });

      await (mockConsumer as any).eachMessageCallback({
        topic: 'topic2',
        partition: 0,
        message: { value: Buffer.from(JSON.stringify(message2)) },
      });

      expect(mockHandler1).toHaveBeenCalledWith({
        ...message1,
        timestamp: mockMessage.timestamp.toISOString(),
      });
      expect(mockHandler2).toHaveBeenCalledWith({
        ...message2,
        timestamp: mockMessage.timestamp.toISOString(),
      });
    });
  });

  describe('consumer events', () => {
    it('should handle consumer crash and attempt to reconnect', async () => {
      const mockHandler = jest.fn();
      await adapter.subscribe('test-topic', mockHandler);

      // Симулируем краш consumer'а
      const crashCallback = (mockConsumer.on as jest.Mock).mock.calls.find(
        call => call[0] === 'consumer.crash'
      )[1];

      await crashCallback(new Error('Consumer crashed'));

      expect(mockConsumer.connect).toHaveBeenCalled();
      expect(mockConsumer.subscribe).toHaveBeenCalledWith({
        topic: 'test-topic',
        fromBeginning: true,
      });
    });

    it('should handle consumer disconnect', async () => {
      await adapter.subscribe('test-topic', jest.fn());

      // Симулируем отключение consumer'а
      const disconnectCallback = (mockConsumer.on as jest.Mock).mock.calls.find(
        call => call[0] === 'consumer.disconnect'
      )[1];

      disconnectCallback();

      // При следующей подписке consumer должен быть перезапущен
      const mockHandler = jest.fn();
      await adapter.subscribe('another-topic', mockHandler);

      expect(mockConsumer.run).toHaveBeenCalledTimes(2);
    });

    it('should log consumer events', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
      
      await adapter.subscribe('test-topic', jest.fn());

      // Получаем все колбэки событий
      const connectCallback = (mockConsumer.on as jest.Mock).mock.calls.find(
        call => call[0] === 'consumer.connect'
      )[1];
      const rebalancingCallback = (mockConsumer.on as jest.Mock).mock.calls.find(
        call => call[0] === 'consumer.rebalancing'
      )[1];
      const heartbeatCallback = (mockConsumer.on as jest.Mock).mock.calls.find(
        call => call[0] === 'consumer.heartbeat'
      )[1];

      // Вызываем события
      connectCallback();
      rebalancingCallback();
      heartbeatCallback();

      // Проверяем, что события были залогированы
      expect(loggerSpy).toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalled();
      
      loggerSpy.mockRestore();
      debugSpy.mockRestore();
    });
  });
});
