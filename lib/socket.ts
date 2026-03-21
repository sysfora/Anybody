import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Fetches a short-lived signed token from the Next.js server.
 * The raw WS_SECRET is never exposed to the browser.
 */
async function fetchWsToken(): Promise<string> {
  try {
    const res = await fetch('/api/ws-token');
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      return data.token ?? '';
    }
  } catch {
    // Silently fall back to no token (server will reject if WS_SECRET is set).
  }
  return '';
}

export const getSocket = (): Socket => {
  if (!socket) {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:5000';

    // Socket.IO calls the auth callback before every connection attempt
    // (including reconnects), so the token is always fresh.
    socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      auth: (cb: (data: Record<string, string>) => void) => {
        fetchWsToken().then((token) => cb({ token })).catch(() => cb({ token: '' }));
      },
    });
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

