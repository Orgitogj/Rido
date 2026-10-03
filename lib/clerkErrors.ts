import type { TKey } from "@/lib/i18n/translate";

const BY_CODE: Record<string, TKey> = {
  form_password_incorrect: "auth.problem.passwordIncorrect",
  form_identifier_not_found: "auth.problem.accountNotFound",
  form_identifier_exists: "auth.problem.emailTaken",
  form_password_pwned: "auth.problem.passwordPwned",
  form_password_length_too_short: "auth.problem.passwordWeak",
  form_password_not_strong_enough: "auth.problem.passwordWeak",
  form_password_validation_failed: "auth.problem.passwordWeak",
  form_param_format_invalid: "auth.problem.emailInvalid",
  form_code_incorrect: "auth.problem.codeIncorrect",
  verification_failed: "auth.problem.codeIncorrect",
  verification_expired: "auth.problem.codeExpired",
  too_many_requests: "auth.problem.tooManyAttempts",
  user_locked: "auth.problem.tooManyAttempts",
  network_error: "errors.NETWORK",
};

type Coded = { code?: unknown; errors?: { code?: unknown }[] };

export function clerkErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Coded;
  const nested = Array.isArray(e.errors) ? e.errors[0]?.code : undefined;
  const code = typeof nested === "string" ? nested : e.code;
  return typeof code === "string" ? code : null;
}

export function clerkErrorKey(error: unknown): TKey | null {
  const code = clerkErrorCode(error);
  return code ? (BY_CODE[code] ?? null) : null;
}
