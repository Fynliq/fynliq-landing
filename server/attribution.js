// Marketing attribution: turns what a browser saw on arrival (UTM tags, an
// ad click id, the referring site) into one cleaned, classified "touch",
// and records it against the guest browser. Supabase is the source of truth
// (public.acquisition_attribution); see the migration for first-touch rules.
//
// What a browser may send (src/analytics/attribution.ts builds it):
//   { utm: { source, medium, campaign, content, term }, referrer: <host>,
//     landing: <path>, clickIds: { ttclid, gclid, fbclid }: booleans, ref,
//     app: 'tiktok' | 'instagram' | 'facebook' (built-in browser, if any) }
// Everything is re-validated here. Only host names are accepted for the
// referrer and only a path for the landing page, so a full URL, a search
// query or anything personal never reaches the database. Click ids are
// presence flags: the ids themselves are never sent or stored.
import { rpc } from './beta.js';

export const CHANNELS = ['tiktok', 'instagram', 'facebook', 'google', 'referral', 'direct', 'other'];

/** Built-in app browsers the client may report, by name only. */
const IN_APP = ['tiktok', 'instagram', 'facebook'];

const LIMITS = { source: 100, medium: 100, campaign: 150, content: 150, term: 150 };

/** Lower-case, trimmed, control characters removed, length-capped; '' becomes null. */
export function clean(value, max = 150) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, max);
  return text || null;
}

/** A bare host name ('www.tiktok.com'), or null. */
export function cleanHost(value) {
  if (typeof value !== 'string') return null;
  let host = value.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try { host = new URL(host).hostname; } catch { return null; }
  }
  host = host.replace(/\.$/, '');
  return /^[a-z0-9.-]{1,253}$/.test(host) && host.includes('.') ? host : null;
}

