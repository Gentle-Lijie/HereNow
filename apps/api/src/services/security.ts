import { createHash, createHmac, randomBytes, createCipheriv, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import type { EventRecord } from '../../../../packages/contracts/src/index.js';
export const randomToken = () => randomBytes(24).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest();
export const identityDigest = (event: Pick<EventRecord, 'id' | 'identity_type'>, value: string) =>
  createHmac('sha256', config.IDENTITY_SECRET)
    .update(JSON.stringify([event.id, event.identity_type, value]))
    .digest();
export const browserDigest = (value: string) =>
  createHmac('sha256', config.IDENTITY_SECRET).update(`browser:${value}`).digest();
export const csrf = (browser: string) =>
  createHmac('sha256', config.TOKEN_SECRET).update(`csrf:${browser}`).digest('base64url');
export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(config.ENCRYPTION_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [
    iv.toString('base64'),
    c.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export const key = new TextEncoder().encode(config.TOKEN_SECRET);
export async function signQr(event: EventRecord) {
  return new SignJWT({
    event_id: event.id,
    public_id: event.public_id,
    purpose: 'event_checkin',
    policy_epoch: event.policy_epoch,
  })
    .setProtectedHeader({ alg: 'HS256', kid: '1' })
    .setIssuedAt()
    .setExpirationTime('45s')
    .sign(key);
}
export async function verifyQr(token: string) {
  if (token.length > 2048) throw new Error('QR_EXPIRED');
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    algorithms: ['HS256'],
    maxTokenAge: '45s',
    clockTolerance: 0,
  });
  if (
    protectedHeader.kid !== '1' ||
    payload.purpose !== 'event_checkin' ||
    typeof payload.event_id !== 'string' ||
    typeof payload.public_id !== 'string' ||
    typeof payload.policy_epoch !== 'number' ||
    !payload.exp ||
    !payload.iat ||
    payload.exp - payload.iat > 45 ||
    payload.iat > Date.now() / 1000
  )
    throw new Error('QR_EXPIRED');
  return payload as typeof payload & { event_id: string; public_id: string; policy_epoch: number };
}
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const fail = (code: string, message: string, status = 400): never => {
  throw new AppError(code, message, status);
};
