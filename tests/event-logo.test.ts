import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { normalizeEventLogo } from '../apps/api/src/services/event-logo.js';
import { eventInputSchema } from '../packages/contracts/src/index.js';

function png(width = 2, height = 2) {
  const image = new PNG({ width, height });
  image.data.fill(128);
  return PNG.sync.write(image);
}
const url = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;
describe('event logo validation', () => {
  it('decodes and preserves a valid raster and permits restoring the default', () => {
    const original = png();
    const normalized = normalizeEventLogo(url(original))!;
    expect(PNG.sync.read(Buffer.from(normalized.split(',')[1]!, 'base64')).data).toEqual(
      PNG.sync.read(original).data,
    );
    expect(normalizeEventLogo(null)).toBeNull();
  });
  it('rejects corrupted raster bytes and dimensions before decoding oversized images', () => {
    const bad = png();
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    expect(() => normalizeEventLogo(url(bad))).toThrow('Logo 图片无效');
    expect(() => normalizeEventLogo(url(png(361, 1)))).toThrow('尺寸超过限制');
    expect(() => normalizeEventLogo(url(Buffer.alloc(24577)))).toThrow('Logo 图片无效或过大');
  });
  it('rejects SVG, remote URLs and oversized data at the shared boundary', () => {
    const event = {
      name: '测试',
      organizer: '测试',
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-01-02T00:00:00Z',
    };
    expect(eventInputSchema.parse(event).checkin_logo).toBeNull();
    for (const logo of [
      'https://example.com/logo.png',
      'data:image/svg+xml,<svg/>',
      'data:image/png;base64,' + 'A'.repeat(32772),
    ])
      expect(eventInputSchema.safeParse({ ...event, checkin_logo: logo }).success).toBe(false);
  });
});
