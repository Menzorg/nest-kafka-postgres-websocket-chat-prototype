import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
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

  @Get(':chatId/messages/pinned')
  @ApiOperation({ summary: 'Get pinned messages' })
  @ApiResponse({ status: 200, description: 'Returns pinned messages' })
  async getPinnedMessages(@Param('chatId') chatId: string): Promise<ChatMessage[]> {
    return this.chatService.getPinnedMessages(chatId);
  }

  @Post('messages/:messageId/pin')
  @ApiOperation({ summary: 'Pin a message' })
  @ApiResponse({ status: 200, description: 'Message pinned successfully' })
  @ApiResponse({ status: 409, description: 'Maximum pinned messages limit reached' })
  async pinMessage(
    @Param('messageId') messageId: string,
    @Request() req: any,
  ): Promise<ChatMessage> {
    return this.chatService.pinMessage(messageId, req.user.id);
  }

  @Delete('messages/:messageId/pin')
  @ApiOperation({ summary: 'Unpin a message' })
  @ApiResponse({ status: 200, description: 'Message unpinned successfully' })
  async unpinMessage(
    @Param('messageId') messageId: string,
    @Request() req: any,
  ): Promise<ChatMessage> {
    return this.chatService.unpinMessage(messageId, req.user.id);
  }

  @Post('messages/:messageId/forward')
  @ApiOperation({ summary: 'Forward a message' })
  @ApiResponse({ status: 200, description: 'Message forwarded successfully' })
  async forwardMessage(
    @Param('messageId') messageId: string,
    @Body() dto: { toChatId: string; additionalContent?: string },
    @Request() req: any,
  ): Promise<ChatMessage> {
    return this.chatService.forwardMessage(
      messageId,
      dto.toChatId,
      req.user.id,
      dto.additionalContent,
    );
  }

  @Post('messages/forward-multiple')
  @ApiOperation({ summary: 'Forward multiple messages' })
  @ApiResponse({ status: 200, description: 'Messages forwarded successfully' })
  async forwardMultipleMessages(
    @Body() dto: { messageIds: string[]; toChatId: string },
    @Request() req: any,
  ): Promise<ChatMessage[]> {
    return this.chatService.forwardMultipleMessages(
      dto.messageIds,
      dto.toChatId,
      req.user.id,
    );
  }

  @Put('messages/:messageId')
  @ApiOperation({ summary: 'Edit a message' })
  @ApiResponse({ status: 200, description: 'Message edited successfully' })
  @ApiResponse({ status: 409, description: 'Edit time limit exceeded' })
  async editMessage(
    @Param('messageId') messageId: string,
    @Body() dto: { content: string },
    @Request() req: any,
  ): Promise<ChatMessage> {
    return this.chatService.editMessage(messageId, req.user.id, dto.content);
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Delete a message for self' })
  @ApiResponse({ status: 200, description: 'Message deleted for self' })
  async deleteMessageForSelf(
    @Param('messageId') messageId: string,
    @Request() req: any,
  ): Promise<void> {
    return this.chatService.deleteMessageForSelf(messageId, req.user.id);
  }

  @Delete('messages/:messageId/everyone')
  @ApiOperation({ summary: 'Delete a message for everyone' })
  @ApiResponse({ status: 200, description: 'Message deleted for everyone' })
  @ApiResponse({ status: 409, description: 'Delete time limit exceeded' })
  async deleteMessageForEveryone(
    @Param('messageId') messageId: string,
    @Request() req: any,
  ): Promise<void> {
    return this.chatService.deleteMessageForEveryone(messageId, req.user.id);
  }

  @Get('messages/:messageId/history')
  @ApiOperation({ summary: 'Get message edit history' })
  @ApiResponse({ status: 200, description: 'Returns message edit history' })
  async getMessageEditHistory(@Param('messageId') messageId: string): Promise<any[]> {
    return this.chatService.getMessageEditHistory(messageId);
  }

  @Get('messages/search')
  @ApiOperation({ summary: 'Search messages' })
  @ApiResponse({ status: 200, description: 'Returns search results' })
  async searchMessages(
    @Query('query') query: string,
    @Query('chatId') chatId?: string,
    @Query('senderId') senderId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Request() req: any,
  ): Promise<ChatMessage[]> {
    const options: any = {};

    if (chatId) options.chatId = chatId;
    if (senderId) options.senderId = senderId;
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);
    if (limit) options.limit = parseInt(limit);

    return this.chatService.searchMessages(req.user.id, query, options);
  }
}
