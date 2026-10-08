import type { MessageKey } from "@/i18n";

/**
 * Rules for a NEW password (register, reset). Mirrored by the API in
 * apkh-api/src/common/utils/password-rules.ts — change both together.
 * bcrypt reads only the first 72 bytes, hence the upper bound.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

/** Passwords created before these rules only had to be this long; sign-in still accepts them. */
export const LEGACY_PASSWORD_MIN = 6;

export interface PasswordContext {
  name?: string;
  email?: string;
}

export interface PasswordRule {
  id: string;
  label: MessageKey;
  test: (password: string, context: PasswordContext) => boolean;
}

/** Name words and the email's local part (3+ characters) that shouldn't appear in the password. */
function personalBits({ name = "", email = "" }: PasswordContext) {
  return [...name.split(/\s+/), email.split("@")[0] ?? ""].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3);
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "length", label: "auth.ruleLength", test: (p) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX },
  { id: "lower", label: "auth.ruleLower", test: (p) => /[a-z]/.test(p) },
  { id: "upper", label: "auth.ruleUpper", test: (p) => /[A-Z]/.test(p) },
  { id: "number", label: "auth.ruleNumber", test: (p) => /\d/.test(p) },
  { id: "symbol", label: "auth.ruleSymbol", test: (p) => /[^A-Za-z0-9\s]/.test(p) },
  { id: "spaces", label: "auth.ruleNoSpaces", test: (p) => p.length > 0 && !/\s/.test(p) },
  {
    id: "personal",
    label: "auth.rulePersonal",
    test: (p, ctx) => p.length > 0 && !personalBits(ctx).some((bit) => p.toLowerCase().includes(bit)),
  },
];

export function checkPassword(password: string, context: PasswordContext = {}) {
  const results = PASSWORD_RULES.map((rule) => ({ ...rule, ok: rule.test(password, context) }));
  const passed = results.filter((r) => r.ok).length;
  // 0–4: how far along the user is; full marks only when every rule passes.
  const allOk = passed === results.length;
  const strength = allOk ? (password.length >= 12 ? 4 : 3) : Math.min(2, Math.floor((passed / results.length) * 3));
  return { results, valid: allOk, strength };
}
