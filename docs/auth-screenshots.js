/**
 * Drives the account end to end in a real browser and shoots it.
 *
 *   npm run build && npm run preview      # then, in another shell:
 *   SHOT_URL=http://localhost:4173 node docs/auth-screenshots.js
 *
 * It walks the journey the client described — press Join the beta, land on
 * the log-in page, create an account, arrive at the upload page, and reach
 * the other two tabs — clicking what a student would click, so a run that
 * produces the screenshots is also a passing smoke test.
 *
 * It fails loudly on a console error, on a horizontal overflow at any checked
 * width, on a route that never arrives, and on the four behaviours this
 * feature exists for:
 *
 *   - Join the beta reaching the log-in page rather than the upload page,
 *   - a new account landing on upload, with search and ask open behind it,
 *   - logging out closing all three again,
 *   - a wrong password being refused, in the same words as an unknown one.
 *
 * Override the browser with CHROME_PATH if Chrome lives somewhere unusual.
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PASSWORD, freshEmail } from './account.js';

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

const here = (page) => page.evaluate(() => window.location.pathname.replace(/\/+$/, '') || '/');

async function expectRoute(page, expected, label) {
  try {
    await page.waitForFunction(
      (want) => (window.location.pathname.replace(/\/+$/, '') || '/') === want,
      { timeout: 15_000 },
      expected,
    );
  } catch {
    problems.push(`[${label}] expected ${expected}, got ${await here(page)}`);
  }
}

async function fill(page, name, value) {
  await page.click(`input[name="${name}"]`);
  await page.type(`input[name="${name}"]`, value, { delay: 10 });
}

/** Triple-click does not reliably select inside a password field. */
async function clear(page, name) {
  await page.click(`input[name="${name}"]`);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
}

/** The visible error the form is showing, or null. */
const stated = (page) =>
  page.evaluate(() => {
    const live = document.querySelector('[aria-live="polite"] p');
    return live ? live.textContent.replace(/^⚠\s*/, '').trim() : null;
  });

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

// ---- 1. Join the beta must reach the log-in page, not the upload page. ----
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 });
await page.evaluate(() => document.fonts.ready);

const joined = await page.evaluate(() => {
  const cta = [...document.querySelectorAll('a[href="/beta"]')].find((a) =>
    /join|start|upload|my aid/i.test(a.textContent),
  );
  if (!cta) return false;
  cta.click();
  return true;
});

if (!joined) problems.push('[landing] found no "Join the beta" link to press');
await expectRoute(page, '/login', 'join the beta');
await page.evaluate(() => document.fonts.ready);
await sleep(500);

await checkOverflow(page, 'login');
await page.screenshot({ path: path.join(OUT, 'auth-01-login.png') });
console.log('auth-01-login');

// The gate must say where it was taking them.
const destination = await page.$eval('main', (el) => el.textContent).catch(() => '');
if (!/uploading your aid summary/i.test(destination)) {
  problems.push('[login] the page does not say where the student was heading');
}

// ---- 2. A wrong password is refused, in the words of an unknown one. ----
await fill(page, 'email', 'nobody@school.edu');
await fill(page, 'password', 'whateverItWas9');
await page.click('button[type="submit"]');
await page.waitForFunction(() => document.querySelector('[aria-live="polite"] p'), {
  timeout: 20_000,
});

const refusal = await stated(page);
if (!refusal) problems.push('[login] a wrong password produced no message');
else if (/no account|not registered|unknown email/i.test(refusal)) {
  problems.push(`[login] the refusal says which half was wrong: ${refusal}`);
} else console.log(`   refused: ${refusal}`);

await page.screenshot({ path: path.join(OUT, 'auth-02-refused.png') });
console.log('auth-02-refused');

// ---- 3. Create an account. ----
await page.click('a[href="/signup"]');
await expectRoute(page, '/signup', 'switch to signup');
await sleep(400);

// The refused log-in password must not follow them into the new account.
const carried = await page.$eval('input[name="password"]', (el) => el.value);
if (carried !== '') problems.push(`[signup] the log-in password carried over: "${carried}"`);

// The address is carried over on purpose, so replace it rather than
// typing a second one on the end of it.
const email = freshEmail();
await clear(page, 'email');
await fill(page, 'email', email);
await fill(page, 'password', 'short');
await sleep(250);

// The rules tick as they are met; with "short" only one of the three is.
// Scoped to the form: the panel beside it is a list of three things too.
const met = await page.$$eval('form ul li', (items) =>
  items.filter((li) => li.textContent.includes('✓')).length,
);
if (met !== 1) problems.push(`[signup] expected 1 rule met for "short", got ${met}`);

