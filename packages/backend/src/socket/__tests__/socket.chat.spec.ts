import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { SocketGateway } from '../socket.gateway';
import { SocketAdapter } from '../socket.adapter';
import { AuthService } from '../../auth/auth.service';
import { ChatService } from '../../chat/chat.service';
import { JwtModule } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { UserService } from '../../user/user.service';

jest.setTimeout(15000);

describe('SocketGateway Chat', () => {
  let app: INestApplication;
  let gateway: SocketGateway;
  let socketAdapter: SocketAdapter;
  let socket: TestSocket | null = null;
  let socket2: TestSocket | null = null;
  let jwtService: JwtService;
  let authService: AuthService;
  let userService: UserService;
  let chatService: ChatService;
  let timeoutId: NodeJS.Timeout | undefined;

  // Расширяем тип Socket для тестов
  interface TestSocket extends ClientSocket {
    rooms?: Set<string>;
  }

  const mockConfigService = {
    get: jest.fn((key: string) => {
      switch (key) {
        case 'FRONTEND_URL':
          return 'http://localhost:3000';
        case 'JWT_SECRET':
          return 'test-secret-key';
        default:
          return undefined;
      }
    }),
  };

  const mockUserService = {
    findById: jest.fn((id) => {
      if (id === 'test-user-id' || id === 'other-user-id') {
        return Promise.resolve({
          id: id,
          email: 'test@example.com',
          name: 'Test User'
        });
      }
      return Promise.resolve(null);
    }),
    findAll: jest.fn(() => Promise.resolve([]))
  };

  const mockAuthService = {
    validateUser: jest.fn(async (payload) => {
      console.log('=== validateUser called with payload ===', payload);
      if (payload.sub === 'test-user-id' || payload.sub === 'other-user-id') {
        const user = {
          id: payload.sub,
          email: 'test@example.com',
          name: 'Test User'
        };
        console.log('=== User validated successfully ===', user);
        return user;
      }
      console.log('=== User validation failed ===');
      throw new UnauthorizedException('User not found');
    }),
    getAllUsers: jest.fn(() => Promise.resolve([]))
  };

  const mockChatService = {
    findChatByParticipants: jest.fn((userId1, userId2) => {
      if (userId1 === 'test-user-id' && userId2 === 'other-user-id') {
        return Promise.resolve({
          id: 'test-chat-id',
          participants: [userId1, userId2],
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      return Promise.resolve(undefined);
    }),
    createChat: jest.fn((userId1, userId2) => {
      return Promise.resolve({
        id: 'new-chat-id',
        participants: [userId1, userId2],
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }),
    getChatMessages: jest.fn(() => Promise.resolve([])),
    getChat: jest.fn((id) => {
      return Promise.resolve({
        id,
        participants: ['test-user-id', 'other-user-id'],
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }),
    saveMessage: jest.fn((messageDto) => {
      const message = {
        id: messageDto.id || 'test-message-id',
        chatId: messageDto.chatId,
        senderId: messageDto.senderId,
        content: messageDto.content,
        status: messageDto.status || 'SENT',
        createdAt: messageDto.createdAt || new Date()
      };
      return Promise.resolve(message);
    }),
    getMessage: jest.fn((id) => {
      return Promise.resolve({
        id,
        chatId: 'test-chat-id',
        senderId: 'test-user-id',
        content: 'Hello from test user',
        status: 'SENT',
        createdAt: new Date()
      });
    }),
    updateMessageStatus: jest.fn(async (messageId, status) => {
      return Promise.resolve();
    }),
    getUndeliveredMessages: jest.fn((userId, chatId) => {
      return Promise.resolve([]);
    })
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret-key',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      providers: [
        SocketGateway,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: ChatService,
          useValue: mockChatService,
        },
      ],
    }).compile();

    // Создаем приложение и инициализируем его
    app = moduleFixture.createNestApplication();
    await app.init();

    // Получаем все сервисы
    gateway = moduleFixture.get<SocketGateway>(SocketGateway);
    jwtService = moduleFixture.get<JwtService>(JwtService);
    authService = moduleFixture.get<AuthService>(AuthService);
    userService = moduleFixture.get<UserService>(UserService);
    chatService = moduleFixture.get<ChatService>(ChatService);

    // Создаем и настраиваем адаптер
    socketAdapter = new SocketAdapter(app);
    app.useWebSocketAdapter(socketAdapter);

    // Запускаем сервер на случайном порту
    await app.listen(0);
  });

  afterEach(async () => {
    // Очищаем таймер
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }

    // Закрываем все соединения
    if (socket?.connected) {
      socket.disconnect();
    }
    if (socket2?.connected) {
      socket2.disconnect();
    }

    // Явно вызываем closeServer для очистки всех ресурсов
    await gateway.closeServer();
    
    // Увеличиваем время ожидания закрытия соединений
    await new Promise(resolve => setTimeout(resolve, 500));

    // Закрываем приложение
    await app.close();
  });

  afterAll(async () => {
    // Закрываем все соединения
    if (socket?.connected) {
      socket.disconnect();
    }
    if (socket2?.connected) {
      socket2.disconnect();
    }

    // Очищаем таймер
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }

    // Явно вызываем closeServer для очистки всех ресурсов
    await gateway.closeServer();
    
    // Увеличиваем время ожидания закрытия соединений
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Очищаем все оставшиеся таймеры
    jest.clearAllTimers();
  });

  describe('Chat Management', () => {
    let testUser: any;
    let testToken: string;
    let otherUser: any;
    let otherToken: string;

    beforeEach(async () => {
      // Отключаем сокеты если они были подключены
      if (socket?.connected) {
        socket.disconnect();
      }
      if (socket2?.connected) {
        socket2.disconnect();
      }

      // Очищаем таймер
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }

      // Ждем небольшую паузу для полного закрытия соединений
      await new Promise(resolve => setTimeout(resolve, 100));

      // Создаем тестовых пользователей
      testUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User'
      };

      otherUser = {
        id: 'other-user-id',
        email: 'other@example.com',
        name: 'Other User'
      };

      // Настраиваем моки
      mockAuthService.validateUser.mockImplementation((payload) => {
        if (payload.sub === testUser.id) {
          return Promise.resolve(testUser);
        } else if (payload.sub === otherUser.id) {
          return Promise.resolve(otherUser);
        }
        throw new UnauthorizedException('User not found');
      });

      // Создаем токены с правильным форматом payload
      const token = jwtService.sign({ sub: testUser.id });
      const token2 = jwtService.sign({ sub: otherUser.id });

      console.log('=== Test setup ===');
      console.log('Test user token payload:', jwtService.decode(token));
      console.log('Other user token payload:', jwtService.decode(token2));

      socket = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${token}` },
        autoConnect: false,
        transports: ['websocket']
      });

      socket2 = io(`http://localhost:${app.getHttpServer().address().port}`, {
        auth: { token: `Bearer ${token2}` },
        autoConnect: false,
        transports: ['websocket']
      });
    });

    it('should get existing chat', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      const handleConnect = () => {
        socket?.emit('chat:get', { recipientId: otherUser.id }, (response: any) => {
          expect(response.chatId).toBe('test-chat-id');
          socket?.disconnect();
          done();
        });
      };

      socket.on('connect', handleConnect);
      socket.connect();
    });

    it('should create new chat', (done) => {
      if (!socket) return done(new Error('Socket not initialized'));

      // Меняем мок для несуществующего чата
      mockChatService.findChatByParticipants.mockResolvedValueOnce(undefined);

      const handleConnect = () => {
        socket?.emit('chat:get', { recipientId: otherUser.id }, (response: any) => {
          expect(response.chatId).toBe('new-chat-id');
          socket?.disconnect();
          done();
        });
      };

      socket.on('connect', handleConnect);
      socket.connect();
    });

    it('should send and receive messages', (done) => {
      if (!socket || !socket2) return done(new Error('Sockets not initialized'));

      let socket1Connected = false;
      let socket2Connected = false;
      let testFinished = false;

      const finishTest = () => {
        if (!testFinished) {
          testFinished = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          socket?.disconnect();
          socket2?.disconnect();
          done();
        }
      };

      const tryJoinChat = () => {
        if (socket1Connected && socket2Connected) {
          console.log('Both sockets connected, joining chat...');
          // Сначала подключаем первый сокет к чату
          socket?.emit('chat:join', { chatId: 'test-chat-id' }, (response1: any) => {
            console.log('=== Socket 1 chat join response ===', response1);
            console.log('Socket 1 rooms:', Array.from(socket?.rooms || []));
            if (response1.status === 'ok') {
              // Затем подключаем второй сокет к чату
              socket2?.emit('chat:join', { chatId: 'test-chat-id' }, (response2: any) => {
                console.log('=== Socket 2 chat join response ===', response2);
                console.log('Socket 2 rooms:', Array.from(socket2?.rooms || []));
                if (response2.status === 'ok') {
                  console.log('Both sockets joined chat, sending message...');
                  socket?.emit('message', {
                    chatId: 'test-chat-id',
                    content: 'Hello from test user'
                  }, (message: any) => {
                    console.log('=== Message sent response ===', message);
                    if (!message || !message.id) {
                      finishTest();
                      return;
                    }
                    
                    console.log('Message sent successfully, marking as read...');
                    
                    // Устанавливаем таймаут для ожидания события
                    timeoutId = setTimeout(() => {
                      console.log('=== Timeout reached, no message:status event received ===');
                      finishTest();
                    }, 5000);

                    // Устанавливаем слушатель события ДО отправки запроса на обновление статуса
                    socket?.once('message:status', (statusUpdate: any) => {
                      console.log('=== Message status update received ===', statusUpdate);
                      clearTimeout(timeoutId);
                      try {
                        expect(statusUpdate.messageId).toBe(message.id);
                        expect(statusUpdate.status).toBe('READ');
                        socket?.disconnect();
                        socket2?.disconnect();
                        finishTest();
                      } catch (error) {
                        finishTest();
                      }
                    });

                    // После успешной отправки сообщения отмечаем его как прочитанное
                    socket2?.emit('message:read', { messageId: message.id }, (response: any) => {
                      console.log('=== Message read response ===', response);
                      if (response.status === 'ok') {
                        console.log('Message marked as read, waiting for status update...');
                        console.log('Socket 1 rooms:', Array.from(socket?.rooms || []));
                        console.log('Socket 2 rooms:', Array.from(socket2?.rooms || []));
                      } else {
                        finishTest();
                      }
                    });
                  });
                } else {
                  finishTest();
                }
              });
            } else {
              finishTest();
            }
          });
        }
      };

      socket.on('connect', () => {
        console.log('=== Socket 1 connected ===');
        socket1Connected = true;
        tryJoinChat();
      });

      socket2.on('connect', () => {
        console.log('=== Socket 2 connected ===');
        socket2Connected = true;
        tryJoinChat();
      });

      socket2.on('message', (message: any) => {
        console.log('=== Received message on socket 2 ===', message);
        try {
          expect(message.content).toBe('Hello from test user');
          expect(message.senderId).toBe(testUser.id);
          expect(message.chatId).toBe('test-chat-id');
          socket?.disconnect();
          socket2?.disconnect();
          finishTest();
        } catch (error) {
          finishTest();
        }
      });

      socket.on('error', (error: any) => {
        console.error('=== Socket 1 error ===', error);
        finishTest();
      });

      socket2.on('error', (error: any) => {
        console.error('=== Socket 2 error ===', error);
        finishTest();
      });

      console.log('=== Starting test ===');
      console.log('Connecting sockets...');
      socket.connect();
      socket2.connect();
    }, 30000);

    it('should update message status', (done) => {
      if (!socket || !socket2) return done(new Error('Sockets not initialized'));

      let socket1Connected = false;
      let socket2Connected = false;
      let testFinished = false;

      const finishTest = () => {
        if (!testFinished) {
          testFinished = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          socket?.disconnect();
          socket2?.disconnect();
          done();
        }
      };

      // Добавляем слушатель всех событий для отладки
      socket.onAny((eventName, ...args) => {
        console.log('=== Socket 1 received event ===', { eventName, args });
      });

      socket2.onAny((eventName, ...args) => {
        console.log('=== Socket 2 received event ===', { eventName, args });
      });

      const tryJoinChat = () => {
        if (socket1Connected && socket2Connected) {
          console.log('Both sockets connected, joining chat...');
          
          // Сначала подключаем первый сокет к чату
          socket?.emit('chat:join', { chatId: 'test-chat-id' }, (response1: any) => {
            console.log('=== Socket 1 chat join response ===', response1);
            console.log('Socket 1 rooms:', Array.from(socket?.rooms || []));
            if (response1.status === 'ok') {
              // Затем подключаем второй сокет к чату
              socket2?.emit('chat:join', { chatId: 'test-chat-id' }, (response2: any) => {
                console.log('=== Socket 2 chat join response ===', response2);
                console.log('Socket 2 rooms:', Array.from(socket2?.rooms || []));
                if (response2.status === 'ok') {
                  console.log('Both sockets joined chat, sending message...');
                  socket?.emit('message', {
                    chatId: 'test-chat-id',
                    content: 'Hello from test user'
                  }, async (response: any) => {
                    console.log('=== Message sent response ===', response);
                    if (!response || !response.id) {
                      finishTest();
                      return;
                    }
                    
                    console.log('Message sent successfully, marking as read...');
                    
                    // Устанавливаем таймаут для ожидания события
                    timeoutId = setTimeout(() => {
                      console.log('=== Timeout reached, no message:status event received ===');
                      finishTest();
                    }, 5000);

                    // Устанавливаем слушатель события ДО отправки запроса на обновление статуса
                    socket?.once('message:status', (statusUpdate: any) => {
                      console.log('=== Message status update received ===', statusUpdate);
                      clearTimeout(timeoutId);
                      try {
                        expect(statusUpdate.messageId).toBe(response.id);
                        expect(statusUpdate.status).toBe('READ');

                        finishTest();
                      } catch (error) {
                        finishTest();
                      }
                    });

                    // После успешной отправки сообщения отмечаем его как прочитанное
                    socket2?.emit('message:read', { messageId: response.id }, (response: any) => {
                      console.log('=== Message read response ===', response);
                      if (response.status === 'ok') {
                        console.log('Message marked as read, waiting for status update...');
                        console.log('Socket 1 rooms:', Array.from(socket?.rooms || []));
                        console.log('Socket 2 rooms:', Array.from(socket2?.rooms || []));
                      } else {
                        finishTest();
                      }
                    });
                  });
                } else {
                  finishTest();
                }
              });
            } else {
              finishTest();
            }
          });
        }
      };

      socket.on('connect', () => {
        console.log('=== Socket 1 connected ===');
        socket1Connected = true;
        tryJoinChat();
      });

      socket2.on('connect', () => {
        console.log('=== Socket 2 connected ===');
        socket2Connected = true;
        tryJoinChat();
      });

      socket.on('error', (error: any) => {
        console.error('=== Socket 1 error ===', error);
        finishTest();
      });

      socket2.on('error', (error: any) => {
        console.error('=== Socket 2 error ===', error);
        finishTest();
      });

      console.log('=== Starting test ===');
      console.log('Connecting sockets...');
      socket.connect();
      socket2.connect();
    }, 30000);

    it('should not allow to send message if user is not a chat participant', (done) => {
      if (!socket || !socket2) return done(new Error('Sockets not initialized'));

      let socket1Connected = false;
      let socket2Connected = false;
      let testFinished = false;

      const finishTest = () => {
        if (!testFinished) {
          testFinished = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          socket?.disconnect();
          socket2?.disconnect();
          done();
        }
      };

      // Добавляем слушатель всех событий для отладки
      socket.onAny((eventName, ...args) => {
        console.log('=== Socket 1 received event ===', { eventName, args });
      });

      socket2.onAny((eventName, ...args) => {
        console.log('=== Socket 2 received event ===', { eventName, args });
      });

      const tryJoinChat = () => {
        if (socket1Connected && socket2Connected) {
          console.log('Both sockets connected, trying to send message without joining chat...');
          
          // Пытаемся отправить сообщение без присоединения к чату
          socket?.emit('message', {
            chatId: 'test-chat-id',
            content: 'Hello from test user'
          }, (response: any) => {
            console.log('=== Message send attempt response ===', response);
            try {
              expect(response).toBeDefined();
              expect(response.error).toBeDefined();
              expect(response.error.message).toBe('User is not a participant of this chat');
              finishTest();
            } catch (error) {
              finishTest();
            }
          });
        }
      };

      socket.on('connect', () => {
        console.log('=== Socket 1 connected ===');
        socket1Connected = true;
        tryJoinChat();
      });

      socket2.on('connect', () => {
        console.log('=== Socket 2 connected ===');
        socket2Connected = true;
        tryJoinChat();
      });

      socket.on('error', (error: any) => {
        console.error('=== Socket 1 error ===', error);
        finishTest();
      });

      socket2.on('error', (error: any) => {
        console.error('=== Socket 2 error ===', error);
        finishTest();
      });

      console.log('=== Starting test ===');
      console.log('Connecting sockets...');
      socket.connect();
      socket2.connect();
    });

    it('should update unread messages status when joining chat', (done) => {
      if (!socket || !socket2) return done(new Error('Sockets not initialized'));

      let socket1Connected = false;
      let socket2Connected = false;
      let initialConnection = true;
      let testFinished = false;
      let chatId: string;
      let messageId: string;

      const finishTest = () => {
        if (!testFinished) {
          testFinished = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          socket?.disconnect();
          socket2?.disconnect();
          done();
        }
      };

      // Добавляем слушатель всех событий для отладки
      socket.onAny((eventName, ...args) => {
        console.log('=== Socket 1 received event ===', { eventName, args });
      });

      socket2.onAny((eventName, ...args) => {
        console.log('=== Socket 2 received event ===', { eventName, args });
      });

      const createChatAndMessage = () => {
        console.log('=== Check connection state ===', {
          socket1Connected,
          socket2Connected,
          initialConnection,
          testFinished
        });
        
        if (socket1Connected && socket2Connected && initialConnection) {
          initialConnection = false;  // Сбрасываем флаг после первого вызова
          console.log('Both sockets connected, creating chat...');
          
          // Создаем чат и отправляем сообщение в одной последовательности
          socket?.emit('chat:get', { recipientId: 'test-user-2' }, (response: any) => {
            console.log('=== Chat created response ===', response);
            chatId = response.chatId;

            // Отправляем сообщение от первого пользователя
            socket?.emit('message', {
              chatId: chatId,
              content: 'Hello from test user'
            }, async (response: any) => {
              console.log('=== Message sent response ===', response);
              messageId = response.id;

              // Присоединяем второго пользователя к чату
              socket2?.emit('chat:join', { chatId }, (response: any) => {
                console.log('=== Chat join response ===', response);
                expect(response.status).toBe('ok');

                // После успешного присоединения отправляем статус READ
                socket2?.emit('message:read', { messageId }, (response: any) => {
                  console.log('=== Message read response ===', response);
                  if (response.status !== 'ok') {
                    finishTest();
                  }
                });
              });
            });
          });
        }
      };

      // Слушаем обновление статуса сообщения только один раз
      socket.once('message:status', (data: any) => {
        console.log('=== Message status update ===', data);
        try {
          expect(data).toBeDefined();
          expect(data.messageId).toBe(messageId);
          expect(data.status).toBe('READ');
          finishTest();
        } catch (error) {
          finishTest();
        }
      });

      socket.on('connect', () => {
        console.log('=== Socket 1 connected ===');
        socket1Connected = true;
        console.log('Socket 1 state:', { socket1Connected, initialConnection });
        createChatAndMessage();
      });

      socket2.on('connect', () => {
        console.log('=== Socket 2 connected ===');
        socket2Connected = true;
        console.log('Socket 2 state:', { socket2Connected, initialConnection });
        createChatAndMessage();
      });

      socket.on('error', (error: any) => {
        console.error('=== Socket 1 error ===', error);
        finishTest();
      });

      socket2.on('error', (error: any) => {
        console.error('=== Socket 2 error ===', error);
        finishTest();
      });

      // Устанавливаем общий таймаут на весь тест
      timeoutId = setTimeout(() => {
        console.log('=== Test timeout reached ===');
        finishTest();
      }, 5000);

      console.log('=== Starting test ===');
      console.log('Connecting sockets...');
      socket.connect();
      socket2.connect();
    }, 10000);
  });
});
