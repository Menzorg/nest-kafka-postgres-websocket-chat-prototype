import { Test, TestingModule } from '@nestjs/testing';
import { KafkaAdapter, KafkaConfig } from '../kafka.adapter';
import { Kafka } from 'kafkajs';
import { Message, MessageDeliveryStatus } from '@webchat/common';

jest.mock('kafkajs');

describe('KafkaAdapter', () => {
  let adapter: KafkaAdapter;
  let mockProducer: any;
  let mockConsumer: any;

  const mockTimestamp = new Date('2025-01-23T04:41:30.749Z');
  const mockMessage: Message = {
    id: '1',
    roomId: 'room1',
    senderId: 'user1',
    content: 'Test message',
    timestamp: mockTimestamp,
    status: MessageDeliveryStatus.SENT,
  };

  // После JSON.stringify/parse дата становится строкой
  const mockSerializedMessage = {
    ...mockMessage,
    timestamp: mockTimestamp.toISOString(),
  };

  const mockConfig: KafkaConfig = {
    clientId: 'test-client',
    brokers: ['localhost:9092'],
    groupId: 'test-group',
  };

  beforeEach(async () => {
    mockProducer = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      send: jest.fn(),
    };

    mockConsumer = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      subscribe: jest.fn(),
      run: jest.fn(),
    };

    (Kafka as jest.Mock).mockImplementation(() => ({
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: KafkaAdapter,
          useValue: new KafkaAdapter(mockConfig),
        },
      ],
    }).compile();

    adapter = module.get<KafkaAdapter>(KafkaAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(adapter).toBeDefined();
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
    it('should send message to kafka', async () => {
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
  });

  describe('subscribe', () => {
    it('should subscribe to topic and handle messages', async () => {
      const mockHandler = jest.fn();
      await adapter.subscribe('test-topic', mockHandler);

      expect(mockConsumer.subscribe).toHaveBeenCalledWith({
        topic: 'test-topic',
      });

      const runCallback = mockConsumer.run.mock.calls[0][0];
      expect(runCallback).toBeDefined();

      // Имитируем получение сообщения
      await runCallback.eachMessage({
        message: { value: JSON.stringify(mockSerializedMessage) },
      });

      expect(mockHandler).toHaveBeenCalledWith(mockSerializedMessage);
    });
  });
});
