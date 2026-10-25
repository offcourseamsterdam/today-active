import { createHash, timingSafeEqual } from 'node:crypto'

/** Constant-time string comparison via fixed-length SHA-256 digests (safe even when lengths differ). */
export function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest()
  const digestB = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(digestA, digestB)
}

export type BearerAuthResult = { ok: true } | { ok: false; error: string }

/** Validates an `Authorization: Bearer <token>` header against `expectedToken`. */
export function checkBearerAuth(authHeader: string | string[] | undefined, expectedToken: string): BearerAuthResult {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader
  const match = header?.match(/^Bearer (.+)$/)
  if (!match || !constantTimeEqual(match[1], expectedToken)) {
    return { ok: false, error: 'Unauthorized' }
  }
  return { ok: true }
}
