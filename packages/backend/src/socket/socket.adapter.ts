import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { INestApplicationContext, Logger } from '@nestjs/common';

export class SocketAdapter extends IoAdapter {
  private readonly configService: ConfigService;
  private readonly logger = new Logger(SocketAdapter.name);

  constructor(app: INestApplicationContext) {
    super(app);
    this.configService = app.get(ConfigService);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const corsOrigin = this.configService.get('FRONTEND_URL', 'http://localhost:3000');
    this.logger.log(`Setting up Socket.IO server with CORS origin: ${corsOrigin}`);

    const serverOptions = {
      ...options,
      cors: {
        origin: corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      allowEIO3: true,
      transports: ['websocket'],
      pingTimeout: 30000,
      pingInterval: 10000,
      connectTimeout: 30000,
      maxHttpBufferSize: 1e6,
      allowUpgrades: true,
      perMessageDeflate: {
        threshold: 2048,
      },
      httpCompression: {
        threshold: 2048,
      },
    };

    this.logger.log('Socket.IO server options:', JSON.stringify(serverOptions, null, 2));
    const server = super.createIOServer(port, serverOptions);
    
    // Добавляем логирование для всех событий сервера
    server.on('connection_error', (err: any) => {
      this.logger.error('Socket.IO server connection error:', {
        message: err.message,
        type: err.type,
        description: err.description,
        context: err.context,
        stack: err.stack,
      });
    });

    server.on('new_namespace', (namespace: any) => {
      this.logger.log(`New namespace created: ${namespace.name}`);
    });

    server.on('connect', (socket: any) => {
      this.logger.log(`Socket connected to server: ${socket.id}`, {
        handshake: socket.handshake,
        rooms: Array.from(socket.rooms || []),
        headers: socket.request?.headers,
      });
    });

    server.on('disconnect', (socket: any) => {
      this.logger.log(`Socket disconnected from server: ${socket.id}`, {
        reason: socket.disconnected,
        rooms: Array.from(socket.rooms || []),
      });
    });

    return server;
  }
}
