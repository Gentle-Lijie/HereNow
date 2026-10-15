import { z } from 'zod';

export const passwordSchema = z.string().min(1, '请输入密码');
export const currentPasswordSchema = z.string().min(1, '请输入当前密码');
export const changePasswordSchema = z
  .object({
    current_password: currentPasswordSchema,
    new_password: z.string().min(1, '请输入新密码'),
  })
  .strict();
export const passkeyRegistrationSchema = z
  .object({
    current_password: currentPasswordSchema,
  })
  .strict();
export const passkeyNameSchema = z.string().trim().min(1, '请输入 Passkey 名称').max(80);
export interface PasskeySummary {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}
