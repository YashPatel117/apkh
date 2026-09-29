import { requireEnv } from './env';

export const JwtSecretKey = requireEnv('JWT_SECRET');
