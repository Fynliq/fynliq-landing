// Unit tests for marketing attribution: classification, cleaning, Stripe
// metadata and the browser-side capture. No network, no database.
//   node --test test/attribution.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTouch, cleanHost, cleanPath, stripeAttributionMetadata } from '../server/attribution.js';
import { arrivalFrom } from '../src/analytics/attribution.ts';

const env = { BETA_ORIGIN: 'https://www.fynliq.com' };
const touch = (href, referrer = '') => classifyTouch(arrivalFrom(href, referrer), env);

test('TikTok bio link: explicit UTM tags', () => {
  const t = touch('https://www.fynliq.com/?utm_source=tiktok&utm_medium=social&utm_campaign=profile&utm_content=bio');
  assert.equal(t.attribution_type, 'utm');
  assert.equal(t.channel, 'tiktok');
  assert.equal(t.source, 'tiktok');
  assert.equal(t.medium, 'social');
  assert.equal(t.campaign, 'profile');
  assert.equal(t.content, 'bio');
  assert.equal(t.landing_page, '/');
  assert.deepEqual(t.raw_utm, { utm_source: 'tiktok', utm_medium: 'social', utm_campaign: 'profile', utm_content: 'bio' });
});

test('TikTok video link keeps campaign and content, lower-cased', () => {
  const t = touch('https://www.fynliq.com/?utm_source=TikTok&utm_medium=social&utm_campaign=October_Growth&utm_content=Video_07');
  assert.equal(t.channel, 'tiktok');
  assert.equal(t.campaign, 'october_growth');
  assert.equal(t.content, 'video_07');
});

test('UTM tags win over the referrer', () => {
  const t = touch('https://www.fynliq.com/?utm_source=instagram&utm_campaign=story', 'https://www.tiktok.com/');
  assert.equal(t.channel, 'instagram');
  assert.equal(t.referrer, 'www.tiktok.com');
});

test('referrers are classified by host', () => {
  assert.equal(touch('https://www.fynliq.com/', 'https://www.tiktok.com/@fynq').channel, 'tiktok');
  assert.equal(touch('https://www.fynliq.com/', 'https://l.instagram.com/?u=x').channel, 'instagram');
  assert.equal(touch('https://www.fynliq.com/', 'https://m.facebook.com/').channel, 'facebook');
  assert.equal(touch('https://www.fynliq.com/', 'https://www.google.com/').channel, 'google');
  assert.equal(touch('https://www.fynliq.com/', 'https://www.google.co.uk/').channel, 'google');
  const reddit = touch('https://www.fynliq.com/', 'https://www.reddit.com/r/college');
  assert.equal(reddit.channel, 'other');
  assert.equal(reddit.source, 'reddit');
  const blog = touch('https://www.fynliq.com/beta', 'https://studentblog.example.org/post/1');
  assert.equal(blog.channel, 'referral');
  assert.equal(blog.source, 'studentblog.example.org');
  assert.equal(blog.landing_page, '/beta');
});

test('only the referrer host is kept, never its path or query', () => {
  const t = touch('https://www.fynliq.com/', 'https://www.google.com/search?q=my+fafsa+ssn+123');
  assert.equal(t.referrer, 'www.google.com');
  assert.ok(!JSON.stringify(t).includes('fafsa'));
});

test('no UTM and no referrer is direct', () => {
  const t = touch('https://www.fynliq.com/');
  assert.equal(t.attribution_type, 'direct');
  assert.equal(t.channel, 'direct');
  assert.equal(t.source, null);
});

test('FYNQ itself and Stripe Checkout are not sources', () => {
  assert.equal(touch('https://www.fynliq.com/beta/checkout?result=success', 'https://checkout.stripe.com/').channel, 'direct');
  assert.equal(classifyTouch({ landing: '/', referrer: 'fynliq.com' }, env).channel, 'direct');
  assert.equal(classifyTouch({ landing: '/', referrer: 'fynliq-landing-abc123-fynq.vercel.app' }, env).channel, 'direct');
});

test('ad click ids infer the network without storing the id', () => {
  const tt = touch('https://www.fynliq.com/?ttclid=E.C.P.secret');
  assert.equal(tt.channel, 'tiktok');
  assert.equal(tt.attribution_type, 'click_id');
  assert.ok(!JSON.stringify(tt).includes('secret'));
  assert.equal(touch('https://www.fynliq.com/?gclid=abc').channel, 'google');
  assert.equal(touch('https://www.fynliq.com/?fbclid=abc').channel, 'facebook');
  assert.equal(touch('https://www.fynliq.com/?fbclid=abc', 'https://l.instagram.com/').channel, 'instagram');
});

test('shared links and unknown sources are never labelled TikTok', () => {
  assert.equal(touch('https://www.fynliq.com/?ref=friend').channel, 'referral');
  assert.equal(touch('https://www.fynliq.com/?utm_source=newsletter').channel, 'other');
  assert.equal(touch('https://www.fynliq.com/?utm_source=partner&utm_medium=referral').channel, 'referral');
  assert.equal(touch('https://www.fynliq.com/?utm_campaign=october_growth').channel, 'other');
  for (const t of [touch('https://www.fynliq.com/'), touch('https://www.fynliq.com/?utm_source=snap')]) assert.notEqual(t.channel, 'tiktok');
});

test('hostile values are cleaned and capped', () => {
  const t = classifyTouch({ utm: { source: 'tiktok', campaign: `x${'a'.repeat(500)}`, content: 'v\u0000\u001f1' }, landing: '/a?b=c#d', referrer: 'javascript:alert(1)' }, env);
  assert.equal(t.campaign.length, 150);
  assert.equal(t.content, 'v 1');
  assert.equal(t.landing_page, '/a');
  assert.equal(t.referrer, null);
  assert.equal(cleanPath('/<script>'), '/');
  assert.equal(cleanHost('https://WWW.TikTok.com/foo'), 'www.tiktok.com');
  assert.equal(cleanHost('not a host'), null);
  assert.equal(classifyTouch(null, env).channel, 'direct');
  assert.equal(classifyTouch({ utm: 'nope', clickIds: 'nope' }, env).channel, 'direct');
});

test('Stripe metadata carries ids and UTM values only', () => {
  const meta = stripeAttributionMetadata({ id: 'x', guest_id: '00000000-0000-4000-8000-000000000001', channel: 'tiktok', source: 'tiktok', medium: 'social', campaign: 'october_growth', content: 'video_07', first_seen_at: '2026-10-05T00:00:00Z' });
  assert.deepEqual(meta, { fynq_channel: 'tiktok', fynq_guest_id: '00000000-0000-4000-8000-000000000001', utm_source: 'tiktok', utm_medium: 'social', utm_campaign: 'october_growth', utm_content: 'video_07' });
  assert.deepEqual(stripeAttributionMetadata({ channel: 'legacy', guest_id: null }), { fynq_channel: 'legacy' });
  assert.deepEqual(stripeAttributionMetadata(null), {});
});

test('browser capture: same-site referrer and odd paths', () => {
  const a = arrivalFrom('https://www.fynliq.com/search?utm_source=tiktok', 'https://www.fynliq.com/');
  assert.equal(a.referrer, undefined);
  assert.equal(a.landing, '/search');
  assert.deepEqual(a.utm, { source: 'tiktok' });
  assert.equal(arrivalFrom('https://www.fynliq.com/%3Cx%3E', '').landing, '/');
  assert.ok(JSON.stringify(arrivalFrom(`https://www.fynliq.com/?utm_campaign=${'z'.repeat(5000)}`, '')).length < 1500);
});
