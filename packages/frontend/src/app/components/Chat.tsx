'use client';

import { useEffect, useState, useRef } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../hooks/useAuth';
import { ChatMessage, MessageDeliveryStatus } from '@webchat/common';

interface ChatProps {
  recipientId: string;
  recipientName: string;
  onClose: () => void;
}

export default function Chat({ recipientId, recipientName, onClose }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [showMessageMenu, setShowMessageMenu] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { socket, isConnected } = useSocket(useAuth().token);
  const { user } = useAuth();

  useEffect(() => {
    if (!socket || !user || !isConnected) {
      console.log('=== Chat initialization skipped ===', {
        hasSocket: !!socket,
        hasUser: !!user,
        isConnected,
        socketId: socket?.id
      });
      return;
    }

    let mounted = true;
    console.log('=== Initializing chat ===', {
      userId: user.id,
      recipientId,
      socketConnected: socket.connected,
      socketId: socket.id
    });

    // Подписываемся на новые сообщения
    const handleMessage = (message: ChatMessage) => {
      console.log('=== New message received ===', {
        messageId: message.id,
        senderId: message.senderId,
        status: message.status,
        socketId: socket.id
      });
      
      setMessages(prev => [...prev, message]);
      
      // Если сообщение от другого пользователя, помечаем его как доставленное
      if (message.senderId !== user.id) {
        console.log('=== Marking message as delivered ===', {
          messageId: message.id,
          socketId: socket.id
        });
        socket.emit('message:status', { 
          messageId: message.id, 
          status: MessageDeliveryStatus.DELIVERED 
        });
      }
    };

    const handleStatus = (status: { messageId: string, status: MessageDeliveryStatus }) => {
      console.log('=== Message status update received ===', {
        ...status,
        socketId: socket.id
      });
      
      setMessages(prev => {
        const updatedMessages = prev.map(msg => 
          msg.id === status.messageId 
            ? { ...msg, status: status.status }
            : msg
        );
        
        console.log('=== Messages after status update ===', {
          messageId: status.messageId,
          newStatus: status.status,
          updatedCount: updatedMessages.filter(m => m.id === status.messageId).length
        });
        
        return updatedMessages;
      });
    };

    // Устанавливаем обработчики событий
    console.log('=== Setting up socket event handlers ===', {
      socketId: socket.id
    });

    socket.on('message', handleMessage);
    socket.on('message:status', handleStatus);
    socket.on('message:pinned', (message: ChatMessage) => {
      console.log('=== Message pinned ===', message);
      setMessages(prev => prev.map(msg =>
        msg.id === message.id ? { ...msg, isPinned: true, pinnedAt: message.pinnedAt, pinnedBy: message.pinnedBy } : msg
      ));
      setPinnedMessages(prev => [...prev, message]);
    });
    socket.on('message:unpinned', (message: ChatMessage) => {
      console.log('=== Message unpinned ===', message);
      setMessages(prev => prev.map(msg =>
        msg.id === message.id ? { ...msg, isPinned: false, pinnedAt: null, pinnedBy: null } : msg
      ));
      setPinnedMessages(prev => prev.filter(msg => msg.id !== message.id));
    });

    // Инициализируем чат
    const initChat = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Запрашиваем или создаем чат
        const chatResponse = await new Promise<{ chatId: string, messages: ChatMessage[] }>((resolve, reject) => {
          socket.emit('chat:get', { recipientId }, (response: { chatId: string, messages: ChatMessage[] }) => {
            if (!response) {
              reject(new Error('Failed to load chat'));
              return;
            }
            resolve(response);
          });
        });

        if (!mounted) return;

        console.log('=== Initial messages ===', {
          chatId: chatResponse.chatId,
          messageCount: chatResponse.messages.length,
          socketId: socket.id
        });
        
        setChatId(chatResponse.chatId);
        setMessages(chatResponse.messages);

        // Get pinned messages
        socket.emit('chat:get-pinned', { chatId: chatResponse.chatId }, (response: { status: string, messages?: ChatMessage[] }) => {
          if (response.status === 'ok' && response.messages) {
            setPinnedMessages(response.messages);
          }
        });

        // Присоединяемся к чату
        console.log('=== Joining chat room ===', {
          chatId: chatResponse.chatId,
          socketId: socket.id
        });

        const joinResponse = await new Promise<{ status: string, message?: string }>((resolve, reject) => {
          socket.emit('chat:join', { chatId: chatResponse.chatId }, (response: { status: string, message?: string }) => {
            if (response.status === 'error') {
              reject(new Error(response.message || 'Failed to join chat'));
              return;
            }
            resolve(response);
          });
        });

        console.log('=== Successfully joined chat room ===', {
          chatId: chatResponse.chatId,
          socketId: socket.id,
          response: joinResponse
        });

        setIsLoading(false);
      } catch (error: Error | unknown) {
        console.error('=== Failed to initialize chat ===', {
          error: error instanceof Error ? error.message : String(error),
          socketId: socket.id
        });
        if (mounted) {
          setError(error instanceof Error ? error.message : String(error));
          setIsLoading(false);
        }
      }
    };

    initChat();

    // Очищаем обработчики при размонтировании
    return () => {
      mounted = false;
      console.log('=== Component unmounting ===', {
        socketId: socket?.id,
        isConnected: socket?.connected,
        chatId,
        userId: user?.id
      });

      console.log('=== Cleaning up socket event handlers ===', {
        socketId: socket?.id
      });
      socket?.off('message', handleMessage);
      socket?.off('message:status', handleStatus);
      socket?.off('message:pinned');
      socket?.off('message:unpinned');

      // Покидаем чат при размонтировании
      if (chatId && socket?.connected) {
        console.log('=== Sending chat:leave event ===', {
          chatId,
          socketId: socket.id
        });
        socket.emit('chat:leave', { chatId }, (response: { success: boolean, message?: string }) => {
          console.log('=== chat:leave response ===', {
            response,
            chatId,
            socketId: socket.id
          });
        });
      } else {
        console.log('=== Skipping chat:leave event ===', {
          hasChatId: !!chatId,
          isSocketConnected: socket?.connected,
          socketId: socket?.id
        });
      }
    };
  }, [socket, user, recipientId, isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !chatId || !newMessage.trim() || !user) return;

    socket.emit('message', {
      chatId,
      content: newMessage.trim(),
    });
    
    setNewMessage('');
  };

  const handleMessageClick = (message: ChatMessage) => {
    // Отправляем подтверждение о прочтении только для входящих сообщений
    if (message.senderId !== user?.id && socket && message.status !== MessageDeliveryStatus.READ) {
      console.log('=== Marking message as read on click ===', {
        messageId: message.id,
        socketId: socket.id
      });
      socket.emit('message:read', { messageId: message.id });

      // Обновляем статус сообщения локально
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === message.id
            ? { ...msg, status: MessageDeliveryStatus.READ }
            : msg
        )
      );
    }
  };

  const handlePinMessage = (message: ChatMessage) => {
    if (!socket) return;

    if (message.isPinned) {
      socket.emit('message:unpin', { messageId: message.id }, (response: { status: string }) => {
        if (response.status === 'ok') {
          console.log('Message unpinned');
        }
      });
    } else {
      socket.emit('message:pin', { messageId: message.id }, (response: { status: string }) => {
        if (response.status === 'ok') {
          console.log('Message pinned');
        }
      });
    }
    setShowMessageMenu(null);
  };

  const handleForwardMessage = (message: ChatMessage) => {
    // For now, we'll just log this - in a real implementation,
    // you'd show a dialog to select the target chat
    console.log('Forward message:', message);
    alert('Message forwarding UI coming soon! Select a chat to forward to.');
    setShowMessageMenu(null);
  };

  const handleClose = () => {
    // Сначала закрываем чат
    onClose();
    
    // Потом отправляем событие на сервер
    if (chatId && socket?.connected) {
      console.log('=== Sending chat:leave event ===', {
        chatId,
        socketId: socket.id
      });
      socket.emit('chat:leave', { chatId }, (response: { success: boolean, message?: string }) => {
        console.log('=== chat:leave response ===', {
          response,
          chatId,
          socketId: socket.id
        });
        if (!response.success) {
          console.error('Failed to leave chat:', {
            chatId,
            socketId: socket.id
          });
        }
      });
    } else {
      console.log('=== Skipping chat:leave event ===', {
        hasChatId: !!chatId,
        isSocketConnected: socket?.connected,
        socketId: socket?.id
      });
    }
  };

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
          <h3 className="text-lg font-semibold text-red-600 mb-4">Error</h3>
          <p className="text-gray-700 mb-4">{error}</p>
          <button
            onClick={onClose}
            className="w-full bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !isConnected) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-6">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse"></div>
            <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse delay-75"></div>
            <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse delay-150"></div>
          </div>
          <p className="mt-2 text-gray-600">
            {isLoading ? 'Loading chat...' : 'Connecting to server...'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {!isConnected && 'Server connection lost. Attempting to reconnect...'}
          </p>
          {!isConnected && (
            <button
              onClick={onClose}
              className="mt-4 w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Return to User Selection
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col h-[600px]">
        {/* Header */}
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Chat with {recipientName}</h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <span className="sr-only">Close</span>
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Pinned Messages Section */}
        {pinnedMessages.length > 0 && (
          <div className="border-b bg-yellow-50 p-3">
            <div className="text-sm font-semibold text-gray-700 mb-2">📌 Pinned Messages ({pinnedMessages.length})</div>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {pinnedMessages.map((message) => (
                <div key={message.id} className="bg-white p-2 rounded text-sm text-gray-700 border border-yellow-200">
                  {message.content}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.senderId === user?.id ? 'justify-end' : 'justify-start'} relative group`}
            >
              <div className="relative">
                <div
                  className={`rounded-lg px-4 py-2 max-w-sm transition-all duration-200 ${
                    message.senderId === user?.id
                      ? 'bg-blue-500 text-white'
                      : message.status === MessageDeliveryStatus.READ
                        ? 'bg-gray-100 text-gray-900'
                        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                  }`}
                  onClick={() => handleMessageClick(message)}
                  style={{
                    cursor: message.senderId !== user?.id && message.status !== MessageDeliveryStatus.READ
                      ? 'pointer'
                      : 'default'
                  }}
                >
                  {/* Forwarded indicator */}
                  {message.isForwarded && (
                    <div className={`text-xs italic mb-1 ${
                      message.senderId === user?.id ? 'text-blue-200' : 'text-gray-500'
                    }`}>
                      ↪ Forwarded message
                    </div>
                  )}

                  {/* Pinned indicator */}
                  {message.isPinned && (
                    <div className={`text-xs mb-1 ${
                      message.senderId === user?.id ? 'text-blue-200' : 'text-gray-500'
                    }`}>
                      📌 Pinned
                    </div>
                  )}

                  <p>{message.content}</p>
                  <div className="flex justify-between items-center mt-1">
                    <p className={`text-xs ${
                      message.senderId === user?.id ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </p>
                    {message.senderId === user?.id && (
                      <span className={`text-xs ${
                        message.senderId === user?.id ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {message.status === MessageDeliveryStatus.SENT && '✓'}
                        {message.status === MessageDeliveryStatus.DELIVERED && '✓✓'}
                        {message.status === MessageDeliveryStatus.READ && '✓✓✓'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Message actions menu */}
                <div className="absolute top-0 right-full mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setShowMessageMenu(showMessageMenu === message.id ? null : message.id)}
                    className="p-1 bg-white rounded shadow-md hover:bg-gray-100"
                  >
                    <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>

                  {showMessageMenu === message.id && (
                    <div className="absolute right-0 mt-1 w-40 bg-white rounded-md shadow-lg z-10">
                      <button
                        onClick={() => handlePinMessage(message)}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        {message.isPinned ? '📌 Unpin' : '📌 Pin Message'}
                      </button>
                      <button
                        onClick={() => handleForwardMessage(message)}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        ↪ Forward
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSendMessage} className="p-4 border-t">
          <div className="flex space-x-4">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || !isConnected}
              className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
