import { PNG } from 'pngjs';
import { fail } from './security.js';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function normalizeEventLogo(logo: string | null): string | null {
  if (logo === null) return null;
  const bytes = Buffer.from(logo.slice('data:image/png;base64,'.length), 'base64');
  if (
    bytes.length < 33 ||
    bytes.length > 24576 ||
    !bytes.subarray(0, 8).equals(signature) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  )
    return fail('INVALID_FORM', 'Logo 图片无效或过大，请重新选择图片');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (width < 1 || width > 360 || height < 1 || height > 96)
    return fail('INVALID_FORM', 'Logo 尺寸超过限制，请重新选择图片');
  try {
    // Verify CRC / actual raster content, then re-encode to discard ancillary metadata.
    const png = PNG.sync.read(bytes, { checkCRC: true });
    const clean = PNG.sync.write(png, { deflateLevel: 9 });
    if (clean.length > 24576) return fail('INVALID_FORM', 'Logo 图片过大，请重新选择图片');
    return `data:image/png;base64,${clean.toString('base64')}`;
  } catch {
    return fail('INVALID_FORM', 'Logo 图片无效或过大，请重新选择图片');
  }
}
