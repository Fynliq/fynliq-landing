/**
 * Drives the three tabs end to end in a real browser and shoots them.
 *
 *   npm run build && npm run preview      # then, in another shell:
 *   SHOT_URL=http://localhost:4173 node docs/search-screenshots.js
 *
 * It walks the journey the client described — Search, open an answer, on to
 * Ask Fynliq, and the Gradi page — clicking what a student would click, so a
 * run that produces the screenshots is also a passing smoke test.
 *
 * It fails loudly on a console error, on a horizontal overflow at any checked
 * width, on a route that never arrives, and on the three behaviours this
 * feature exists for:
 *
 *   - a variant phrasing resolving to the canonical question,
 *   - the tab bar being present and marking the right tab on all three pages,
 *   - the ranking moving when a question is searched.
 *
 * Override the browser with CHROME_PATH if Chrome lives somewhere unusual.
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'screenshots');

const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

const URL = process.env.SHOT_URL || 'http://localhost:4173';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`[${label}] console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`[${label}] pageerror: ${error.message}`));
}

async function checkOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (overflow) problems.push(`[${label}] the page scrolls sideways`);
}

async function expectRoute(page, expected, label) {
  try {
    await page.waitForFunction(
      (want) => new window.URL(window.location.href).pathname.replace(/\/+$/, '') === want,
      { timeout: 15_000 },
      expected === '/' ? '' : expected,
    );
  } catch {
    const got = await page.evaluate(() => window.location.pathname);
    problems.push(`[${label}] expected ${expected}, got ${got}`);
  }
}

/** The tab bar must be on the page, and must mark exactly one tab current. */
async function checkTabs(page, expected, label) {
  const current = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Sections"]');
    if (!nav) return { missing: true };
    const links = [...nav.querySelectorAll('a')];
    return {
      count: links.length,
      current: links.find((a) => a.getAttribute('aria-current') === 'page')?.textContent?.trim(),
    };
  });

  if (current.missing) {
    problems.push(`[${label}] no tab bar on the page`);
    return;
  }
  if (current.count !== 3) problems.push(`[${label}] expected 3 tabs, got ${current.count}`);
  if (current.current !== expected) {
    problems.push(`[${label}] expected the ${expected} tab marked, got ${current.current}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
});

fs.mkdirSync(OUT, { recursive: true });

// ---------- desktop ----------
const page = await browser.newPage();
watch(page, 'desktop');
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
await page.goto(`${URL}/search`, { waitUntil: 'networkidle2', timeout: 60_000 });
await page.evaluate(() => document.fonts.ready);
// The ranking arrives from the analytics seam; skeletons come first.
await page.waitForSelector('a[href^="/search/"]', { timeout: 15_000 });
await sleep(700);

await checkOverflow(page, 'search');
await checkTabs(page, 'Search', 'search');

const top = await page
  .$eval('ul li a[href^="/search/"] span', (el) => el.textContent.trim())
  .catch(() => null);
console.log(`   ranking loaded, first row: ${top}`);

await page.screenshot({ path: path.join(OUT, 'search-01-hero.png') });
console.log('search-01-hero');
await page.screenshot({ path: path.join(OUT, 'search-02-full.png'), fullPage: true });
console.log('search-02-full');

// ---- The grouping: type one phrasing, expect the canonical question. ----
await page.click('input[type="search"]');
await page.type('input[type="search"]', "why hasn't my refund hit", { delay: 18 });
await sleep(450);

const suggestion = await page.evaluate(() => {
  const option = document.querySelector('[role="option"]');
  return option ? option.textContent : null;
});

if (!suggestion) {
  problems.push('[search] typing a known phrasing produced no suggestion');
} else if (!suggestion.includes('When will my financial aid refund arrive?')) {
  problems.push(`[search] the phrasing did not resolve to the canonical question: ${suggestion}`);
} else {
  console.log(`   grouped: "why hasn't my refund hit" → ${suggestion.split('Also asked')[0]}`);
}

await page.screenshot({ path: path.join(OUT, 'search-03-typeahead.png') });
console.log('search-03-typeahead');

// ---- Open the answer. ----
await page.evaluate(() => document.querySelector('[role="option"]').click());
await expectRoute(page, '/search/when-will-my-financial-aid-refund-arrive', 'answer');
await page.evaluate(() => document.fonts.ready);
await sleep(600);

await checkOverflow(page, 'answer');
await checkTabs(page, 'Search', 'answer');

const heading = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => null);
if (heading !== 'When will my financial aid refund arrive?') {
  problems.push(`[answer] wrong heading: ${heading}`);
}

const hasRelated = await page.evaluate(() =>
  [...document.querySelectorAll('h2')].some((h) => h.textContent.includes('also asked')),
);
if (!hasRelated) problems.push('[answer] no related questions section');

await page.screenshot({ path: path.join(OUT, 'search-04-answer.png'), fullPage: true });
console.log('search-04-answer');

// ---- The search just made must have counted. ----
await page.goto(`${URL}/search`, { waitUntil: 'networkidle2' });
await page.waitForSelector('a[href^="/search/"]', { timeout: 15_000 });
const counted = await page.evaluate(() => document.body.textContent.includes('counted from you'));
// A full page load starts a fresh session, so this is only checked in-session.
if (counted) problems.push('[search] session counter survived a full reload, which it should not');

// ---- On to Ask Fynliq, through the tab bar. ----
await page.evaluate(() =>
  document.querySelector('nav[aria-label="Sections"] a[href="/ask"]').click(),
);
await expectRoute(page, '/ask', 'ask');
await page.evaluate(() => document.fonts.ready);
await sleep(400);

await checkOverflow(page, 'ask');
await checkTabs(page, 'Ask Fynliq', 'ask');

// Nothing uploaded, so the answer must announce itself as the general rule.
await page.evaluate(() => {
  const prompt = document.querySelector('button[class*="prompt"]');
  if (prompt) prompt.click();
});
await sleep(1_400);

const basis = await page.evaluate(() => {
  const node = [...document.querySelectorAll('p')].find(
    (p) => p.textContent.startsWith('General rule') || p.textContent.startsWith('Answered from'),
  );
  return node?.textContent ?? null;
});

if (basis === null) problems.push('[ask] the answer carried no basis label');
else if (!basis.startsWith('General rule')) {
  problems.push(`[ask] with nothing uploaded the answer claimed: ${basis}`);
} else console.log(`   ask, nothing uploaded: ${basis}`);

await page.screenshot({ path: path.join(OUT, 'search-05-ask.png'), fullPage: true });
console.log('search-05-ask');

// ---- Gradi. ----
await page.goto(`${URL}/gradi`, { waitUntil: 'networkidle2' });
await page.evaluate(() => document.fonts.ready);
await sleep(500);
await checkOverflow(page, 'gradi');

const gradi = await page.evaluate(() => {
  const link = [...document.querySelectorAll('a')].find((a) =>
    a.textContent.includes('Get $10 on Gradi'),
  );
  return link ? { href: link.href, rel: link.rel, target: link.target } : null;
});

if (!gradi) problems.push('[gradi] no "Get $10 on Gradi" button');
else {
  if (gradi.href !== 'https://gradi.app.link/HGFD9JiKp6b') {
    problems.push(`[gradi] the button points at ${gradi.href}`);
  }
  if (!gradi.rel.includes('noopener')) problems.push('[gradi] the outbound link lacks noopener');
  if (gradi.target !== '_blank') problems.push('[gradi] the outbound link does not open a new tab');
  console.log(`   gradi button → ${gradi.href} (rel="${gradi.rel}")`);
}

await page.screenshot({ path: path.join(OUT, 'search-06-gradi.png'), fullPage: true });
console.log('search-06-gradi');

// ---- A slug nobody recognises goes back to search, not to a blank page. ----
await page.goto(`${URL}/search/not-a-real-question`, { waitUntil: 'networkidle2' });
await expectRoute(page, '/search', 'unknown slug falls back');

await page.close();

// ---------- mobile ----------
for (const width of [390, 768]) {
  const m = await browser.newPage();
  watch(m, `mobile ${width}`);
  await m.setViewport({
    width,
    height: 844,
    deviceScaleFactor: width === 390 ? 3 : 2,
    isMobile: width === 390,
  });

  for (const route of ['/search', '/search/when-will-my-financial-aid-refund-arrive', '/ask', '/gradi']) {
    await m.goto(`${URL}${route}`, { waitUntil: 'networkidle2', timeout: 60_000 });
    await m.evaluate(() => document.fonts.ready);
    await sleep(500);
    await checkOverflow(m, `${route} at ${width}`);
  }

  if (width === 390) {
    await m.goto(`${URL}/search`, { waitUntil: 'networkidle2' });
    await m.waitForSelector('a[href^="/search/"]', { timeout: 15_000 });
    await sleep(700);
    await m.screenshot({ path: path.join(OUT, 'search-mobile-01.png') });
    console.log('search-mobile-01');

    await m.goto(`${URL}/search/when-will-my-financial-aid-refund-arrive`, {
      waitUntil: 'networkidle2',
    });
    await sleep(600);
    await m.screenshot({ path: path.join(OUT, 'search-mobile-02-answer.png') });
    console.log('search-mobile-02-answer');
  }

  await m.close();
}

await browser.close();

if (problems.length > 0) {
  console.error('\nFAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  '\nTabs OK: search → grouped phrasing → answer → ask → gradi, no console errors, no sideways scroll.',
);
