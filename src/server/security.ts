import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
  randomInt,
} from 'node:crypto';
const scrypt = (
  password: string,
  salt: string,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
) =>
  new Promise<Buffer>((resolve, reject) =>
    rawScrypt(password, salt, length, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return ['scrypt', 32768, 8, 3, salt, hash.toString('hex')].join('$');
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const actual = (await scrypt(password, salt, 64, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const randomCode = () => Array.from({ length: 4 }, () => alphabet[randomInt(62)]).join('');
export class Limiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private rate: number,
    private burst: number,
    private now = Date.now,
  ) {}
  take(key: string): number {
    const now = this.now(),
      b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) * this.rate) / 60000);
    b.at = now;
    const retry = b.tokens < 1 ? Math.ceil(((1 - b.tokens) * 60) / this.rate) : 0;
    if (!retry) b.tokens--;
    this.buckets.set(key, b);
    if (this.buckets.size > 10000)
      for (const [k, v] of this.buckets) if (now - v.at > 600000) this.buckets.delete(k);
    return retry;
  }
}
