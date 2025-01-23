import { io } from 'socket.io-client';
import { MessageDeliveryStatus } from '@webchat/common';

const SOCKET_URL = 'http://localhost:4000';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ODRlYTIxNy0wOWRjLTQ2ZTItODM4OS0wNTVhYTQwMzBhOTMiLCJlbWFpbCI6Im1lbnpvcmdAZ21haWwuY29tIiwiaWF0IjoxNzM3NjM4Mzk2LCJleHAiOjE3Mzc3MjQ3OTZ9.aVIxYFyqJ585P8-sM_xp3ZfJj_n103pjLzluN41Tg_I';
const CHAT_ID = '00345711-dd17-4963-9d0d-55aa1514958d';

interface ConnectionEstablishedData {
  userId: string;
}

function log(...args: any[]) {
  console.log(new Date().toISOString(), ...args);
}

async function testSocketConnection() {
  log('=== Starting socket connection test ===');

  return new Promise((resolve, reject) => {
    let hasError = false;
    let connectionEstablished = false;
    let userId: string | null = null;

    const socket = io(SOCKET_URL, {
      auth: { token: TOKEN },
      transports: ['websocket'],
      reconnection: false,
      timeout: 30000,
    });

    // Логируем состояние сокета
    const logSocketState = () => {
      log('Socket state:', {
        id: socket.id,
        connected: socket.connected,
        disconnected: socket.disconnected,
        transport: socket.io?.engine?.transport?.name,
        readyState: socket.io?.engine?.readyState,
        userId,
        connectionEstablished,
      });
    };

    // Подключение к сокету
    socket.on('connect', () => {
      log('=== Socket connected ===');
      logSocketState();
    });

    // Ошибка подключения
    socket.on('connect_error', (error) => {
      log('=== Connection error ===');
      log('Error:', error.message);
      logSocketState();
      hasError = true;
      reject(new Error(`Connection error: ${error.message}`));
    });

    // События от сервера
    socket.on('connection:established', (data: ConnectionEstablishedData) => {
      log('=== Connection established ===');
      log('Data:', data);
      
      // Проверяем формат данных
      if (!data.userId) {
        hasError = true;
        reject(new Error('Invalid connection:established data: missing userId'));
        return;
      }

      userId = data.userId;
      connectionEstablished = true;
      logSocketState();

      // Даем время на обработку события
      setTimeout(() => {
        if (socket.connected) {
          log('=== Test completed, disconnecting ===');
          socket.disconnect();
        }
        resolve(undefined);
      }, 1000);
    });

    socket.on('users:update', (data) => {
      log('=== Users update ===');
      log('Data:', data);
      logSocketState();
    });

    socket.on('error', (error) => {
      log('=== Socket error ===');
      log('Error:', error);
      logSocketState();
      hasError = true;
      reject(new Error(`Socket error: ${error.message}`));
    });

    // Процесс отключения
    socket.on('disconnecting', (reason) => {
      log('=== Socket disconnecting ===');
      log('Reason:', reason);
      logSocketState();
    });

    // Отключение
    socket.on('disconnect', (reason) => {
      log('=== Socket disconnected ===');
      log('Reason:', reason);
      logSocketState();

      // Проверяем результаты теста
      if (!connectionEstablished) {
        reject(new Error('Socket disconnected before connection was established'));
      } else if (hasError) {
        reject(new Error(`Disconnected with error: ${reason}`));
      }
    });

    // Через 10 секунд отключаемся если не было успешного подключения
    setTimeout(() => {
      if (!connectionEstablished) {
        log('=== Test timeout, no connection:established event received ===');
        logSocketState();
        socket.disconnect();
        reject(new Error('Test timeout: no connection:established event'));
      }
    }, 10000);
  });
}

async function testChatJoinAndMessageStatus() {
  log('=== Starting chat join and message status test ===');

  return new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL, {
      auth: { token: TOKEN },
      transports: ['websocket'],
      reconnection: false,
      timeout: 30000,
    });

    let chatJoined = false;
    let messageStatusReceived = false;

    // Подключение к сокету
    socket.on('connect', () => {
      log('=== Socket connected ===');
      log('Socket state:', {
        id: socket.id,
        connected: socket.connected
      });

      // Пробуем присоединиться к чату
      log('=== Attempting to join chat ===', { chatId: CHAT_ID });
      socket.emit('chat:join', { chatId: CHAT_ID }, (response: any) => {
        log('=== Chat join response ===', response);
        
        if (response.status === 'error') {
          reject(new Error(`Failed to join chat: ${response.message}`));
          return;
        }

        chatJoined = true;
        log('=== Successfully joined chat ===');

        // После успешного присоединения к чату, отправляем тестовое сообщение
        socket.emit('message', {
          chatId: CHAT_ID,
          content: 'Test message ' + new Date().toISOString()
        }, (messageResponse: any) => {
          log('=== Message sent response ===', messageResponse);
          
          if (messageResponse.status === 'error') {
            reject(new Error(`Failed to send message: ${messageResponse.message}`));
            return;
          }

          // Отмечаем сообщение как прочитанное
          socket.emit('message:read', { messageId: messageResponse.id }, (readResponse: any) => {
            log('=== Message read response ===', readResponse);
            
            if (readResponse.status === 'error') {
              reject(new Error(`Failed to mark message as read: ${readResponse.message}`));
              return;
            }
          });
        });
      });
    });

    // Слушаем обновления статуса сообщений
    socket.on('message:status', (status: { messageId: string, status: MessageDeliveryStatus }) => {
      log('=== Message status update received ===', status);
      messageStatusReceived = true;

      if (chatJoined && messageStatusReceived) {
        log('=== Test completed successfully ===');
        socket.disconnect();
        resolve(undefined);
      }
    });

    // Обработка ошибок
    socket.on('connect_error', (error) => {
      log('=== Connection error ===', error);
      reject(new Error(`Connection error: ${error.message}`));
    });

    socket.on('error', (error) => {
      log('=== Socket error ===', error);
      reject(new Error(`Socket error: ${error}`));
    });

    // Таймаут теста
    setTimeout(() => {
      if (!chatJoined || !messageStatusReceived) {
        socket.disconnect();
        reject(new Error('Test timeout: Some operations did not complete'));
      }
    }, 30000);
  });
}

// Запускаем тесты
Promise.all([
  testSocketConnection(),
  testChatJoinAndMessageStatus()
])
  .then(() => {
    log('=== All tests completed successfully ===');
    process.exit(0);
  })
  .catch((error) => {
    log('=== Test failed ===');
    log('Error:', error);
    process.exit(1);
  });
