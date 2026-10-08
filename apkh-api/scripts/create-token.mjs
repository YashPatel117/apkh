// Creates an integration token for a user, as Profile → Integrations does, or
// revokes one. Handy for setting up the MCP server without opening the app.
// Usage (from apkh-api/):
//   npm run token:create -- user@example.com "Claude Code" --read   read + write (MCP)
//   npm run token:create -- user@example.com "Zapier"               write only
//   npm run token:create -- --revoke <token id>
// The token is printed once; only its hash is stored.
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';

const TOKEN_PREFIX = 'apkh_';
const MAX_TOKENS = 20;

const args = process.argv.slice(2).map((arg) => arg.trim());
const read = args.includes('--read');
const revoke = args.includes('--revoke');
const [first, second] = args.filter((arg) => !arg.startsWith('--'));

if (revoke ? !first : !first || !second) {
  console.error(
    'Usage: npm run token:create -- <email> <name> [--read]\n' +
      '       npm run token:create -- --revoke <token id>',
  );
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set (see .env).');
  process.exit(1);
}

await mongoose.connect(uri);
try {
  const tokens = mongoose.connection.collection('integration_tokens');
  if (revoke) {
    const deleted = mongoose.isValidObjectId(first)
      ? await tokens.deleteOne({ _id: new mongoose.Types.ObjectId(first), kind: 'token' })
      : { deletedCount: 0 };
    console.log(deleted.deletedCount ? 'Token revoked.' : 'No token with that id.');
  } else {
    const user = await mongoose.connection
      .collection('users')
      .findOne({ email: first }, { projection: { _id: 1 } });
    if (!user) {
      console.error(`No user with the email ${first}.`);
      process.exitCode = 1;
    } else if ((await tokens.countDocuments({ userId: user._id, kind: 'token' })) >= MAX_TOKENS) {
      console.error(`${first} already has ${MAX_TOKENS} tokens. Revoke one first.`);
      process.exitCode = 1;
    } else {
      const secret = TOKEN_PREFIX + randomBytes(24).toString('base64url');
      const now = new Date();
      const { insertedId } = await tokens.insertOne({
        userId: user._id,
        name: second.slice(0, 60),
        kind: 'token',
        secretHash: createHash('sha256').update(secret).digest('hex'),
        prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
        scopes: read ? ['notes:write', 'notes:read'] : ['notes:write'],
        createdAt: now,
        updatedAt: now,
      });
      console.log(`Token "${second}" for ${first} (${read ? 'read + write' : 'write only'}), id ${insertedId}:`);
      console.log(secret);
      console.log('Copy it now: it is not shown again.');
    }
  }
} finally {
  await mongoose.disconnect();
}
