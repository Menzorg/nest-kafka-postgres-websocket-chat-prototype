'use client';

import dynamic from 'next/dynamic';

// Отключаем SSR для компонента со списком пользователей
const UsersList = dynamic(() => import('./components/UsersList'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-xl font-semibold text-gray-600">Loading...</div>
    </div>
  ),
});

export default function Home() {
  return <UsersList />;
}
