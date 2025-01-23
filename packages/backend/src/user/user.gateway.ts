import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../auth/ws-jwt.guard';
import { UserService } from './user.service';

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class UserGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly userService: UserService) {}

  async handleConnection(client: Socket) {
    const userId = client.data?.user?.id;
    if (!userId) {
      client.disconnect();
      return;
    }

    // Присоединяем клиента к его персональной комнате
    client.join(`user:${userId}`);

    // Обновляем статус пользователя
    const status = await this.userService.updateUserStatus(userId, true);

    // Оповещаем всех о новом статусе
    this.server.emit('user:status', status);
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.user?.id;
    if (!userId) return;

    // Обновляем статус пользователя
    const status = await this.userService.updateUserStatus(userId, false);

    // Оповещаем всех о новом статусе
    this.server.emit('user:status', status);
  }
}