await page.screenshot({ path: path.join(OUT, 'auth-03-signup.png') });
console.log('auth-03-signup');

await clear(page, 'password');
await fill(page, 'password', PASSWORD);
await fill(page, 'confirmPassword', PASSWORD);
await sleep(250);
await page.screenshot({ path: path.join(OUT, 'auth-04-ready.png'), fullPage: true });
console.log('auth-04-ready');

await page.click('button[type="submit"]');

// ---- 4. Signing up lands on upload, with the other two tabs open. ----
await expectRoute(page, '/beta', 'after signup');
await page.evaluate(() => document.fonts.ready);
await sleep(700);

await checkOverflow(page, 'upload after signup');

const header = await page.$eval('header', (el) => el.textContent);
if (!header.includes(email)) {
  problems.push('[upload] the header does not show who is logged in');
}
if (!/log out/i.test(header)) problems.push('[upload] there is no way to log out');

await page.screenshot({ path: path.join(OUT, 'auth-05-upload.png') });
console.log('auth-05-upload');

for (const [route, label] of [
  ['/search', 'Search'],
  ['/ask', 'Ask Fynliq'],
]) {
  await page.goto(`${URL}${route}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await sleep(600);
  await expectRoute(page, route, `${label} while logged in`);
  await checkOverflow(page, `${label} while logged in`);
}
console.log('   search and ask both open');

// ---- 5. Reloading keeps the session. ----
await page.goto(`${URL}/beta`, { waitUntil: 'networkidle2', timeout: 60_000 });
await sleep(600);
await expectRoute(page, '/beta', 'after a reload');

// ---- 6. Logging out closes all three again. ----
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /log out/i.test(b.textContent))?.click();
});
await sleep(500);

for (const route of ['/beta', '/search', '/ask']) {
  await page.goto(`${URL}${route}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await sleep(500);
  const landed = await here(page);
  if (landed !== '/login') problems.push(`[logged out] ${route} let us in, landing on ${landed}`);
}
console.log('   logged out: all three closed again');

// The landing page stays public. A marketing page behind a login is a page
// nobody reads, and this is the one that explains why to sign up at all.
for (const route of ['/', '/gradi']) {
  await page.goto(`${URL}${route}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await sleep(400);
  const landed = await here(page);
  if (landed !== route) problems.push(`[public] ${route} was gated, landing on ${landed}`);
}
console.log('   landing and gradi still public');

await page.close();

// ---------- mobile ----------
for (const width of [390, 360]) {
  const m = await browser.newPage();
  watch(m, `mobile ${width}`);
  await m.setViewport({
    width,
    height: 844,
    deviceScaleFactor: width === 390 ? 3 : 2,
    isMobile: width === 390,
  });

  for (const route of ['/login', '/signup']) {
    await m.goto(`${URL}${route}`, { waitUntil: 'networkidle2', timeout: 60_000 });
    await m.evaluate(() => document.fonts.ready);
    await sleep(500);
    await checkOverflow(m, `${route} at ${width}`);
  }

  if (width === 390) {
    await m.goto(`${URL}/login`, { waitUntil: 'networkidle2' });
    await sleep(500);
    await m.screenshot({ path: path.join(OUT, 'auth-mobile-01-login.png') });
    console.log('auth-mobile-01-login');

    await m.goto(`${URL}/signup`, { waitUntil: 'networkidle2' });
    await sleep(500);
    await m.screenshot({ path: path.join(OUT, 'auth-mobile-02-signup.png'), fullPage: true });
    console.log('auth-mobile-02-signup');

    // The header has to carry the logo, the way back and the way out at 390.
    await m.goto(`${URL}/signup`, { waitUntil: 'networkidle2' });
    await m.waitForSelector('input[name="email"]');
    await m.type('input[name="email"]', freshEmail(), { delay: 6 });
    await m.type('input[name="password"]', PASSWORD, { delay: 6 });
    await m.type('input[name="confirmPassword"]', PASSWORD, { delay: 6 });
    await m.click('button[type="submit"]');
    await expectRoute(m, '/beta', 'mobile signup');
    await sleep(600);
    await checkOverflow(m, 'upload header at 390');
    await m.screenshot({ path: path.join(OUT, 'auth-mobile-03-header.png') });
    console.log('auth-mobile-03-header');
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
  '\nAccount OK: join the beta → log in → sign up → upload, search and ask; log out closes them again. No console errors, no sideways scroll.',
);
