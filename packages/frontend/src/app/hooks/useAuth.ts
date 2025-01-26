import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  setToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  logout: () => void;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

// Безопасное получение значения из localStorage
const getStoredToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('token');
  } catch (e) {
    console.error('Failed to access localStorage:', e);
    return null;
  }
};

type AuthStore = AuthState;

const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: getStoredToken(),
      user: null,
      isAuthenticated: false,
      login: async (email: string, password: string) => {
        try {
          const response = await fetch(`${BACKEND_URL}/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Ошибка при входе в систему');
          }

          const data = await response.json();
          
          if (!data.accessToken) {
            throw new Error('Не удалось получить токен доступа');
          }

          set({
            token: data.accessToken,
            user: data.user,
            isAuthenticated: true,
          });
        } catch (error) {
          set({ token: null, user: null, isAuthenticated: false });
          throw error;
        }
      },
      setToken: (token: string | null) =>
        set((state) => ({
          ...state,
          token,
          isAuthenticated: !!token,
        })),
      setUser: (user: User | null) =>
        set((state) => ({
          ...state,
          user,
          isAuthenticated: !!user,
        })),
      logout: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export const useAuth = () => {
  const store = useAuthStore();
  return {
    token: store.token,
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    login: store.login,
    setToken: store.setToken,
    setUser: store.setUser,
    logout: store.logout,
  };
};
