import { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import socketService from '../services/socketService';
import { useRouter } from 'next/navigation';

export const useSocket = (token: string | null) => {
  const [socket, setSocket] = useState<Socket | null>(socketService.getSocket());
  const [isConnected, setIsConnected] = useState(socketService.isConnected());
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    let reconnectTimer: NodeJS.Timeout;

    const connectSocket = () => {
      try {
        if (!token) {
          console.log('=== Disconnecting socket (no token) ===');
          socketService.disconnect();
          if (mounted) {
            setSocket(null);
            setIsConnected(false);
            setError(null);
          }
          return;
        }

        console.log('=== Connecting/retrieving socket ===', {
          hasExistingSocket: !!socketService.getSocket(),
          existingSocketConnected: socketService.isConnected()
        });

        const newSocket = socketService.connect(token);

        if (mounted) {
          setSocket(newSocket);
          setIsConnected(newSocket.connected);
          setError(null);
        }

        // Обработчики событий сокета
        const onConnect = () => {
          console.log('=== Socket connected ===', {
            socketId: newSocket.id,
            connected: newSocket.connected
          });
          if (mounted) {
            setIsConnected(true);
            setError(null);
          }
        };

        const onDisconnect = (reason: string) => {
          console.log('=== Socket disconnected ===', {
            socketId: newSocket.id,
            reason
          });
          if (mounted) {
            setIsConnected(false);
            
            // Не пытаемся переподключиться, если сессия истекла
            if (error === 'User not found') {
              console.log('=== Not reconnecting due to expired session ===');
              return;
            }
            
            // Пробуем переподключиться через 2 секунды
            reconnectTimer = setTimeout(() => {
              console.log('=== Attempting to reconnect from useSocket ===');
              connectSocket();
            }, 2000);
          }
        };

        const onError = (err: Error) => {
          console.error('=== Socket error ===', {
            socketId: newSocket.id,
            error: err.message
          });
          
          if (mounted) {
            setError(err.message);
            
            // Если сессия истекла, показываем сообщение и перенаправляем
            if (err.message === 'User not found') {
              console.log('=== Session expired, redirecting to login ===');
              setError('Ваша сессия истекла. Пожалуйста, войдите снова.');
              if (!window.location.pathname.includes('/login')) {
                router.push('/login?reason=session_expired');
              }
              return;
            }
            
            // При других ошибках пробуем переподключиться
            reconnectTimer = setTimeout(() => {
              console.log('=== Attempting to reconnect after error ===');
              connectSocket();
            }, 2000);
          }
        };

        // Удаляем старые обработчики перед добавлением новых
        newSocket.off('connect', onConnect);
        newSocket.off('disconnect', onDisconnect);
        newSocket.off('connect_error', onError);

        // Добавляем новые обработчики
        newSocket.on('connect', onConnect);
        newSocket.on('disconnect', onDisconnect);
        newSocket.on('connect_error', onError);

        // Если сокет уже подключен, вызываем onConnect вручную
        if (newSocket.connected) {
          onConnect();
        }
      } catch (err) {
        console.error('=== Socket connection error ===', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Connection failed');
          
          // Не пытаемся переподключиться, если сессия истекла
          if (err instanceof Error && err.message === 'User not found') {
            return;
          }
          
          // При других ошибках подключения пробуем переподключиться
          reconnectTimer = setTimeout(() => {
            console.log('=== Attempting to reconnect after connection error ===');
            connectSocket();
          }, 2000);
        }
      }
    };

    connectSocket();

    return () => {
      mounted = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      console.log('=== Cleaning up socket event handlers ===');
      const currentSocket = socketService.getSocket();
      if (currentSocket) {
        currentSocket.off('connect');
        currentSocket.off('disconnect');
        currentSocket.off('connect_error');
      }
    };
  }, [token, router]); // eslint-disable-line react-hooks/exhaustive-deps

  return { socket, isConnected, error };
};
