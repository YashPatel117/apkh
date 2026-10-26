import { applyDecorators } from '@nestjs/common';
import { Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Rules for a NEW password (register, reset). Mirrored by the web app in
 * apkh-web/src/lib/passwordRules.ts — change both together.
 * bcrypt reads only the first 72 bytes, hence the upper bound.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

/** Validators for a new password; every unmet rule is reported. */
export function IsNewPassword() {
  return applyDecorators(
    MinLength(PASSWORD_MIN, {
      message: `Password must be at least ${PASSWORD_MIN} characters`,
    }),
    MaxLength(PASSWORD_MAX, {
      message: `Password must be at most ${PASSWORD_MAX} characters`,
    }),
    Matches(/[a-z]/, { message: 'Password must contain a lowercase letter' }),
    Matches(/[A-Z]/, { message: 'Password must contain an uppercase letter' }),
    Matches(/\d/, { message: 'Password must contain a number' }),
    Matches(/[^A-Za-z0-9\s]/, { message: 'Password must contain a symbol' }),
    Matches(/^\S*$/, { message: 'Password must not contain spaces' }),
  );
}

/** True when the password contains a 3+ character part of the name or the email's local part. */
export function containsPersonalInfo(
  password: string,
  { name = '', email = '' }: { name?: string; email?: string },
) {
  const lower = password.toLowerCase();
  return [...name.split(/\s+/), email.split('@')[0] ?? '']
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3)
    .some((bit) => lower.includes(bit));
}
