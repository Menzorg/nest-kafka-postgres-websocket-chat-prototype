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

    try {
      // Обновляем статус пользователя
      this.userService.updateUserStatus(userId, true);
      
      // Получаем обновленный статус
      const status = await this.userService.getUserStatus(userId);
      if (status) {
        // Оповещаем всех о новом статусе
        this.server.emit('user:status', status);
      }
    } catch (error) {
      console.error('Error updating user status on connection:', error);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.user?.id;
    if (!userId) return;

    try {
      // Обновляем статус пользователя
      this.userService.updateUserStatus(userId, false);
      
      // Получаем обновленный статус
      const status = await this.userService.getUserStatus(userId);
      if (status) {
        // Оповещаем всех о новом статусе
        this.server.emit('user:status', status);
      }
    } catch (error) {
      console.error('Error updating user status on disconnection:', error);
    }
  }
}
