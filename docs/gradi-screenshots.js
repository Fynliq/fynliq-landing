/**
 * Drives the Gradi walkthrough in a real browser and shoots it.
 *
 *   npm run build && npm run preview      # then, in another shell:
 *   SHOT_URL=http://localhost:4173 node docs/gradi-screenshots.js
 *
 * Like the other harnesses, a run that produces the screenshots is also a
 * passing smoke test. It fails loudly on a console error, on a horizontal
 * overflow at any checked width, and on the things this page exists for:
 *
 *   - the six steps being present, tappable, and counted,
 *   - a tick surviving a reload, because the student is switching to Gradi
 *     and back and the page is useless if it forgets,
 *   - the $5 fee appearing wherever the $10 does, never the payout alone,
 *   - both calls to action carrying rel="sponsored", because they are paid
 *     referral links and saying so is not optional,
 *   - /gradi reaching /gradi/start, so the walkthrough is not orphaned.
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

function fail(message) {
  console.error(`\n  FAILED: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function shoot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name);
}

/**
 * Put a section at the top of the viewport before shooting it. Without this
 * every screenshot is the hero, because the hero is what is on screen.
 */
async function scrollTo(page, heading) {
  await page.evaluate((text) => {
    const target = [...document.querySelectorAll('h2')].find((el) =>
      el.textContent.trim().startsWith(text),
    );
    if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, heading);
  await sleep(400);
}

/** No page in this product may scroll sideways at a phone width. */
async function assertNoSidewaysScroll(page, where) {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  if (overflows) fail(`the page scrolls sideways at ${where}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

try {
  const page = await browser.newPage();

  const errors = [];

  /*
   * `/api/*` is Vercel serverless, and `vite preview` serves static files, so
   * the account endpoints answer 404 here and would drown out anything real.
   * They are ignored by URL rather than by message text — a console error only
   * says "failed to load resource", never which one — and every other failed
   * request still fails the run.
   */
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    // A plain test, not `new URL()`: SHOT_URL is bound to `URL` in this file.
    if (url.startsWith(`${URL}/api/`)) return;
    errors.push(`${response.status()} ${url}`);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Already covered, with the URL, by the response listener above.
    if (message.text().startsWith('Failed to load resource')) return;
    errors.push(message.text());
  });

  page.on('pageerror', (error) => errors.push(String(error)));

  // ---- The walkthrough, at desktop width ------------------------------
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${URL}/gradi/start`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(600);

  const heading = await page.$eval('h1', (el) => el.textContent.trim());
  if (!/Make your first \$10/.test(heading)) fail(`the hero reads "${heading}"`);

  const body = await page.evaluate(() => document.body.innerText);
  for (const needed of ['$10', '$5', 'Your referral code', 'Your path to $10']) {
    if (!body.includes(needed)) fail(`"${needed}" is missing from the page`);
  }
  console.log('   the payout and the fee both appear');

  await shoot(page, 'gradi-start-01-hero');

  // ---- Six steps, counted ---------------------------------------------
  const stepCount = await page.$$eval('ol li button', (els) => els.length);
  if (stepCount !== 6) fail(`expected six steps, found ${stepCount}`);

  const readCount = () =>
    page.evaluate(() => {
      const match = document.body.innerText.match(/(\d) of (\d) done/);
      return match ? match[0] : null;
    });

  if ((await readCount()) !== '0 of 6 done') fail(`starts at "${await readCount()}"`);

  await page.evaluate(() => document.querySelectorAll('ol li button')[0].click());
  await sleep(300);
  if ((await readCount()) !== '1 of 6 done') fail(`after one tick: "${await readCount()}"`);

  const pressed = await page.$eval('ol li button', (el) => el.getAttribute('aria-pressed'));
  if (pressed !== 'true') fail('a ticked step does not report aria-pressed');
  console.log('   ticking a step counts it');

  // ---- and remembered across a reload ---------------------------------
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(600);
  if ((await readCount()) !== '1 of 6 done') fail('the tick did not survive a reload');
  console.log('   the tick survives a reload');

  await scrollTo(page, 'Your path to');
  await shoot(page, 'gradi-start-02-steps');

  // ---- The referral links say what they are ---------------------------
  const links = await page.$$eval('a[href*="gradi.app.link"]', (els) =>
    els.map((el) => ({ rel: el.getAttribute('rel') || '', text: el.textContent.trim() })),
  );
  if (links.length < 2) fail(`expected both calls to action, found ${links.length}`);
  for (const link of links) {
    if (!link.rel.includes('sponsored')) fail(`"${link.text}" is not marked sponsored`);
    if (!link.rel.includes('noopener')) fail(`"${link.text}" is missing noopener`);
  }
  console.log(`   ${links.length} referral links, all marked sponsored`);

  // ---- The questions open ---------------------------------------------
  await page.evaluate(() => document.querySelectorAll('details summary')[0].click());
  await sleep(300);
  const opened = await page.$$eval('details', (els) => els.filter((el) => el.open).length);
  if (opened !== 1) fail('the first question did not open');
  console.log('   the questions open');

  await scrollTo(page, 'Questions');
  await shoot(page, 'gradi-start-03-questions');
  await assertNoSidewaysScroll(page, '1440px');

  // ---- /gradi points at it --------------------------------------------
  await page.goto(`${URL}/gradi`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(400);
  const reachable = await page.$('a[href="/gradi/start"]');
  if (!reachable) fail('/gradi has no link to the walkthrough');
  console.log('   /gradi links to the walkthrough');

  // ---- On a phone ------------------------------------------------------
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.goto(`${URL}/gradi/start`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(600);
  await assertNoSidewaysScroll(page, '390px');
  await shoot(page, 'gradi-start-mobile');

  if (errors.length) fail(`console errors: ${errors.join(' | ')}`);

  console.log(
    '\nGradi walkthrough OK: six steps counted and remembered, the $5 fee stated beside the $10,\nboth referral links marked sponsored. No console errors, no sideways scroll.\n',
  );
} finally {
  await browser.close();
}
