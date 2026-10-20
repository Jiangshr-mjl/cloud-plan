import { randomInt, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
const destination = 'outputs/access-key.txt';
mkdirSync('outputs', { recursive: true });
if (existsSync(destination) && !process.argv.includes('--rotate')) {
  throw new Error('Access key already exists. Use --rotate only when intentionally resetting all devices.');
}
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const key = Array.from({ length: 32 }, () => alphabet[randomInt(alphabet.length)]).join('');
const hash = createHash('sha256').update(key).digest('hex');
writeFileSync(destination, key + '\n', { mode: 0o600 });
writeFileSync('.dev.vars', `PLANNER_KEY_HASH=${hash}\n`, { mode: 0o600 });
console.log('Created access key in ignored outputs/access-key.txt and local hash in .dev.vars. Keep the key private.');
