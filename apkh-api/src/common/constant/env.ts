/** Reads a required environment variable, failing fast at startup if it is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/** Comma-separated list of browser origins allowed by CORS. */
export function getCorsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3002')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
