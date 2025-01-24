import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth/auth.service';
import { ChatService } from '../chat/chat.service';
import { KafkaAdapter } from '../adapters/kafka/kafka.adapter';
import { SocketGateway } from '../socket/socket.gateway';

const mockConfigService = {
  get: jest.fn((key) => {
    switch(key) {
      case 'CORS_ORIGIN':
        return '*';
      case 'JWT_SECRET':
        return 'test-secret';
      default:
        return undefined;
    }
  })
};

const mockJwtService = {
  verify: jest.fn().mockReturnValue({ sub: 'test-user-id' }),
  verifyAsync: jest.fn().mockResolvedValue({ sub: 'test-user-id' }),
  sign: jest.fn().mockReturnValue('test.jwt.token')
};

const mockAuthService = {
  validateUser: jest.fn().mockResolvedValue({ id: 'test-user-id' }),
};

const mockChatService = {
  sendMessage: jest.fn(),
};

const mockKafkaAdapter = {
  emit: jest.fn(),
  subscribe: jest.fn(),
  onModuleInit: jest.fn().mockResolvedValue(undefined),
  onModuleDestroy: jest.fn().mockResolvedValue(undefined)
};

@Module({
  providers: [
    SocketGateway,
    {
      provide: ConfigService,
      useValue: mockConfigService
    },
    {
      provide: JwtService,
      useValue: mockJwtService
    },
    {
      provide: AuthService,
      useValue: mockAuthService
    },
    {
      provide: ChatService,
      useValue: mockChatService
    },
    {
      provide: KafkaAdapter,
      useValue: mockKafkaAdapter
    }
  ],
  exports: [
    SocketGateway,
    ConfigService,
    JwtService,
    AuthService,
    ChatService,
    KafkaAdapter
  ]
})
export class TestModule {}
