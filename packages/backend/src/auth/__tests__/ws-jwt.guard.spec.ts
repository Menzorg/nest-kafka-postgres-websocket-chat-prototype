import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { WsJwtGuard } from '../ws-jwt.guard';
import { UserService } from '../../user/user.service';
import { Socket } from 'socket.io';

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let jwtService: JwtService;
  let userService: UserService;
  let mockExecutionContext: ExecutionContext;
  let mockSocket: Partial<Socket>;

  const mockUser = {
    id: '123',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashedPassword',
  };

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(),
    } as any;

    userService = {
      findById: jest.fn(),
    } as any;

    guard = new WsJwtGuard(jwtService, userService);

    mockSocket = {
      handshake: {
        auth: {},
        headers: {},
        time: Date.now().toString(),
        address: '127.0.0.1',
        xdomain: false,
        secure: true,
        issued: Date.now(),
        url: '/',
        query: {},
      },
      data: {},
    };

    mockExecutionContext = {
      switchToWs: jest.fn().mockReturnValue({
        getClient: jest.fn().mockReturnValue(mockSocket),
      }),
    } as any;
  });

  describe('canActivate', () => {
    it('should allow connection with valid token in auth', async () => {
      const token = 'valid.jwt.token';
      if (mockSocket.handshake) {
        mockSocket.handshake.auth.token = token;
      }
      
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: '123' });
      (userService.findById as jest.Mock).mockResolvedValue(mockUser);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockSocket.data.user).toEqual(mockUser);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(token);
      expect(userService.findById).toHaveBeenCalledWith('123');
    });

    it('should allow connection with valid token in authorization header', async () => {
      const token = 'valid.jwt.token';
      if (mockSocket.handshake) {
        mockSocket.handshake.headers.authorization = `Bearer ${token}`;
      }
      
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: '123' });
      (userService.findById as jest.Mock).mockResolvedValue(mockUser);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockSocket.data.user).toEqual(mockUser);
    });

    it('should throw WsException when token is missing', async () => {
      await expect(guard.canActivate(mockExecutionContext))
        .rejects
        .toThrow(WsException);
    });

    it('should throw WsException when token is invalid', async () => {
      if (mockSocket.handshake) {
        mockSocket.handshake.auth.token = 'invalid.token';
      }
      
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error());

      await expect(guard.canActivate(mockExecutionContext))
        .rejects
        .toThrow(WsException);
    });

    it('should throw WsException when user not found', async () => {
      if (mockSocket.handshake) {
        mockSocket.handshake.auth.token = 'valid.token';
      }
      
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: '123' });
      (userService.findById as jest.Mock).mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext))
        .rejects
        .toThrow(WsException);
    });
  });
});
