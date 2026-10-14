import { db, rows } from '../db.js';
import { digest, fail } from './security.js';
import { getEvent } from './events.js';

export async function readDisplayEvent(eventId: string, token: string | undefined) {
  if (!token) return fail('UNAUTHORIZED', '请从后台打开电子码展示页', 401);
  const [session] = await rows(
    db,
    'SELECT 1 FROM display_sessions WHERE token_digest=? AND event_id=? AND expires_at>UTC_TIMESTAMP(3) AND revoked=FALSE',
    [digest(token), eventId],
  );
  if (!session) return fail('UNAUTHORIZED', '展示会话已过期', 401);
  return getEvent(eventId);
}
