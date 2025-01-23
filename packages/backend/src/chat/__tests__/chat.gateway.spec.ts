import { Test, TestingModule } from '@nestjs/testing';
import { Socket, Server } from 'socket.io';
import { NotFoundException } from '@nestjs/common';
import { ChatGateway } from '../chat.gateway';
import { ChatService } from '../chat.service';
import { KafkaAdapter } from '../../adapters/kafka/kafka.adapter';
import { Chat, ChatMessage, Message, MessageStatus, MessageDeliveryStatus } from '@webchat/common';

// Создаем тестовую версию ChatGateway без декораторов
class TestChatGateway extends ChatGateway {
  constructor(chatService: ChatService, kafkaAdapter: KafkaAdapter) {
    super(chatService, kafkaAdapter);
  }
}

describe('ChatGateway', () => {
  let gateway: TestChatGateway;
  let chatService: ChatService;
  let kafkaAdapter: KafkaAdapter;

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    sockets: {
      adapter: {
        rooms: new Map(),
      },
    },
  } as unknown as Server;

  const mockClient = {
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    data: { user: { id: 'user1' } },
  } as unknown as Socket;

  const mockChat: Chat = {
    id: 'chat1',
    participants: ['user1', 'user2'],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMessage: ChatMessage = {
    id: 'msg1',
    chatId: 'chat1',
    senderId: 'user1',
    content: 'Test message',
    status: MessageDeliveryStatus.SENT,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: TestChatGateway,
          useFactory: (chatService: ChatService, kafkaAdapter: KafkaAdapter) => {
            return new TestChatGateway(chatService, kafkaAdapter);
          },
          inject: [ChatService, KafkaAdapter],
        },
        {
          provide: ChatService,
          useValue: {
            getUserChats: jest.fn().mockResolvedValue([mockChat]),
            getUndeliveredMessages: jest.fn().mockResolvedValue([mockMessage]),
            getChat: jest.fn().mockResolvedValue(mockChat),
            getMessage: jest.fn().mockResolvedValue(mockMessage),
            saveMessage: jest.fn().mockResolvedValue(mockMessage),
          },
        },
        {
          provide: KafkaAdapter,
          useValue: {
            publish: jest.fn(),
            subscribe: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<TestChatGateway>(TestChatGateway);
    chatService = module.get<ChatService>(ChatService);
    kafkaAdapter = module.get<KafkaAdapter>(KafkaAdapter);

    // @ts-ignore - we don't need all Server properties
    gateway.server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should handle new connection', async () => {
      await gateway.handleConnection(mockClient);

      expect(mockClient.join).toHaveBeenCalledWith('user:user1');
      expect(mockClient.join).toHaveBeenCalledWith('chat:chat1');
      expect(mockClient.emit).toHaveBeenCalledWith('message', mockMessage);
    });

    it('should disconnect client if no user id', async () => {
      const clientWithoutUser = {
        ...mockClient,
        data: {},
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(clientWithoutUser);

      expect(clientWithoutUser.disconnect).toHaveBeenCalled();
      expect(mockClient.join).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle client disconnect', () => {
      gateway.handleDisconnect(mockClient);

      expect(mockClient.leave).toHaveBeenCalledWith('user:user1');
    });
  });

  describe('handleMessage', () => {
    it('should handle new message', async () => {
      await gateway.handleMessage(mockClient, mockMessage);

      const expectedKafkaMessage: Message = {
        id: mockMessage.id,
        roomId: mockMessage.chatId,
        senderId: mockMessage.senderId,
        content: mockMessage.content,
        timestamp: mockMessage.createdAt,
        status: MessageDeliveryStatus.SENT,
      };

      expect(kafkaAdapter.publish).toHaveBeenCalledWith('chat.messages', expectedKafkaMessage);
      expect(mockClient.emit).toHaveBeenCalledWith('message:ack', { messageId: mockMessage.id });
    });

    it('should handle error when chat not found', async () => {
      const spy = jest.spyOn(chatService, 'getChat');
      spy.mockRejectedValueOnce(new NotFoundException('Chat not found'));

      await gateway.handleMessage(mockClient, mockMessage);

      expect(mockClient.emit).toHaveBeenCalledWith('message:error', {
        messageId: mockMessage.id,
        error: 'Chat not found',
      });
      expect(kafkaAdapter.publish).not.toHaveBeenCalled();
    });
  });
});
