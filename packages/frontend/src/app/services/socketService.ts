import { io, Socket } from 'socket.io-client';

class SocketService {
  private socket: Socket | null = null;
  private token: string | null = null;
  private connectionTimeout: number = 15000; // 15 секунд на подключение
  private reconnectionAttempts: number = 3;
  private currentAttempt: number = 0;
  private readonly backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

  constructor() {
    this.setupSocketConnection = this.setupSocketConnection.bind(this);
    this.connect = this.connect.bind(this);
    this.disconnect = this.disconnect.bind(this);
  }

  private setupSocketConnection(): Socket {
    if (this.socket?.connected) {
      console.log('Socket already connected, returning existing socket');
      return this.socket;
    }

    if (this.socket) {
      console.log('Disconnecting existing socket');
      this.socket.disconnect();
      this.socket = null;
    }

    console.log('Creating new socket connection');
    this.socket = io(this.backendUrl, {
      auth: {
        token: this.token ? `Bearer ${this.token}` : null
      },
      transports: ['websocket'],
      timeout: this.connectionTimeout,
      reconnection: true,
      reconnectionAttempts: this.reconnectionAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: true // Автоматически подключаться при создании
    });

    // Обработка событий подключения
    this.socket.on('connect', () => {
      console.log('Socket connected successfully', {
        id: this.socket?.id,
        connected: this.socket?.connected
      });
      this.currentAttempt = 0;
    });

    this.socket.on('connection:established', (data) => {
      console.log('Connection established with server:', {
        ...data,
        socketId: this.socket?.id
      });
    });

    this.socket.on('connect_error', (error) => {
      // Если пользователь не найден - сессия истекла
      if (error.message === 'User not found') {
        console.log('Session expired, stopping reconnection attempts...', {
          error: error.message,
          socketId: this.socket?.id
        });
        
        // Отключаем автоматическое переподключение
        if (this.socket) {
          this.socket.io.opts.reconnection = false;
          this.socket.disconnect();
        }
        
        // Очищаем состояние
        this.socket = null;
        this.token = null;
        this.currentAttempt = 0;
        
        // Перенаправляем на страницу логина только если мы не уже на ней
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login?reason=session_expired';
        }
        return;
      }

      // Показываем ошибку только при первой попытке
      if (this.currentAttempt === 0) {
        console.error('Socket connection error:', {
          error,
          attempt: this.currentAttempt + 1,
          maxAttempts: this.reconnectionAttempts
        });
      } else {
        console.log('Reconnection attempt:', {
          attempt: this.currentAttempt + 1,
          maxAttempts: this.reconnectionAttempts,
          error: error.message
        });
      }
      
      this.currentAttempt++;
      
      if (this.currentAttempt >= this.reconnectionAttempts) {
        console.error('Max reconnection attempts reached');
        this.disconnect();
      } else {
        // Пробуем переподключиться
        setTimeout(() => {
          console.log('Attempting to reconnect...');
          this.socket?.connect();
        }, 1000 * Math.pow(2, this.currentAttempt)); // Экспоненциальная задержка
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', {
        reason,
        id: this.socket?.id
      });
      
      // Если отключение не было намеренным, пробуем переподключиться
      if (reason === 'io server disconnect' || reason === 'transport close') {
        console.log('Attempting to reconnect after disconnect...');
        this.socket?.connect();
      }
    });

    return this.socket;
  }

  public connect(token: string): Socket {
    console.log('Connecting with token:', {
      hasToken: !!token,
      currentSocketId: this.socket?.id,
      isConnected: this.socket?.connected
    });
    
    // Всегда создаем новое подключение при вызове connect
    this.token = token;
    return this.setupSocketConnection();
  }

  public disconnect(): void {
    console.log('Disconnecting socket');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.token = null;
    this.currentAttempt = 0;
  }

  public getSocket(): Socket | null {
    return this.socket;
  }

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }

  public reconnect(): void {
    if (this.token) {
      this.connect(this.token);
    }
  }
}

// Создаем единственный экземпляр сервиса
const socketService = new SocketService();
export default socketService;
