// Shows or changes a user's plan (free or pro), which decides their built-in AI
// allowance per session and their place in its queue (see src/users/plans.ts).
// Usage (from apkh-api/):
//   npm run plan:set -- user@example.com          show the current plan
//   npm run plan:set -- user@example.com pro      change it
import 'dotenv/config';
import mongoose from 'mongoose';

const PLANS = ['free', 'pro'];
const [email, plan] = process.argv.slice(2).map((arg) => arg?.trim());

if (!email || (plan && !PLANS.includes(plan.toLowerCase()))) {
  console.error('Usage: npm run plan:set -- <email> [free|pro]');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set (see .env).');
  process.exit(1);
}

await mongoose.connect(uri);
try {
  const users = mongoose.connection.collection('users');
  const user = await users.findOne({ email }, { projection: { type: 1 } });
  if (!user) {
    console.error(`No user with the email ${email}.`);
    process.exitCode = 1;
  } else if (!plan) {
    console.log(`${email} is on the ${user.type === 'pro' ? 'Pro' : 'Free'} plan.`);
  } else {
    await users.updateOne({ _id: user._id }, { $set: { type: plan.toLowerCase() } });
    console.log(`${email} is now on the ${plan.toLowerCase() === 'pro' ? 'Pro' : 'Free'} plan.`);
  }
} finally {
  await mongoose.disconnect();
}
