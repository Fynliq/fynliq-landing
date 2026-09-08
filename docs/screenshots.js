/**
 * Regenerates the README screenshots from a running Fynliq landing page.
 *
 *   npm i -D puppeteer-core          # drives an already-installed Chrome
 *   node docs/screenshots.js         # shoots the live site
 *   SHOT_URL=http://localhost:5173 node docs/screenshots.js
 *
 * Override the browser with CHROME_PATH if Chrome lives somewhere unusual.
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

const URL = process.env.SHOT_URL || 'https://fynliq-landing.vercel.app';
const OUT = path.join(HERE, 'screenshots');

const SECTIONS = ['clarity', 'aid', 'loan', 'get-more', 'tasks', 'ask'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Walk the whole page so every IntersectionObserver-driven reveal fires, then
// return to the top and let things settle. Without this, sections below the
// fold screenshot in their pre-reveal (invisible) state.
async function primeReveals(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await wait(120);
    }
    window.scrollTo(0, document.body.scrollHeight);
    await wait(400);
    window.scrollTo(0, 0);
    await wait(400);
  });
  await sleep(800);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
});

fs.mkdirSync(OUT, { recursive: true });

// ---------- desktop ----------
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await primeReveals(page);

await page.screenshot({ path: path.join(OUT, '01-hero.png') });
console.log('01-hero');

let n = 1;
for (const id of SECTIONS) {
  const el = await page.$(`#${id}`);
  if (!el) {
    console.log(`SKIP #${id} (not found)`);
    continue;
  }
  // Anchor navigation is useless here: React mounts after the fragment is
  // resolved, so the browser never finds the target. Scroll by hand instead.
  await page.evaluate((sel) => {
    const e = document.querySelector(sel);
    window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 60);
  }, `#${id}`);
  await sleep(900);
  n += 1;
  const name = `${String(n).padStart(2, '0')}-${id}`;
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name);
}
await page.close();

// ---------- mobile ----------
const m = await browser.newPage();
await m.setViewport({
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await m.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await m.evaluate(() => document.fonts.ready);
await primeReveals(m);
await m.screenshot({ path: path.join(OUT, 'mobile-hero.png') });
console.log('mobile-hero');

await browser.close();
