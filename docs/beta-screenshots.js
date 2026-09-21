/**
 * Drives the beta flow end to end in a real browser and shoots it.
 *
 *   npm run build && npm run preview      # then, in another shell:
 *   SHOT_URL=http://localhost:4173 node docs/beta-screenshots.js
 *
 * It clicks through Join the beta → upload → analyse → results exactly as a
 * student would, so a run that produces the four screenshots is also a passing
 * smoke test of the whole flow. It fails loudly on a console error, on a
 * horizontal overflow at any of the checked widths, and on a step that never
 * arrives.
 *
 * Override the browser with CHROME_PATH if Chrome lives somewhere unusual.
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signUp } from './account.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'screenshots');
const TMP = path.join(HERE, '.tmp');

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

/** A 1x1 PNG. The stub reader does not look at the bytes; the flow does. */
function sampleFile() {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, 'aid-summary.png');
  fs.writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  return file;
}

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

/** Waits for the route to become `expected`, or fails saying what it got. */
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
});

fs.mkdirSync(OUT, { recursive: true });
const upload = sampleFile();

// ---------- desktop ----------
const page = await browser.newPage();
watch(page, 'desktop');
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
// 0. The flow is behind an account now, so get through the door first. The
//    account journey itself is covered by docs/auth-screenshots.js.
await signUp(page, URL);

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 });
await page.evaluate(() => document.fonts.ready);

// 1. Join the beta, from the navbar, as a student would. Already logged in,
//    so this goes straight through rather than by way of the log-in page.
await page.click('header a[href="/beta"]');
await expectRoute(page, '/beta', 'join');
await page.evaluate(() => document.fonts.ready);
await sleep(500);
await checkOverflow(page, 'upload');

// 2. Add a file through the real input the dropzone owns.
const input = await page.$('input[type="file"]');
if (!input) problems.push('[upload] no file input found');
else await input.uploadFile(upload);
await sleep(400);

const ready = await page.$eval('button[type="button"]:not(:disabled)', (el) => el.textContent);
if (!ready) problems.push('[upload] the submit button never enabled');

await page.screenshot({ path: path.join(OUT, 'beta-01-upload.png') });
console.log('beta-01-upload');

// 3. Analyse.
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.includes('Analyse my aid'),
  );
  if (!button) throw new Error('no Analyse button');
  button.click();
});
await sleep(1_400);
await checkOverflow(page, 'analysing');
await page.screenshot({ path: path.join(OUT, 'beta-02-analysing.png') });
console.log('beta-02-analysing');

// 4. The answer.
await expectRoute(page, '/beta/results', 'results');
await page.evaluate(() => document.fonts.ready);
await sleep(900);
await checkOverflow(page, 'results');

const answer = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => null);
if (!answer) problems.push('[results] no answer headline rendered');
else console.log(`   answer: ${answer}`);

await page.screenshot({ path: path.join(OUT, 'beta-03-answer.png') });
console.log('beta-03-answer');

await page.screenshot({ path: path.join(OUT, 'beta-04-results-full.png'), fullPage: true });
console.log('beta-04-results-full');

// 5. A reload of the results URL must not show a stale or empty answer.
await page.reload({ waitUntil: 'networkidle2' });
await expectRoute(page, '/beta', 'reload falls back to upload');

await page.close();

// ---------- mobile ----------
for (const width of [390, 768]) {
  const m = await browser.newPage();
  watch(m, `mobile ${width}`);
  await m.setViewport({ width, height: 844, deviceScaleFactor: width === 390 ? 3 : 2, isMobile: width === 390 });
  // A new page is a new browser context as far as the session store goes.
  await signUp(m, URL);
  await m.goto(`${URL}/beta`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await m.evaluate(() => document.fonts.ready);
  await sleep(400);
  await checkOverflow(m, `upload ${width}`);

  if (width === 390) {
    const mInput = await m.$('input[type="file"]');
    await mInput?.uploadFile(upload);
    await sleep(300);
    await m.screenshot({ path: path.join(OUT, 'beta-mobile-upload.png') });
    console.log('beta-mobile-upload');

    await m.evaluate(() => {
      [...document.querySelectorAll('button')]
        .find((b) => b.textContent.includes('Analyse my aid'))
        ?.click();
    });
    await m.waitForFunction(() => window.location.pathname.startsWith('/beta/results'), {
      timeout: 20_000,
    });
    await sleep(900);
    await checkOverflow(m, 'results 390');
    await m.screenshot({ path: path.join(OUT, 'beta-mobile-answer.png') });
    console.log('beta-mobile-answer');
  }

  await m.close();
}

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });

if (problems.length > 0) {
  console.error('\nFAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('\nFlow OK: join → upload → analyse → answer, no console errors, no sideways scroll.');
