import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:4000';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ODRlYTIxNy0wOWRjLTQ2ZTItODM4OS0wNTVhYTQwMzBhOTMiLCJlbWFpbCI6Im1lbnpvcmdAZ21haWwuY29tIiwiaWF0IjoxNzM3NjM4Mzk2LCJleHAiOjE3Mzc3MjQ3OTZ9.aVIxYFyqJ585P8-sM_xp3ZfJj_n103pjLzluN41Tg_I';

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

// Запускаем тест
testSocketConnection()
  .then(() => {
    log('=== Test completed successfully ===');
    process.exit(0);
  })
  .catch((error) => {
    log('=== Test failed ===');
    log('Error:', error.message);
    process.exit(1);
  });
