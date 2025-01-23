export interface User {
  id: string;
  email: string;
  username: string;
  password: string;
}

export interface UserPresence {
  userId: string;
  status: UserStatus;
  lastSeen: Date;
}

export enum UserStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  AWAY = 'AWAY'
}
