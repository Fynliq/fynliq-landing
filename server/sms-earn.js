import { createHmac, timingSafeEqual } from 'node:crypto';
import { providerResponse } from './provider.js';

export const MAX_SMS_BODY_LENGTH = 800;

/**
 * Twilio's form-encoded webhook signature: HMAC-SHA1 of the exact configured
 * public URL followed by alphabetically sorted parameter names and values.
 * Reject duplicate parameter names at the request boundary.
 */
export function verifyTwilioSignature({ url, params, signature, authToken }) {
  if (!url || !params || !signature || !authToken) return false;
  const canonical = url + Object.keys(params).sort()
    .map((key) => key + String(params[key])).join('');
  const expected = createHmac('sha1', authToken).update(canonical, 'utf8').digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseTwilioForm(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 16_384) {
    throw new Error('Invalid SMS webhook payload');
  }
  const form = new URLSearchParams(raw);
  const params = Object.create(null);
  for (const [key, value] of form.entries()) {
    if (Object.hasOwn(params, key)) throw new Error('Duplicate webhook field');
    params[key] = value;
  }
  return params;
}

export function xmlMessage(message) {
  const safe = String(message ?? '').slice(0, 650).replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character]);
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + safe + '</Message></Response>';
}

const OPT_IN = 'Fynliq Earn AI replies to requests for earning ideas, AI task drafts, deals and ride links. Msg frequency varies; msg/data rates may apply. Reply YES to opt in, STOP to cancel, HELP for help. Promo alerts need separate consent.';
const HELP = 'Fynliq SMS: CRISIS for aid, WORK for income ideas, BUDGET for cash flow, TASK for drafts, UBER for a ride link, DEALS for offers. No guaranteed cash. STOP cancels texts. Help: https://fynliq.com';

/**
 * Stateless per-message business logic. The caller supplies a consent store and
 * model responder so that webhook, database and AI are independently testable.
 */
export async function handleEarnSms({ body, getStatus, setStatus, getDealsStatus, setDealsStatus, answer }) {
  const text = String(body ?? '').trim();
  if (!text || text.length > MAX_SMS_BODY_LENGTH) {
    return 'Please send a shorter text message (800 characters or fewer).';
  }
  const command = text.toUpperCase();
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(command)) {
    await setStatus('opted_out');
    return 'Fynliq Earn AI: You are unsubscribed. No more automated messages. Text JOIN to request enrollment again.';
  }
  if (command === 'HELP' || command === 'INFO') return HELP;
  if (command === 'JOIN') {
    await setStatus('pending');
    return OPT_IN;
  }
  const status = await getStatus();
  if (command === 'YES') {
    if (status !== 'pending') return 'To subscribe to Fynliq Earn AI, text JOIN first, then reply YES.';
    await setStatus('active');
    return 'You are subscribed to Fynliq. Text CRISIS for assistance, WORK for earning ideas, or TASK to draft client work. No guaranteed income. Text STOP to unsubscribe.';
  }
  if (command === 'START' || command === 'UNSTOP') {
    await setStatus('pending');
    return OPT_IN;
  }
  if (status !== 'active') {
    return 'Welcome to Fynliq Earn AI. Text JOIN to see the consent notice and subscribe before using the assistant.';
  }
  // Promotional alerts require separate consent. There is no broadcaster yet.
  if (command === 'DEALS JOIN') {
    if (!setDealsStatus) return 'Deal alert enrollment is not configured yet.';
    await setDealsStatus('pending');
    return 'Optional Fynliq deal texts: varying frequency; msg/data rates may apply. Not required to use Fynliq. Reply DEALS YES to opt in, DEALS STOP for no promotions, or STOP for all messages.';
  }
  if (command === 'DEALS YES') {
    if (!getDealsStatus || !setDealsStatus || await getDealsStatus() !== 'pending') {
      return 'To opt into promotional deals, text DEALS JOIN and review the notice before DEALS YES.';
    }
    await setDealsStatus('active');
    return 'Deal preference saved. Scheduled promotional messages are NOT active yet. For a deal on demand, text DEALS. DEALS STOP cancels promotions.';
  }
  if (command === 'DEALS STOP' || command === 'DEALS OFF') {
    if (!setDealsStatus) return 'Deal preferences are not configured yet.';
    await setDealsStatus('opted_out');
    return 'Promotional deal texts are switched off. You can still request assistance. Text STOP to stop all Fynliq SMS.';
  }
  return await answer(text);
}

const AGENT_INSTRUCTIONS = [
  'You are Fynliq Earn AI, an SMS assistant for adults exploring lawful income opportunities.',
  'Reply concisely (maximum 320 characters), in plain text, without markdown.',
  'Offer practical general earning ideas based on the customer message.',
  'Do not invent job postings, live listings, pay rates, employer details, clients, links or guaranteed earnings.',
  'You do not have any opportunity-search tool. Never claim you searched or booked or applied to anything.',
  'Fynliq cannot deposit cash, send payouts, confirm grant approval, connect bank accounts or verify buyer payments yet. Never imply that funds were transferred.',
  'If the customer describes urgent hardship, suggest the CRISIS or AID text command for the official assistance navigator. If they need practical work help, suggest WORK or TASK.',
  'Do not encourage get-rich-quick schemes, multi-level marketing, risky trading, gambling, fraud or illicit activity.',
  'Never request bank account numbers, Social Security numbers, passwords or card details by SMS.',
  'If the user needs verified current jobs, explain this feature is not connected yet.',
  'Ask at most one relevant question about skills, schedule, or location preferences.',
].join(' ');

export async function replyWithExistingModel(message, {
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey || !model) return 'Fynliq Earn AI is being configured. Please try again later.';
  try {
    const result = await providerResponse(message, AGENT_INSTRUCTIONS, null, {
      apiKey, model, maxOutputTokens: 250,
      fetchImpl: (url, options) => fetchImpl(url, {
        ...options, signal: AbortSignal.timeout(8500),
      }),
    });
    return String(result).trim().slice(0, 320) || 'Please try again.';
  } catch {
    return 'Fynliq Earn AI could not answer right now. Please try again later. Never send private account details by text.';
  }
}
