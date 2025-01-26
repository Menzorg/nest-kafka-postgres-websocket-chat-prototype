import { UserStatus as UserStatusType } from '../types';

interface UserStatusProps {
  status: UserStatusType;
}

export function UserStatus({ status }: UserStatusProps) {
  return (
    <div className="flex items-center gap-2">
      <div 
        className={`w-2 h-2 rounded-full ${
          status.isOnline ? 'bg-green-500' : 'bg-gray-400'
        }`}
      />
      <span className="text-sm text-gray-500">
        {status.isOnline 
          ? 'Online'
          : status.lastSeen 
            ? `Last seen ${new Date(status.lastSeen).toLocaleString()}`
            : 'Offline'
        }
      </span>
    </div>
  );
}
