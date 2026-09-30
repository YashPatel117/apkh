// Creates each service's env file from its .env.example when it is missing.
// New files get generated secrets; JWT_SECRET is shared by apkh-api,
// apkh-storage and apkh-search, so an existing one is reused.
// Usage (from the repository root): node scripts/init-env.mjs
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  { dir: 'apkh-api', target: '.env' },
  { dir: 'apkh-storage', target: '.env' },
  { dir: 'apkh-search', target: '.env' },
  { dir: 'apkh-web', target: '.env.local' },
];
const PLACEHOLDER = 'change-me';

const readVar = (text, name) => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
const secret = (bytes) => randomBytes(bytes).toString('hex');

// Reuse a JWT secret that is already configured, so every service agrees.
const existingSecrets = FILES.map(({ dir, target }) => path.join(root, dir, target))
  .filter((file) => fs.existsSync(file))
  .map((file) => readVar(fs.readFileSync(file, 'utf8'), 'JWT_SECRET'))
  .filter((value) => value && value !== PLACEHOLDER);
const jwtSecret = existingSecrets[0] ?? secret(64);
if (new Set(existingSecrets).size > 1) {
  console.warn('  ! JWT_SECRET differs between services; make it identical in all three .env files.');
}

for (const { dir, target } of FILES) {
  const example = path.join(root, dir, '.env.example');
  const file = path.join(root, dir, target);
  const label = `${dir}/${target}`;
  if (fs.existsSync(file)) {
    console.log(`  = ${label} already exists, left as is`);
    continue;
  }
  if (!fs.existsSync(example)) {
    console.warn(`  ! ${dir}/.env.example not found, skipped`);
    continue;
  }
  const text = fs
    .readFileSync(example, 'utf8')
    .replace(/^JWT_SECRET=change-me$/m, `JWT_SECRET=${jwtSecret}`)
    .replace(/^ENCRYPTION_SECRET=change-me$/m, `ENCRYPTION_SECRET=${secret(32)}`);
  fs.writeFileSync(file, text);
  console.log(`  + ${label} created`);
}

const apiEnvFile = path.join(root, 'apkh-api', '.env');
const apiEnv = fs.existsSync(apiEnvFile) ? fs.readFileSync(apiEnvFile, 'utf8') : '';
if (readVar(apiEnv, 'MONGODB_URI')?.includes('<')) {
  console.log('\n  Next: set MONGODB_URI in apkh-api/.env to your MongoDB connection string.');
}
