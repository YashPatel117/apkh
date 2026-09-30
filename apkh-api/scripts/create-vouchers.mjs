// Creates one-time Pro plan voucher codes ("XXXX-XXXX") and prints them.
// Users redeem them in Profile > Plan > Upgrade.
// Usage (from apkh-api/):
//   npm run vouchers:create -- 30      create 30 codes
//   npm run vouchers:create -- --list  list every code and whether it was used
import 'dotenv/config';
import { randomInt } from 'node:crypto';
import mongoose from 'mongoose';

// No look-alikes (0/O, 1/I/L), so codes are easy to read and type.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const arg = process.argv[2]?.trim();
const list = arg === '--list';
const count = list ? 0 : Number(arg ?? 10);

if (!list && (!Number.isInteger(count) || count < 1 || count > 1000)) {
  console.error('Usage: npm run vouchers:create -- <count 1-1000> | --list');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set (see .env).');
  process.exit(1);
}

function newCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}

await mongoose.connect(uri);
try {
  const vouchers = mongoose.connection.collection('vouchers');
  await vouchers.createIndex({ code: 1 }, { unique: true });

  if (list) {
    const all = await vouchers.find({}, { sort: { createdAt: 1 } }).toArray();
    for (const v of all) {
      console.log(`${v.code}  ${v.redeemed ? `redeemed ${v.redeemedAt?.toISOString()}` : 'unused'}`);
    }
    console.log(`${all.length} codes, ${all.filter((v) => !v.redeemed).length} unused.`);
  } else {
    const created = [];
    while (created.length < count) {
      const now = new Date();
      const doc = { code: newCode(), redeemed: false, createdAt: now, updatedAt: now };
      try {
        await vouchers.insertOne(doc);
        created.push(doc.code);
      } catch (error) {
        if (error?.code !== 11000) throw error; // a duplicate code: draw another
      }
    }
    console.log(`Created ${created.length} Pro voucher codes:`);
    console.log(created.join('\n'));
  }
} finally {
  await mongoose.disconnect();
}
