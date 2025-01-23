import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import { Chat, ChatMessage } from '@webchat/common';

@ApiTags('chats')
@Controller('chats')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new chat' })
  @ApiResponse({ status: 201, description: 'Chat created successfully' })
  @ApiResponse({ status: 409, description: 'Chat already exists' })
  async createChat(
    @Body() dto: { userId: string },
    @Request() req: any,
  ): Promise<Chat> {
    return this.chatService.createChat(req.user.id, dto.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all user chats' })
  @ApiResponse({ status: 200, description: 'Returns all user chats' })
  async getUserChats(@Request() req: any): Promise<Chat[]> {
    return this.chatService.getUserChats(req.user.id);
  }

  @Get(':chatId')
  @ApiOperation({ summary: 'Get chat by id' })
  @ApiResponse({ status: 200, description: 'Returns chat by id' })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  async getChat(@Param('chatId') chatId: string): Promise<Chat> {
    return this.chatService.getChat(chatId);
  }

  @Get(':chatId/messages')
  @ApiOperation({ summary: 'Get chat messages' })
  @ApiResponse({ status: 200, description: 'Returns chat messages' })
  async getChatMessages(@Param('chatId') chatId: string): Promise<ChatMessage[]> {
    return this.chatService.getChatMessages(chatId);
  }
}
