'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import dynamic from 'next/dynamic';

const Chat = dynamic(() => import('./Chat'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-6">
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse"></div>
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse delay-75"></div>
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse delay-150"></div>
        </div>
        <p className="mt-2 text-gray-600">Loading chat...</p>
      </div>
    </div>
  ),
});

interface User {
  id: string;
  name: string;
  email: string;
  isOnline: boolean;
}

interface ChatState {
  isOpen: boolean;
  recipientId: string | null;
  recipientName: string | null;
}

export default function UsersList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [chat, setChat] = useState<ChatState>({
    isOpen: false,
    recipientId: null,
    recipientName: null,
  });
  const { isAuthenticated, token, logout, user: currentUser } = useAuth();
  const { socket, isConnected, error } = useSocket(token);
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!socket || !isConnected) {
      return;
    }

    const handleUsersList = (response: { users: User[] }) => {
      console.log('Received users list:', response.users);
      setUsers(response.users);
      setLoading(false);
    };

    const handleUserUpdate = ({ userId, isOnline }: { userId: string; isOnline: boolean }) => {
      console.log('User status update:', { userId, isOnline });
      setUsers(prevUsers => 
        prevUsers.map(user => 
          user.id === userId ? { ...user, isOnline } : user
        )
      );
    };

    // Запрашиваем список пользователей после подключения
    socket.emit('users:list', {}, handleUsersList);

    // Подписываемся на обновления статуса пользователей
    socket.on('users:update', handleUserUpdate);

    return () => {
      socket.off('users:update', handleUserUpdate);
    };
  }, [socket, isConnected]);

  useEffect(() => {
    // Сбрасываем состояние загрузки при отключении сокета
    if (!isConnected) {
      setLoading(true);
    }
  }, [isConnected]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleOpenChat = (recipientId: string, recipientName: string) => {
    if (recipientId === currentUser?.id) return; // Не открываем чат с самим собой
    setChat({
      isOpen: true,
      recipientId,
      recipientName,
    });
  };

  const handleCloseChat = () => {
    setChat({
      isOpen: false,
      recipientId: null,
      recipientName: null,
    });
  };

  if (!isAuthenticated) {
    return null;
  }

  if (loading || !isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl font-semibold text-gray-600">
          {error ? 'Connection error...' : 'Loading...'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold">Online Users</h2>
            <button
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded shadow-sm transition-colors"
            >
              Logout
            </button>
          </div>
          <div className="border-4 border-dashed border-gray-200 rounded-lg p-4">
            {users.length === 0 ? (
              <p className="text-center text-gray-500">No users found</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className={`bg-white overflow-hidden shadow rounded-lg cursor-pointer transition-transform hover:scale-105 ${
                      user.id === currentUser?.id ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    onClick={() => user.id !== currentUser?.id && handleOpenChat(user.id, user.name)}
                  >
                    <div className="px-4 py-5 sm:p-6">
                      <div className="flex items-center">
                        <div className="flex-shrink-0">
                          <div className="h-12 w-12 rounded-full bg-gray-300 flex items-center justify-center">
                            {user.name[0].toUpperCase()}
                          </div>
                        </div>
                        <div className="ml-4">
                          <h3 className="text-lg font-medium text-gray-900">
                            {user.name} {user.id === currentUser?.id ? '(You)' : ''}
                          </h3>
                          <p className="text-sm text-gray-500">{user.email}</p>
                        </div>
                        <div className="ml-auto">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              user.isOnline
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {user.isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {chat.isOpen && chat.recipientId && chat.recipientName && (
        <Chat
          recipientId={chat.recipientId}
          recipientName={chat.recipientName}
          onClose={handleCloseChat}
        />
      )}
    </div>
  );
}
