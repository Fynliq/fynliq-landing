import { providerResponse } from './provider.js';
import { replyWithExistingModel } from './sms-earn.js';

export const UBER_RIDE_LINK = 'https://m.uber.com/';

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && url.hostname.includes('.') && url.hostname !== 'localhost'
      && !/^\d+(?:\.\d+){3}$/.test(url.hostname)
      ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Deals come ONLY from a curated, human-reviewed catalog.
 * Never synthesize discounts or imply live availability from the AI model.
 * No background or promotional messages are sent from this function.
 */
export function reviewedDeals(catalog, now = new Date()) {
  let items;
  try {
    items = typeof catalog === 'string' ? JSON.parse(catalog || '[]') : catalog;
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const current = now.getTime();
  return items.filter((item) => {
    if (!item || item.reviewedByFynliq !== true) return false;
    if (typeof item.title !== 'string' || item.title.trim().length < 5 || item.title.length > 90) return false;
    if (!validHttpsUrl(item.sourceUrl)) return false;
    const reviewedAt = Date.parse(item.reviewedAt);
    const expiresAt = Date.parse(item.expiresAt);
    // 72-hour freshness cap for manually verified offers.
    return Number.isFinite(reviewedAt) && reviewedAt <= current
      && reviewedAt >= current - 72 * 60 * 60 * 1000
      && Number.isFinite(expiresAt) && expiresAt > current;
  }).slice(0, 2).map((item) => ({
    title: item.title.trim().replace(/\s+/g, ' '),
    sourceUrl: validHttpsUrl(item.sourceUrl),
    expiresAt: new Date(item.expiresAt).toISOString().slice(0, 10),
  }));
}

export function dealsReply(catalog, now = new Date()) {
  const deals = reviewedDeals(catalog, now);
  if (!deals.length) {
    return 'No recently reviewed deals are available yet. Fynliq will not invent discounts. Text DEALS again later; promotional alerts are not active.';
  }
  const deal = deals[0];
  return ('Fynliq-listed offer: ' + deal.title + '. Listed through ' + deal.expiresAt
    + '. Review eligibility, final price and terms at ' + deal.sourceUrl
    + '. No purchase or booking has been made.').slice(0, 570);
}

const WORK_TYPES = Object.freeze({
  CAPTION: 'a concise, publish-ready social media caption',
  LISTING: 'clear, accurate product-listing copy',
  REPLY: 'a polite, professional reply to a client',
});

/**
 * Completes a narrow, customer-supplied draft deliverable. It does not
 * accept third-party contracts, impersonate a user, submit work, or issue
 * payouts. Payment status must come from a verified payment integration.
 */
export async function draftCustomerDeliverable(message, {
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL,
  provider = providerResponse,
  fetchImpl = fetch,
} = {}) {
  const match = /^TASK\s+(CAPTION|LISTING|REPLY)\s*:\s*([\s\S]+)$/i.exec(String(message).trim());
  if (!match) {
    return 'To finish a draft task, text TASK CAPTION: <brief>, TASK LISTING: <brief>, or TASK REPLY: <brief>. Only use work you are authorized to complete.';
  }
  const kind = match[1].toUpperCase();
  const brief = match[2].trim();
  if (brief.length < 12 || brief.length > 600) {
    return 'Please provide a non-sensitive client brief between 12 and 600 characters after the colon.';
  }
  if (!apiKey || !model) return 'The drafting model is not configured yet. No task was completed.';
  const instructions = [
    'You are the Fynliq Earn AI draft-work tool.',
    'Create ' + WORK_TYPES[kind] + ' from the brief. Return only the final deliverable.',
    'Do not invent prices, product properties, credentials, endorsements, client approval, legal rights or experience.',
    'Do not impersonate another person or manufacture testimonials or reviews.',
    'Do not claim that the deliverable was sent, published, accepted, or paid.',
    'Refuse fraudulent, unlawful or deceptive instructions.',
    'Maximum 310 characters, plain text. Do not request private account or payment credentials.',
  ].join(' ');
  try {
    const answer = await provider(brief, instructions, null, {
      apiKey, model, maxOutputTokens: 270,
      fetchImpl: (url, options) => fetchImpl(url, {
        ...options, signal: AbortSignal.timeout(8500),
      }),
    });
    const draft = String(answer ?? '').trim().slice(0, 310);
    if (!draft) throw new Error('Empty draft');
    return 'Draft created (NOT sent or paid): ' + draft + ' Review and approve before sharing with a client.';
  } catch {
    return 'Fynliq could not prepare that draft right now. Nothing was submitted or paid.';
  }
}

/**
 * Route only explicitly supported actions. Other questions use the existing
 * general-purpose assistant; no tool call silently makes a purchase.
 */
export async function answerEarnRequest(message, {
  catalogJson = process.env.FYNLIQ_REVIEWED_DEALS_JSON || '[]',
  currentTime = new Date(),
  genericAnswer = replyWithExistingModel,
  draftWork = draftCustomerDeliverable,
} = {}) {
  const value = String(message ?? '').trim();
  if (/^(?:UBER|RIDE|CALL(?:\s+AN?)?\s+UBER|BOOK(?:\s+AN?)?\s+UBER)\b/i.test(value)) {
    return 'Open Uber to check rides, prices, and confirm your own booking: ' + UBER_RIDE_LINK
      + ' Fynliq has NOT booked a ride or charged you. Never share payment details by SMS.';
  }
  if (/^DEALS?$/i.test(value)) return dealsReply(catalogJson, currentTime);
  if (/^DEALS?\s+(?:ON|ALERTS?)$/i.test(value)) {
    return 'For separate promotional consent, text DEALS JOIN. Deal-alert broadcasts are not active yet.';
  }
  if (/^TASK(?:\s|$)/i.test(value)) return draftWork(value);
  return genericAnswer(value);
}
