import { api, errorMessage } from './api';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { PasskeySummary } from '../../../../packages/contracts/src/account-security';

export const passkeysSupported = () => window.isSecureContext && !!window.PublicKeyCredential;
export const listPasskeys = () => api<{ passkeys: PasskeySummary[] }>('/admin/passkeys');
export const changePassword = (current_password: string, new_password: string) =>
  api('/admin/password', { method: 'POST', body: { current_password, new_password } });
export async function addPasskey(current_password: string, name: string, signal: AbortSignal) {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const { options, challenge_id } = await api<{
    options: PublicKeyCredentialCreationOptionsJSON;
    challenge_id: string;
  }>('/admin/passkeys/register/options', { method: 'POST', body: { current_password }, signal });
  if (signal.aborted) return;
  const response = await startRegistration({ optionsJSON: options });
  if (signal.aborted) return;
  await api('/admin/passkeys/register/verify', {
    method: 'POST',
    body: { challenge_id, name, response },
    signal,
  });
}
export const removePasskey = (id: string, current_password: string) =>
  api(`/admin/passkeys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: { current_password },
  });
export async function loginWithPasskey(signal: AbortSignal) {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { options, challenge_id } = await api<{
    options: PublicKeyCredentialRequestOptionsJSON;
    challenge_id: string;
  }>('/admin/passkeys/login/options', { method: 'POST', body: {}, signal });
  if (signal.aborted) return;
  const response = await startAuthentication({ optionsJSON: options });
  if (signal.aborted) return;
  await api('/admin/passkeys/login/verify', {
    method: 'POST',
    body: { challenge_id, response },
    signal,
  });
}
export function cancelPasskey() {
  void import('@simplewebauthn/browser').then(({ WebAuthnAbortService }) =>
    WebAuthnAbortService.cancelCeremony(),
  );
}
export function passkeyError(error: unknown) {
  if (
    error instanceof Error &&
    ['NotAllowedError', 'AbortError', 'InvalidStateError', 'WebAuthnError'].includes(error.name)
  )
    return 'Passkey 操作未完成。请重试、选择其他凭证或使用密码登录。';
  return errorMessage(error);
}
