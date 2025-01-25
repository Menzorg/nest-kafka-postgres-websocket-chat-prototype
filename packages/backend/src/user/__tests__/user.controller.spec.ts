import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from '../user.controller';
import { UserService } from '../user.service';
import { User } from '../entities/user.entity';
import { UserStatus } from '../user.service';

describe('UserController', () => {
  let controller: UserController;
  let userService: UserService;

  const mockUsers = [
    {
      id: 'test-user-id-1',
      email: 'test1@example.com',
      name: 'Test User 1',
      password: 'hashed_password',
      isOnline: true,
      createdAt: new Date(),
      chats: [],
      sentMessages: [],
      status: {
        userId: 'test-user-id-1',
        isOnline: true,
        lastSeen: new Date(),
      } as UserStatus,
    },
    {
      id: 'test-user-id-2',
      email: 'test2@example.com',
      name: 'Test User 2',
      password: 'hashed_password',
      isOnline: false,
      createdAt: new Date(),
      chats: [],
      sentMessages: [],
      status: {
        userId: 'test-user-id-2',
        isOnline: false,
        lastSeen: new Date(),
      } as UserStatus,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            findAll: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    userService = module.get<UserService>(UserService);
  });

  describe('findAll', () => {
    it('should return an array of users with their status', async () => {
      jest.spyOn(userService, 'findAll').mockResolvedValue(mockUsers);

      const result = await controller.findAll();

      expect(result).toEqual(mockUsers);
      expect(userService.findAll).toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      jest.spyOn(userService, 'findAll').mockRejectedValue(error);

      await expect(controller.findAll()).rejects.toThrow(error);
    });
  });
});
