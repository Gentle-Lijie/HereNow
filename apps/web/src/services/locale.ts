import { ref } from 'vue';
import type { Field } from '../../../../packages/contracts/src/index.js';
import { errorMessage } from './api.js';
export type Locale = 'zh' | 'en';
function initialLocale(): Locale {
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem('hn_locale');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* Language persistence is optional. */
  }
  return typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('zh')
    ? 'en'
    : 'zh';
}
export const locale = ref<Locale>(initialLocale());
export const t = (zh: string, en: string) => (locale.value === 'zh' ? zh : en);
export function setLocale(value: Locale) {
  locale.value = value;
  try {
    localStorage.setItem('hn_locale', value);
  } catch {
    /* Keep the selected in-memory language. */
  }
}
const syncLanguage = (event: StorageEvent) => {
  if (event.key === 'hn_locale' && (event.newValue === 'zh' || event.newValue === 'en'))
    locale.value = event.newValue;
};
if (typeof window !== 'undefined') window.addEventListener('storage', syncLanguage);
const hot = (import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } }).hot;
if (hot)
  hot.dispose(() => {
    if (typeof window !== 'undefined') window.removeEventListener('storage', syncLanguage);
  });
export function fieldLabel(field: Field, language: Locale = locale.value) {
  return language === 'en' ? field.label_en?.trim() || field.label : field.label;
}
export function publicErrorMessage(cause: unknown): string {
  const message = errorMessage(cause);
  if (locale.value === 'zh') return message;
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  if (code === 'LOCATION_OUTSIDE') {
    const distance = message.match(/约\s*(\d+)\s*米/)?.[1];
    return distance
      ? `Your location is outside the check-in area, about ${distance} m from the permitted area. Please move closer and locate again.`
      : 'Your location is outside the check-in area. Please move closer and locate again.';
  }
  const messages: Record<string, string> = {
    NETWORK_ERROR: 'Connection lost. Please check your network and retry.',
    QR_EXPIRED: 'The QR code has expired or is invalid. Please scan the latest on-site code.',
    SESSION_EXPIRED: 'This check-in session has expired. Please scan the latest code again.',
    RULE_CHANGED: 'The event rules have changed. Please scan the latest code again.',
    ACTIVITY_UNAVAILABLE: 'Check-in is not open, has been paused, or has ended.',
    IDENTITY_NOT_ELIGIBLE: 'Unable to confirm eligibility. Please contact on-site staff.',
    ALREADY_SUBMITTED:
      'A field that requires a unique value already has a check-in. Please contact staff.',
    LOCATION_DENIED: 'Location is required. Please enable location access or contact staff.',
    LOCATION_UNCERTAIN:
      'The location accuracy or boundary is uncertain. Please locate again or contact staff.',
    COORDINATE_CONVERSION_FAILED: 'Unable to verify these coordinates. Please contact staff.',
    LOCATION_SOURCE_UNSUPPORTED: 'This location source is not supported.',
    RATE_LIMITED: 'Too many attempts. Please wait and try again.',
    IDEMPOTENCY_CONFLICT: 'The retry differs from the original request. Please contact staff.',
    CSRF_INVALID: 'Page verification expired. Please refresh and retry.',
    INVALID_FORM: 'Please check the required fields and input format.',
    UNAUTHORIZED: 'The display session expired. Please open the QR code from the dashboard.',
    FORBIDDEN: 'You do not have permission to view this information.',
  };
  if (messages[code]) return messages[code];
  for (const [pattern, replace] of [
    [/^请填写(.+)$/, 'Please enter $1.'],
    [/^请选择(.+)$/, 'Please select $1.'],
    [/^请确认(.+)$/, 'Please confirm $1.'],
    [/^(.+)格式或长度不正确$/, 'Please check the format or length of $1.'],
    [/^(.+)必须是数字$/, '$1 must be a number.'],
    [/^(.+)包含无效选项$/, '$1 contains an invalid option.'],
  ] as const)
    if (pattern.test(message)) return message.replace(pattern, replace);
  return /[\u3400-\u9fff]/.test(message)
    ? 'Unable to complete this action. Please retry or contact on-site staff.'
    : message;
}
