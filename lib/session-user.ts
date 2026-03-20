import { cookies } from 'next/headers';
import type { RecordModel } from 'pocketbase';

/**
 * PocketBase user model from the `pocketbase_auth` cookie (set by the client auth flow).
 */
export async function getSessionRecord(): Promise<RecordModel | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('pocketbase_auth')?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { model?: RecordModel };
    const model = parsed?.model;
    if (model && typeof model.id === 'string') return model;
    return null;
  } catch {
    return null;
  }
}

export function escapePbFilterString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
