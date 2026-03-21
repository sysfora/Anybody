import { createHmac } from 'crypto';
import { NextResponse } from 'next/server';
import { getSessionRecord } from '@/lib/session-user';

export const dynamic = 'force-dynamic';

/**
 * Issues a short-lived HMAC-signed token for the WebSocket server.
 * The WS_SECRET never leaves the server — only the signed token is sent to
 * the browser, and only for authenticated users.
 *
 * Token format:  "<expiresAt>.<hmac-sha256>"
 *   expiresAt — Unix timestamp (seconds), valid for 1 hour
 *   hmac      — HMAC-SHA256(expiresAt, WS_SECRET) as hex
 *
 * The Python server validates the HMAC and checks expiresAt > now.
 */
export async function GET() {
  const session = await getSessionRecord();
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secret = process.env.WS_SECRET;
  if (!secret) {
    // No secret configured — return empty token (server skips validation in dev).
    return NextResponse.json({ token: '' });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const payload = String(expiresAt);
  const mac = createHmac('sha256', secret).update(payload).digest('hex');

  return NextResponse.json({ token: `${payload}.${mac}` });
}
