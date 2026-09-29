// Secrets are read when modules load; unit tests use throwaway values instead of a real .env.
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.ENCRYPTION_SECRET ??= 'test-encryption-secret-of-32-chars!!';
