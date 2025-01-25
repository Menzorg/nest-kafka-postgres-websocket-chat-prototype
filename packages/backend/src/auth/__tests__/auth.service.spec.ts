import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth.service';
import { UserService } from '../../user/user.service';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { LoginDto, RegisterDto } from '@webchat/common';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let userService: UserService;
  let jwtService: JwtService;

  const mockUser = {
    id: '1',
    email: 'test@test.com',
    name: 'testuser',
    password: 'hashedPassword',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UserService,
          useValue: {
            create: jest.fn(),
            findByEmail: jest.fn(),
            findById: jest.fn(),
            findAll: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('test-token'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userService = module.get<UserService>(UserService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('register', () => {
    it('should register a new user', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'testuser',
      };

      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      (userService.create as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.register(registerDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(userService.create).toHaveBeenCalledWith({
        ...registerDto,
        password: 'hashedPassword',
      });
      expect(result).toEqual({
        accessToken: 'test-token',
        user: {
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
        },
      });
    });
  });

  describe('login', () => {
    it('should login an existing user', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'password',
      };

      (userService.findByEmail as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(userService.findByEmail).toHaveBeenCalledWith(loginDto.email);
      expect(bcrypt.compare).toHaveBeenCalledWith(loginDto.password, mockUser.password);
      expect(result).toEqual({
        accessToken: 'test-token',
        user: {
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
        },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'password',
      };

      (userService.findByEmail as jest.Mock).mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      const loginDto: LoginDto = {
        email: 'test@test.com',
        password: 'wrongpassword',
      };

      (userService.findByEmail as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateUser', () => {
    it('should return user if found', async () => {
      const payload = {
        sub: '1',
        email: 'test@test.com',
        name: 'testuser',
      };

      (userService.findById as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.validateUser(payload);

      expect(userService.findById).toHaveBeenCalledWith(payload.sub);
      expect(result).toEqual(mockUser);
    });

    it('should throw UnauthorizedException if payload has no sub', async () => {
      const payload = {
        email: 'test@test.com',
        name: 'testuser',
      };

      await expect(service.validateUser(payload)).rejects.toThrow(UnauthorizedException);
      expect(userService.findById).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const payload = {
        sub: '1',
        email: 'test@test.com',
        name: 'testuser',
      };

      (userService.findById as jest.Mock).mockResolvedValue(null);

      await expect(service.validateUser(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle database errors', async () => {
      const payload = {
        sub: '1',
        email: 'test@test.com',
        name: 'testuser',
      };

      const error = new Error('Database error');
      (userService.findById as jest.Mock).mockRejectedValue(error);

      await expect(service.validateUser(payload)).rejects.toThrow(error);
    });
  });

  describe('getAllUsers', () => {
    it('should return all users', async () => {
      const mockUsers = [
        { id: '1', email: 'user1@test.com', name: 'user1', password: 'hash1' },
        { id: '2', email: 'user2@test.com', name: 'user2', password: 'hash2' },
      ];

      (userService.findAll as jest.Mock).mockResolvedValue(mockUsers);

      const result = await service.getAllUsers();

      expect(userService.findAll).toHaveBeenCalled();
      expect(result).toEqual(mockUsers.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
      })));
    });

    it('should handle errors', async () => {
      const error = new Error('Database error');
      (userService.findAll as jest.Mock).mockRejectedValue(error);

      await expect(service.getAllUsers()).rejects.toThrow(error);
    });
  });
});
