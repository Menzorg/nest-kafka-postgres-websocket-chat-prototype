export interface UserStatus {
  userId: string;
  isOnline: boolean;
  lastSeen?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  status: UserStatus;
}
