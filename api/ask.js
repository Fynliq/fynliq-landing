import { answerQuestion } from '../server/ask-service.js';

export const config = { maxDuration: 60 };
// A per-instance backstop only; configure Vercel Firewall limits before public use.
const buckets = new Map();
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Use POST to ask a question.');
  }
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return res.status(415).send('Send your question as JSON.');
  }
  let payload;
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
    if (Buffer.byteLength(raw, 'utf8') > 65536) return res.status(413).send('That question is too large. Please shorten it.');
    payload = JSON.parse(raw);
  } catch { return res.status(400).send('The question could not be read. Please try again.'); }
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const bucket = buckets.get(ip) ?? { count: 0, until: now + 60000 };
  if (bucket.count >= 10) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.until - now) / 1000)));
    return res.status(429).send('Please wait a minute before asking more questions.');
  }
  bucket.count++; buckets.set(ip, bucket);
  const result = await answerQuestion(payload, { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL });
  if (result.error) return res.status(result.status).send(result.error);
  return res.status(200).json(result.body);
}
