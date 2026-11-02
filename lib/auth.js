import { timingSafeEqual } from 'node:crypto';

/**
 * Requires `Authorization: Bearer <EXORA_API_TOKEN>`.
 * Returns true when authorized; otherwise writes the HTTP response and returns false.
 */
export function requireAppToken(req, res) {
  const expected = process.env.EXORA_API_TOKEN?.trim() ?? '';
  if (!expected) {
    res.status(503).json({ error: 'EXORA_API_TOKEN is not configured' });
    return false;
  }

  const header = String(req.headers.authorization ?? '');
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const provided = match?.[1]?.trim() ?? '';

  if (
    !provided ||
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}
