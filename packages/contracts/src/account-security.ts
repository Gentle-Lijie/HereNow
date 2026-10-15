import { z } from 'zod';

export const currentPasswordSchema = z.string().min(1, '请输入当前密码').max(200);
export const changePasswordSchema = z
  .object({
    current_password: currentPasswordSchema,
    new_password: z.string().min(12, '新密码至少 12 个字符').max(200, '新密码最多 200 个字符'),
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
