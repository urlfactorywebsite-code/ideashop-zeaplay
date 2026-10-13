import { io } from 'socket.io-client';

export const connectPresence = ({ token, onOnline, onOffline }) => {
  const presenceUrl = import.meta.env.VITE_PRESENCE_URL || 'http://localhost:6312';
  const socket = io(presenceUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    timeout: 10000,
  });

  socket.on('connect', () => {
    socket.emit('presence:get', (payload) => {
      if (payload?.ok && Array.isArray(payload.users)) {
        payload.users.forEach((userId) => onOnline?.(userId));
      }
    });
    socket.emit('presence:ping');
  });

  socket.on('user_online', (payload) => onOnline?.(payload?.userId));
  socket.on('user_offline', (payload) => onOffline?.(payload?.userId));
  socket.on('presence:online', (payload) => onOnline?.(payload?.userId));
  socket.on('presence:offline', (payload) => onOffline?.(payload?.userId));

  return socket;
};
