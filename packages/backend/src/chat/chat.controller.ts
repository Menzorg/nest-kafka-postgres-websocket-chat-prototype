import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
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

  @Put('messages/:messageId')
  @ApiOperation({ summary: 'Edit a message' })
  @ApiResponse({ status: 200, description: 'Message edited successfully' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({ status: 409, description: 'Cannot edit message' })
  async editMessage(
    @Param('messageId') messageId: string,
    @Body() dto: { content: string },
    @Request() req: any,
  ): Promise<ChatMessage> {
    return this.chatService.editMessage(messageId, req.user.id, dto.content);
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Delete a message' })
  @ApiResponse({ status: 200, description: 'Message deleted successfully' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete message' })
  async deleteMessage(
    @Param('messageId') messageId: string,
    @Query('forEveryone') forEveryone: string,
    @Request() req: any,
  ): Promise<ChatMessage> {
    const deleteForEveryone = forEveryone === 'true';
    return this.chatService.deleteMessage(messageId, req.user.id, deleteForEveryone);
  }

  @Get('messages/:messageId/history')
  @ApiOperation({ summary: 'Get message edit history' })
  @ApiResponse({ status: 200, description: 'Returns message edit history' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async getMessageEditHistory(
    @Param('messageId') messageId: string,
    @Request() req: any,
  ): Promise<{ originalContent: string | null; currentContent: string; editedAt: Date | null }> {
    return this.chatService.getMessageEditHistory(messageId, req.user.id);
  }

  @Get('messages/search')
  @ApiOperation({ summary: 'Search messages' })
  @ApiQuery({ name: 'query', required: false, description: 'Search query text' })
  @ApiQuery({ name: 'senderId', required: false, description: 'Filter by sender ID' })
  @ApiQuery({ name: 'chatId', required: false, description: 'Filter by chat ID' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date for date range filter' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date for date range filter' })
  @ApiResponse({ status: 200, description: 'Returns search results' })
  async searchMessages(
    @Query('query') query?: string,
    @Query('senderId') senderId?: string,
    @Query('chatId') chatId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Request() req?: any,
  ): Promise<ChatMessage[]> {
    return this.chatService.searchMessages(req.user.id, {
      query,
      senderId,
      chatId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get(':chatId/messages/search')
  @ApiOperation({ summary: 'Search messages within a specific chat' })
  @ApiQuery({ name: 'q', required: true, description: 'Search query text' })
  @ApiResponse({ status: 200, description: 'Returns search results with highlights' })
  async searchChatMessages(
    @Param('chatId') chatId: string,
    @Query('q') searchQuery: string,
    @Request() req: any,
  ): Promise<{ messages: ChatMessage[]; highlights: { messageId: string; matches: string[] }[] }> {
    return this.chatService.searchMessagesByContent(req.user.id, chatId, searchQuery);
  }

  @Get(':chatId/messages/by-sender/:senderId')
  @ApiOperation({ summary: 'Get messages by sender in a chat' })
  @ApiResponse({ status: 200, description: 'Returns messages from specific sender' })
  async getMessagesBySender(
    @Param('chatId') chatId: string,
    @Param('senderId') senderId: string,
    @Request() req: any,
  ): Promise<ChatMessage[]> {
    return this.chatService.searchMessagesBySender(req.user.id, chatId, senderId);
  }

  @Get(':chatId/messages/by-date')
  @ApiOperation({ summary: 'Get messages by date range in a chat' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Start date' })
  @ApiQuery({ name: 'endDate', required: true, description: 'End date' })
  @ApiResponse({ status: 200, description: 'Returns messages within date range' })
  async getMessagesByDateRange(
    @Param('chatId') chatId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Request() req: any,
  ): Promise<ChatMessage[]> {
    return this.chatService.searchMessagesByDateRange(
      req.user.id,
      chatId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Post('messages/:messageId/pin')
  @ApiOperation({ summary: 'Pin a message' })
  @ApiResponse({ status: 200, description: 'Message pinned successfully' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({ status: 409, description: 'Message already pinned or limit reached' })
  async pinMessage(
    @Param('messageId') messageId: string,
    @Request() req: any,
  ): Promise<ChatMessage> {
    return this.chatService.pinMessage(messageId, req.user.id);
  }

  @Delete('messages/:messageId/pin')
  @ApiOperation({ summary: 'Unpin a message' })
  @ApiResponse({ status: 200, description: 'Message unpinned successfully' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  @ApiResponse({ status: 409, description: 'Message not pinned' })
  async unpinMessage(
    @Param('messageId') messageId: string,
    @Request() req: any,
  ): Promise<ChatMessage> {
    return this.chatService.unpinMessage(messageId, req.user.id);
  }

  @Get(':chatId/messages/pinned')
  @ApiOperation({ summary: 'Get pinned messages in a chat' })
  @ApiResponse({ status: 200, description: 'Returns pinned messages' })
  async getPinnedMessages(@Param('chatId') chatId: string): Promise<ChatMessage[]> {
    return this.chatService.getPinnedMessages(chatId);
  }

  @Post('messages/:messageId/forward')
  @ApiOperation({ summary: 'Forward a message' })
  @ApiResponse({ status: 200, description: 'Message forwarded successfully' })
  @ApiResponse({ status: 404, description: 'Message or chat not found' })
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
}