/** The landing path only: no query string, no fragment, safe characters. */
export function cleanPath(value) {
  if (typeof value !== 'string') return '/';
  const path = value.split(/[?#]/)[0].slice(0, 200);
  return /^\/[A-Za-z0-9/_.-]{0,199}$/.test(path) ? path : '/';
}

// utm_source spellings people actually use, per channel.
const SOURCE_ALIASES = [
  ['tiktok', /^(tiktok|tik[ _-]?tok|tt|tiktok\.com|tiktok[_-]?ads?|tiktokads)$/],
  ['instagram', /^(instagram|insta|ig|instagram\.com)$/],
  ['facebook', /^(facebook|fb|meta|facebook\.com|fb\.com)$/],
  ['google', /^(google|google[_-]?ads|googleads|adwords|google\.com|youtube[_-]?ads)$/],
];
const REFERRAL_WORDS = /^(referral|refer|share|shared|shared[_-]?link|friend|invite|word[_-]?of[_-]?mouth)$/;

// Referring sites. Matched on the end of the host name.
const REFERRER_CHANNELS = [
  ['tiktok', /(^|\.)(tiktok\.com|tiktokv\.com|tiktokcdn\.com)$/, 'tiktok'],
  ['instagram', /(^|\.)instagram\.com$/, 'instagram'],
  ['facebook', /(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com|m\.me)$/, 'facebook'],
  ['google', /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, 'google'],
];
// Well-known sites that are neither the channels above nor a personal shared link.
const OTHER_SITES = [
  [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'], [/(^|\.)yahoo\.com$/, 'yahoo'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'], [/(^|\.)reddit\.com$/, 'reddit'], [/(^|\.)(x\.com|twitter\.com|t\.co)$/, 'x'],
  [/(^|\.)snapchat\.com$/, 'snapchat'], [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'], [/(^|\.)pinterest\.[a-z.]+$/, 'pinterest'],
  [/(^|\.)threads\.net$/, 'threads'], [/(^|\.)chatgpt\.com$/, 'chatgpt'], [/(^|\.)perplexity\.ai$/, 'perplexity'],
];

/**
 * Hosts that are FYNQ itself or a hop inside FYNQ's own flow (Stripe
 * Checkout returning the student). A visit "from" these is not a new source.
 */
export function internalHosts(env = process.env) {
  const hosts = ['fynliq.com', 'checkout.stripe.com', 'stripe.com'];
  try { if (env.BETA_ORIGIN) hosts.push(new URL(env.BETA_ORIGIN).hostname.toLowerCase()); } catch { /* ignore */ }
  for (const h of (env.ATTRIBUTION_INTERNAL_HOSTS || '').split(',')) { const c = cleanHost(h); if (c) hosts.push(c); }
  return hosts;
}
const isInternal = (host, hosts) => hosts.some((h) => host === h || host.endsWith(`.${h}`)) || /(^|\.)fynliq-[a-z0-9-]+\.vercel\.app$/.test(host);

function channelForSource(source) {
  for (const [channel, pattern] of SOURCE_ALIASES) if (pattern.test(source)) return channel;
  if (REFERRAL_WORDS.test(source)) return 'referral';
  return null;
}

/**
 * Classifies one arrival. Priority, as specified:
 *   1. explicit UTM tags (utm_source present)
 *   2. a ?ref= shared link
 *   3. an ad click id (ttclid -> TikTok, gclid -> Google, fbclid -> Meta)
 *   4. an app's built-in browser (TikTok, Instagram, Facebook)
 *   5. a recognizable outside referrer
 *   6. direct
 * utm_campaign / utm_content are kept whichever rule decides the source.
 * Returns the object stored by public.attribution_touch.
 */
export function classifyTouch(input, env = process.env) {
  const raw = input && typeof input === 'object' ? input : {};
  const utmIn = raw.utm && typeof raw.utm === 'object' ? raw.utm : {};
  const utm = Object.fromEntries(Object.entries(LIMITS).map(([k, max]) => [k, clean(utmIn[k], max)]));
  const landing_page = cleanPath(raw.landing);
  let referrer = cleanHost(raw.referrer);
  if (referrer && isInternal(referrer, internalHosts(env))) referrer = null;
  const clickIds = raw.clickIds && typeof raw.clickIds === 'object' ? raw.clickIds : {};
  const ref = clean(raw.ref, 100);
  const app = IN_APP.includes(raw.app) ? raw.app : null;
  const raw_utm = Object.fromEntries(Object.entries(utm).filter(([, v]) => v !== null).map(([k, v]) => [`utm_${k}`, v]));
  const base = { landing_page, referrer, raw_utm, term: utm.term, campaign: utm.campaign, content: utm.content };

  if (utm.source) {
    const medium = utm.medium;
    const channel = channelForSource(utm.source) ?? (medium === 'referral' ? 'referral' : 'other');
    return { ...base, attribution_type: 'utm', channel, source: utm.source, medium };
  }
  if (ref) return { ...base, attribution_type: 'utm', channel: channelForSource(ref) ?? 'referral', source: ref, medium: utm.medium ?? 'referral' };
  if (clickIds.ttclid === true) return { ...base, attribution_type: 'click_id', channel: 'tiktok', source: 'tiktok', medium: utm.medium ?? 'paid_social' };
  if (clickIds.gclid === true) return { ...base, attribution_type: 'click_id', channel: 'google', source: 'google', medium: utm.medium ?? 'cpc' };
  if (clickIds.fbclid === true) {
    // Meta adds fbclid to links opened from both Instagram and Facebook; the
    // referrer, when there is one, says which.
    const instagram = app === 'instagram' || Boolean(referrer && /(^|\.)instagram\.com$/.test(referrer));
    return { ...base, attribution_type: 'click_id', channel: instagram ? 'instagram' : 'facebook', source: instagram ? 'instagram' : 'facebook', medium: utm.medium ?? 'social' };
  }
  // Opened inside TikTok / Instagram / Facebook: their bio links and DMs
  // usually arrive with no referrer at all.
  if (app) return { ...base, attribution_type: 'in_app', channel: app, source: app, medium: utm.medium ?? 'social' };
  if (referrer) {
    for (const [channel, pattern, source] of REFERRER_CHANNELS) {
      if (pattern.test(referrer)) return { ...base, attribution_type: 'referrer', channel, source, medium: utm.medium ?? (channel === 'google' ? 'organic' : 'social') };
    }
    for (const [pattern, source] of OTHER_SITES) {
      if (pattern.test(referrer)) return { ...base, attribution_type: 'referrer', channel: 'other', source, medium: utm.medium ?? 'referral' };
    }
    return { ...base, attribution_type: 'referrer', channel: 'referral', source: referrer.replace(/^www\./, '').slice(0, 100), medium: utm.medium ?? 'referral' };
  }
  // Tagged link with no utm_source: keep the campaign, but do not guess a channel.
  if (utm.campaign || utm.content || utm.medium) return { ...base, attribution_type: 'utm', channel: 'other', source: null, medium: utm.medium };
  return { landing_page, referrer: null, raw_utm: {}, attribution_type: 'direct', channel: 'direct', source: null, medium: null, campaign: null, content: null, term: null };
}

/** Best effort: attribution must never break a page load. */
export async function recordTouch(db, guestId, input, env = process.env) {
  if (!guestId || !input || typeof input !== 'object') return null;
  try {
    return await rpc(db, 'attribution_touch', { p_guest: guestId, p_touch: classifyTouch(input, env) });
  } catch {
    return null;
  }
}

/**
 * Safe identifiers for Stripe Checkout metadata: the guest id that first
 * arrived and the first-touch UTM values. No email, no aid data.
 * Stripe metadata values are limited to 500 characters; these are far shorter.
 */
export function stripeAttributionMetadata(attribution) {
  if (!attribution || typeof attribution !== 'object' || typeof attribution.channel !== 'string') return {};
  const meta = {
    fynq_channel: attribution.channel,
    fynq_guest_id: typeof attribution.guest_id === 'string' ? attribution.guest_id : undefined,
    utm_source: attribution.source ?? undefined,
    utm_medium: attribution.medium ?? undefined,
    utm_campaign: attribution.campaign ?? undefined,
    utm_content: attribution.content ?? undefined,
  };
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => typeof v === 'string' && v.length > 0 && v.length <= 500));
}

/** The account's first touch, or null when it cannot be read. Never throws. */
export async function accountAttribution(db, accountId) {
  try { return await rpc(db, 'attribution_for_account', { p_user: accountId }); } catch { return null; }
}
