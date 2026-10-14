import { describe, it, expect } from 'vitest';
import { displayClockOffset } from '../apps/web/src/services/display-clock.js';
describe('display QR lifetime', () => {
  it('deducts request delay while compensating local clock skew', () => {
    const server = Date.parse('2026-10-14T12:00:00Z'),
      start = server + 3600000;
    const offset = displayClockOffset(new Date(server).toISOString(), start),
      expires = server + 45000;
    const remaining = (now: number) => Math.max(0, Math.ceil((expires - now - offset) / 1000));
    expect(remaining(start + 15000)).toBe(30);
    expect(remaining(start + 45000)).toBe(0);
  });
});
