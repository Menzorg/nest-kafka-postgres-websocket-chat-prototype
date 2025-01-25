import { Test, TestingModule } from '@nestjs/testing';
import { UserGateway } from '../user.gateway';
import { UserService } from '../user.service';
import { Server, Socket } from 'socket.io';
import { UserStatus } from '../user.service';
import { JwtService } from '@nestjs/jwt';
import { WsJwtGuard } from '../../auth/ws-jwt.guard';
import { User } from '../entities/user.entity';

describe('UserGateway', () => {
  let gateway: UserGateway;
  let userService: UserService;

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashed_password',
    createdAt: new Date(),
    chats: [],
    sentMessages: [],
    hashPassword: jest.fn(),
    validatePassword: jest.fn(),
    get username() { return this.name; },
  } as unknown as User;

  const mockSocket = {
    data: {
      user: mockUser,
    },
    join: jest.fn(),
    disconnect: jest.fn(),
    handshake: {
      auth: {
        token: 'valid.jwt.token'
      }
    }
  } as unknown as Socket;

  const mockServer = {
    emit: jest.fn(),
  } as unknown as Server;

  const mockStatus: UserStatus = {
    userId: 'test-user-id',
    isOnline: true,
    lastSeen: new Date(),
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
    verifyAsync: jest.fn().mockResolvedValue({ sub: mockUser.id }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserGateway,
        WsJwtGuard,
        {
          provide: UserService,
          useValue: {
            updateUserStatus: jest.fn(),
            getUserStatus: jest.fn().mockResolvedValue(mockStatus),
            findById: jest.fn().mockResolvedValue(mockUser),
          },
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    gateway = module.get<UserGateway>(UserGateway);
    userService = module.get<UserService>(UserService);
    gateway.server = mockServer;
  });

  describe('handleConnection', () => {
    it('should handle user connection', async () => {
      await gateway.handleConnection(mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith(`user:${mockSocket.data.user.id}`);
      expect(userService.updateUserStatus).toHaveBeenCalledWith(mockSocket.data.user.id, true);
      expect(userService.getUserStatus).toHaveBeenCalledWith(mockSocket.data.user.id);
      expect(mockServer.emit).toHaveBeenCalledWith('user:status', mockStatus);
    });

    it('should disconnect socket if no user data', async () => {
      const socketWithoutUser = {
        ...mockSocket,
        data: {},
        handshake: {
          auth: {}
        }
      } as unknown as Socket;

      // Не должно быть вызовов до handleConnection
      expect(userService.updateUserStatus).not.toHaveBeenCalled();
      expect(userService.getUserStatus).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();

      await gateway.handleConnection(socketWithoutUser);

      expect(socketWithoutUser.disconnect).toHaveBeenCalled();
      expect(userService.updateUserStatus).not.toHaveBeenCalled();
      expect(userService.getUserStatus).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      jest.spyOn(userService, 'updateUserStatus').mockImplementationOnce(() => {
        throw error;
      });

      // Не должно быть вызовов до handleConnection
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.join).toHaveBeenCalled();
      expect(userService.updateUserStatus).toHaveBeenCalled();
      // Даже при ошибке сокет не должен отключаться
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      // При ошибке статус не должен эмититься
      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle user disconnection', async () => {
      const offlineStatus: UserStatus = { ...mockStatus, isOnline: false };
      jest.spyOn(userService, 'getUserStatus').mockResolvedValueOnce(offlineStatus);

      await gateway.handleDisconnect(mockSocket);

      expect(userService.updateUserStatus).toHaveBeenCalledWith(mockSocket.data.user.id, false);
      expect(userService.getUserStatus).toHaveBeenCalledWith(mockSocket.data.user.id);
      expect(mockServer.emit).toHaveBeenCalledWith('user:status', offlineStatus);
    });

    it('should do nothing if no user data', async () => {
      const socketWithoutUser = {
        ...mockSocket,
        data: {},
        handshake: {
          auth: {}
        }
      } as unknown as Socket;

      // Не должно быть вызовов до handleDisconnect
      expect(userService.updateUserStatus).not.toHaveBeenCalled();
      expect(userService.getUserStatus).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();

      await gateway.handleDisconnect(socketWithoutUser);

      expect(userService.updateUserStatus).not.toHaveBeenCalled();
      expect(userService.getUserStatus).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      jest.spyOn(userService, 'updateUserStatus').mockImplementationOnce(() => {
        throw error;
      });

      // Не должно быть вызовов до handleDisconnect
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();

      await gateway.handleDisconnect(mockSocket);

      expect(userService.updateUserStatus).toHaveBeenCalled();
      // Проверяем, что ошибка не помешала обработке отключения
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      // При ошибке статус не должен эмититься
      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });
});
