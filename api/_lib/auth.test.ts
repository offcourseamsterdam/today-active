import { describe, it, expect } from 'vitest'
import { constantTimeEqual, checkBearerAuth } from './auth'

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('secret-token', 'secret-token')).toBe(true)
  })

  it('returns false for different strings of the same length', () => {
    expect(constantTimeEqual('secret-token', 'secret-tokeN')).toBe(false)
  })

  it('returns false for different-length strings without throwing', () => {
    expect(constantTimeEqual('short', 'a-much-longer-string')).toBe(false)
  })

  it('returns false for empty vs non-empty', () => {
    expect(constantTimeEqual('', 'x')).toBe(false)
  })

  it('returns true for two empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true)
  })
})

describe('checkBearerAuth', () => {
  const token = 'my-agent-token'

  it('accepts a matching Bearer header', () => {
    expect(checkBearerAuth('Bearer my-agent-token', token)).toEqual({ ok: true })
  })

  it('rejects a mismatched token', () => {
    const result = checkBearerAuth('Bearer wrong-token', token)
    expect(result.ok).toBe(false)
  })

  it('rejects a missing header', () => {
    const result = checkBearerAuth(undefined, token)
    expect(result.ok).toBe(false)
  })

  it('rejects a header without the Bearer prefix', () => {
    const result = checkBearerAuth(token, token)
    expect(result.ok).toBe(false)
  })

  it('takes the first value when the header arrives as an array', () => {
    expect(checkBearerAuth(['Bearer my-agent-token'], token)).toEqual({ ok: true })
  })
})
