/**
 * Focus after a change of page, checked in a real browser.
 *
 *   npm run dev                           # then, in another shell:
 *   SHOT_URL=http://localhost:5173 node test/navigation-focus.mjs
 *
 * Against the dev server, not `vite preview`: a production build sends
 * sign-up to /api/auth (src/auth/accounts.ts), which preview does not serve,
 * so it never gets past the gate. The dev server runs on the local store.
 *
 * The acceptance criteria are docs/navigation-accessibility-proposal.md §5.
 * Every client-side change of page must land focus on the new page's `<h1>`
 * once, on the page a redirect ends on, without moving the scroll position,
 * and nothing that is not a change of page may move focus at all. The focus
 * ring is also measured at four widths for clipping, and a screenshot of each
 * is left in docs/.tmp/focus for a person to look at.
 *
 * Uses puppeteer-core, already a dev dependency, and nothing else. Override
 * the browser with CHROME_PATH and the screenshot folder with FOCUS_SHOTS.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL = process.env.SHOT_URL || 'http://localhost:5173';
const SHOTS = process.env.FOCUS_SHOTS || path.join(HERE, '..', 'docs', '.tmp', 'focus');
const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

const PASSWORD = 'rainyTuesday7';
const freshEmail = () => `focus.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@school.edu`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const consoleProblems = [];
let passed = 0;
let failed = 0;

async function test(name, run) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
});

/** A signed-out tab of its own: each context has its own local accounts. */
async function freshPage({ width = 1280, height = 900, reducedMotion = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.starved = 0;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The dev server sends every module unbundled; now and then Chrome runs
    // out of request budget for them. That is the harness, not the app, and
    // `load` reloads the page when it happens.
    if (m.text().includes('ERR_INSUFFICIENT_RESOURCES')) {
      page.starved++;
      starvedLoads++;
      return;
    }
    consoleProblems.push(`console: ${m.text()} (${m.location()?.url ?? ''})`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
  return page;
}

let starvedLoads = 0;

/** A full page load, then a record of every element that takes focus. */
async function load(page, route) {
  for (let attempt = 1; ; attempt++) {
    const before = page.starved;
    await page.goto(URL + route, { waitUntil: 'networkidle2', timeout: 60_000 });
    if (page.starved === before) break;
    if (attempt === 3) throw new Error(`${route} would not load: Chrome kept running out of request budget`);
    await sleep(1_000);
  }
  await page.evaluate(() => document.fonts.ready);
  await arm(page);
}

async function arm(page) {
  await page.evaluate(() => {
    window.__focusLog = [];
    if (window.__focusArmed) return;
    window.__focusArmed = true;
    document.addEventListener('focusin', (e) =>
      window.__focusLog.push(`${e.target.tagName}:${(e.target.textContent || '').trim().slice(0, 40)}`),
    );
  });
}

const focusLog = (page) => page.evaluate(() => window.__focusLog.slice());

const state = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return {
      path: location.pathname,
      hash: location.hash,
      tag: a?.tagName ?? null,
      text: (a?.getAttribute('aria-label') || a?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      isPageHeading: a === document.querySelector('h1'),
      insideMain: !!a?.closest('main'),
      focusVisible: a?.matches(':focus-visible') ?? false,
      scrollY: Math.round(scrollY),
      historyLength: history.length,
    };
  });

async function waitPath(page, want) {
  try {
    await page.waitForFunction((w) => location.pathname.replace(/\/+$/, '') === w, { timeout: 15_000 }, want === '/' ? '' : want);
  } catch {
    throw new Error(`expected path ${want}, got ${await page.evaluate(() => location.pathname)}`);
  }
}

/** Waits for the page's `<h1>` to hold focus, and returns the state then. */
async function waitHeadingFocus(page) {
  try {
    await page.waitForFunction(() => document.activeElement === document.querySelector('h1'), { timeout: 8_000 });
  } catch {
    const s = await state(page);
    throw new Error(`focus never reached the <h1> on ${s.path}; it is on ${s.tag} "${s.text}"`);
  }
  await sleep(150); // let any second, wrong focus show itself
  return state(page);
}

async function tabUntil(page, selector, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return;
  }
  throw new Error(`Tab never reached ${selector}`);
}

async function nextTab(page) {
  await page.keyboard.press('Tab');
  return state(page);
}

/**
 * Follows an internal link the way the app's own links are followed: through
 * the router's delegated click listener. The link is added outside the React
 * tree, so it survives the change of page and focus is not lost by accident.
 *
 * Both ways are real input: Enter from the keyboard, or a real mouse click.
 * A scripted `a.click()` is neither, and Chrome would keep treating the last
 * real input as the current one when it decides whether to show the ring.
 */
async function follow(page, href, { keyboard = false } = {}) {
  await page.evaluate((href) => {
    document.getElementById('__follow')?.remove();
    const a = document.createElement('a');
    a.href = href;
    a.id = '__follow';
    a.textContent = 'follow';
    a.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;padding:4px;background:#fff';
    document.body.prepend(a);
  }, href);
  if (keyboard) {
    await page.focus('#__follow');
    await page.keyboard.press('Enter');
  } else {
    await page.click('#__follow');
  }
}

const dropFollow = (page) => page.evaluate(() => document.getElementById('__follow')?.remove());

async function signUpWithKeyboard(page) {
  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="email"]', freshEmail());
  await page.type('input[name="password"]', PASSWORD);
  await page.type('input[name="confirmPassword"]', PASSWORD);
  await page.keyboard.press('Enter');
}

async function signedInPage(options) {
  const page = await freshPage(options);
  await load(page, '/signup');
  await signUpWithKeyboard(page);
  await waitPath(page, '/beta');
  await waitHeadingFocus(page);
  return page;
}

const closePage = (page) => page.browserContext().close();

// ---------------------------------------------------------------- scenarios

async function gateWithKeyboard(options) {
  const page = await freshPage(options);
  await load(page, '/');
  const before = await page.evaluate(() => history.length);
  await tabUntil(page, 'a[href="/beta"]');
  await page.keyboard.press('Enter');
  await waitPath(page, '/login');
  const s = await waitHeadingFocus(page);
  assert.equal(s.text, 'Welcome back');
  assert.equal(s.focusVisible, true, 'the focus ring shows after a keyboard navigation');
  assert.equal(s.historyLength, before + 1, 'the gate replaces /beta rather than adding an entry');
  assert.equal(s.scrollY, 0);
  const headings = (await focusLog(page)).filter((f) => f.startsWith('H1'));
  assert.deepEqual(headings, ['H1:Welcome back'], 'one heading takes focus, on the page the gate lands on');
  const after = await nextTab(page);
  assert.equal(after.tag, 'INPUT', 'the next Tab is the first field of the form');
  await closePage(page);
}

async function signUpLandsOnUpload(options) {
  const page = await freshPage(options);
  await load(page, '/signup');
  await signUpWithKeyboard(page);
  await waitPath(page, '/beta');
  const s = await waitHeadingFocus(page);
  assert.equal(s.text, 'Upload your aid summary');
  const after = await nextTab(page);
  assert.equal(after.tag, 'BUTTON', `the next Tab is the dropzone, got ${after.tag} "${after.text}"`);
  assert.match(after.text, /Drop your aid summary/);
  await closePage(page);
}

async function backAndForward(options) {
  const page = await signedInPage(options);
  await load(page, '/');
  // Instant: a plain scrollTo glides too, and leaving mid-glide would save a
  // part-way offset for Back to restore.
  await page.evaluate(() => window.scrollTo({ top: 1500, behavior: 'instant' }));
  await page.waitForFunction(() => Math.round(scrollY) === 1500, { timeout: 4_000 });
  await follow(page, '/beta');
  await waitPath(page, '/beta');
  await waitHeadingFocus(page);
  // navigate()'s scroll to the top glides under `scroll-behavior: smooth`.
  // Pressing Back before it ends races the browser's restore, and on main
  // as well as here the glide often wins and the page ends at 0. That race
  // is not what this test is about, so let the glide finish first.
  await page.waitForFunction(() => scrollY === 0, { timeout: 4_000 });
  await sleep(200);
  await arm(page);

  await page.goBack();
  await waitPath(page, '/');
  await waitHeadingFocus(page);
  // `html { scroll-behavior: smooth }` makes the browser glide back to the
  // restored offset (on main too) unless reduced motion is on; wait it out.
  await page.waitForFunction(() => Math.abs(scrollY - 1500) <= 5, { timeout: 4_000 }).catch(() => {});
  const back = await state(page);
  assert.ok(Math.abs(back.scrollY - 1500) <= 5, `Back keeps the restored scroll position (got ${back.scrollY})`);
  assert.equal(back.isPageHeading, true, 'focus is still on the <h1> once the scroll has settled');

  await page.goForward();
  await waitPath(page, '/beta');
  const forward = await waitHeadingFocus(page);
  assert.equal(forward.text, 'Upload your aid summary');
  await closePage(page);
}

await test('1. gate, keyboard: / → /beta → /login focuses "Welcome back" once', () => gateWithKeyboard());

await test('2. /login → /signup moves focus off the reused switch link to the new <h1>', async () => {
  const page = await freshPage();
  await load(page, '/login');
  await tabUntil(page, 'a[href="/signup"]');
  await page.keyboard.press('Enter');
  await waitPath(page, '/signup');
  const s = await waitHeadingFocus(page);
  assert.equal(s.text, 'Create your account');
  await closePage(page);
});

await test('3. sign-up with Enter lands on the upload <h1>; next Tab is the dropzone', () => signUpLandsOnUpload());

await test('4. intended destination: stopped on /ask, signs up, lands on the /ask <h1>', async () => {
  const page = await freshPage();
  await load(page, '/');
  await follow(page, '/ask', { keyboard: true });
  await waitPath(page, '/login');
  await waitHeadingFocus(page);
  await dropFollow(page);
  await page.click('a[href="/signup"]');
  await waitPath(page, '/signup');
  await signUpWithKeyboard(page);
  await waitPath(page, '/ask');
  const s = await waitHeadingFocus(page);
  assert.equal(s.text, 'Make sense of your financial aid.');
  await closePage(page);
});

const signedIn = await signedInPage();

await test('5. Resuming: signed in, /login moves on to /beta without focusing the log-in page', async () => {
  await follow(signedIn, '/login');
  await waitPath(signedIn, '/beta');
  const s = await waitHeadingFocus(signedIn);
  assert.equal(s.text, 'Upload your aid summary');
  const headings = (await focusLog(signedIn)).filter((f) => f.startsWith('H1'));
  assert.ok(!headings.some((h) => h.includes('Welcome back')), `log-in heading took focus: ${headings}`);
  await dropFollow(signedIn);
});

await test('6. orphaned /beta/results redirects to /beta and focuses its <h1> once', async () => {
  await load(signedIn, '/search');
  await follow(signedIn, '/beta/results');
  await waitPath(signedIn, '/beta');
  const s = await waitHeadingFocus(signedIn);
  assert.equal(s.text, 'Upload your aid summary');
  const headings = (await focusLog(signedIn)).filter((f) => f.startsWith('H1'));
  assert.equal(headings.length, 1, `headings focused: ${headings}`);
  await dropFollow(signedIn);
});

await test('7. unknown /search/<slug> lands on the Search <h1>, never the landing <h1>', async () => {
  await load(signedIn, '/ask');
  await follow(signedIn, '/search/not-a-real-question');
  await waitPath(signedIn, '/search');
  const s = await waitHeadingFocus(signedIn);
  assert.match(s.text, /Someone has already asked/);
  const headings = (await focusLog(signedIn)).filter((f) => f.startsWith('H1'));
  assert.equal(headings.length, 1, `headings focused: ${headings}`);
  await dropFollow(signedIn);
});

await test('8 + 12. every page, by mouse: focus on its <h1>, no ring, outside-<main> headings found', async () => {
  // Test 7 leaves this tab on /search, so the loop starts somewhere else:
  // following a link to the page already on screen is not a change of page.
  const expected = {
    '/ask': { text: /Make sense of your financial aid/, insideMain: true },
    '/search': { text: /Someone has already asked/, insideMain: false },
    '/gradi': { text: /The cheapest money/, insideMain: false },
    '/gradi/start': { text: /Make your first/, insideMain: false },
    '/beta': { text: /Upload your aid summary/, insideMain: true },
    '/': { text: /Know what your aid actually leaves you/, insideMain: true },
  };
  for (const [route, want] of Object.entries(expected)) {
    await follow(signedIn, route);
    await waitPath(signedIn, route);
    const s = await waitHeadingFocus(signedIn);
    assert.match(s.text, want.text, route);
    assert.equal(s.insideMain, want.insideMain, `${route}: <h1> inside <main>`);
    assert.equal(s.focusVisible, false, `${route}: no ring after a mouse navigation`);
    assert.equal(s.scrollY, 0, `${route}: starts at the top`);
    await dropFollow(signedIn);
  }
});

await test('9. picking a search suggestion with the keyboard focuses the question <h1>', async () => {
  await load(signedIn, '/search');
  await signedIn.click('input[type="search"], input[role="combobox"]');
  await signedIn.keyboard.type('loan');
  await signedIn.waitForSelector('[role="option"]', { timeout: 5_000 });
  await signedIn.keyboard.press('ArrowDown');
  await signedIn.keyboard.press('Enter');
  await signedIn.waitForFunction(() => location.pathname.startsWith('/search/'), { timeout: 10_000 });
  const s = await waitHeadingFocus(signedIn);
  assert.doesNotMatch(s.text, /Someone has already asked/);
  assert.equal(s.focusVisible, true, 'keyboard navigation shows the ring');
});

await test('10. Back/Forward: focus on the <h1>, restored scroll kept, no history change', () => backAndForward());

await test('11a. analysing on /beta never moves focus; the results page then gets it', async () => {
  await load(signedIn, '/beta');
  const sample = path.join(SHOTS, 'aid-summary.png');
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(sample, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const input = await signedIn.$('input[type="file"]');
  await input.uploadFile(sample);
  await sleep(300);
  await signedIn.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Analyse my aid'));
    const consent = document.querySelector('input[type="checkbox"]');
    if (consent && !consent.checked) consent.click();
    button.focus();
  });
  await signedIn.keyboard.press('Enter');
  for (let i = 0; i < 6; i++) {
    await sleep(200);
    const s = await state(signedIn);
    if (s.path !== '/beta') break;
    assert.equal(s.isPageHeading, false, 'focus moved to the <h1> while analysing on the same page');
  }
  await waitPath(signedIn, '/beta/results');
  const s = await waitHeadingFocus(signedIn);
  assert.ok(s.text.length > 0, 'results <h1> has a name');
});

await test('11b. a log-in that fails validation still focuses the field, not the <h1>', async () => {
  const page = await freshPage();
  await load(page, '/login');
  await page.type('input[name="email"]', 'not-an-email');
  await page.type('input[name="password"]', 'wrongPassword9');
  await page.keyboard.press('Enter');
  await sleep(800);
  const s = await state(page);
  assert.equal(s.tag, 'INPUT', `focus is on ${s.tag} "${s.text}"`);
  assert.equal(s.path, '/login');
  await closePage(page);
});

await test('11c. a log-in the account store refuses does not move focus to the <h1>', async () => {
  // Focus ends on <body> here, on main as well as on this branch: the form's
  // own handling of a refused log-in, not a change of page. Only the part
  // the router is responsible for is asserted.
  const page = await freshPage();
  await load(page, '/login');
  await page.type('input[name="email"]', freshEmail());
  await page.type('input[name="password"]', 'wrongPassword9');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /do not match/.test(document.body.textContent), { timeout: 15_000 });
  await sleep(500);
  const s = await state(page);
  assert.equal(s.path, '/login');
  assert.equal(s.isPageHeading, false);
  await closePage(page);
});

await test('13. ctrl-click on an internal link leaves this tab and its focus alone', async () => {
  await load(signedIn, '/');
  const opened = new Promise((resolve) => signedIn.browserContext().once('targetcreated', resolve));
  await signedIn.keyboard.down('Control');
  await signedIn.click('header a[href="/beta"]');
  await signedIn.keyboard.up('Control');
  const target = await Promise.race([opened, sleep(3_000).then(() => null)]);
  const tab = target && (await target.page());
  if (tab) await tab.close();
  await sleep(300);
  const s = await state(signedIn);
  assert.equal(s.path, '/');
  assert.equal(s.isPageHeading, false);
});

await test('14. in-page #clarity anchor keeps native behaviour; the router does not take focus', async () => {
  await load(signedIn, '/');
  // The navbar's copy of this link is hidden at narrow widths; use a visible one.
  await signedIn.evaluate(() =>
    [...document.querySelectorAll('a[href="#clarity"]')].find((a) => a.offsetParent).focus(),
  );
  await signedIn.keyboard.press('Enter');
  await sleep(800);
  const s = await state(signedIn);
  assert.equal(s.path, '/');
  assert.equal(s.hash, '#clarity');
  // Where focus goes from here is Chrome's own fragment navigation (it ends
  // on <body>, on main too); the router's part is to stay out of it.
  assert.equal(s.isPageHeading, false);
  // Back across a fragment is a popstate with no change of page.
  await signedIn.goBack();
  await sleep(500);
  assert.equal((await state(signedIn)).isPageHeading, false, 'Back across a fragment must not move focus');
});

await test('15. reduced motion: gate, sign-up and Back/Forward behave the same', async () => {
  await gateWithKeyboard({ reducedMotion: true });
  await signUpLandsOnUpload({ reducedMotion: true });
  await backAndForward({ reducedMotion: true });
});

await closePage(signedIn);

// ------------------------------------------------- 17. ring clipping, widths

/**
 * Where the ring would be cut off: by an ancestor that clips its overflow,
 * by the viewport's sides, or by something fixed painted on top of it.
 */
const measureRing = (page) =>
  page.evaluate(() => {
    const h1 = document.activeElement;
    const cs = getComputedStyle(h1);
    const grow = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth);
    const r = h1.getBoundingClientRect();
    const ring = { top: r.top - grow, left: r.left - grow, right: r.right + grow, bottom: r.bottom + grow };
    const problems = [];

    for (let el = h1.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const s = getComputedStyle(el);
      const clipsX = s.overflowX !== 'visible';
      const clipsY = s.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      const b = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
      if (clipsX && ring.left < b.left - 0.5) problems.push(`left edge clipped by ${name}`);
      if (clipsX && ring.right > b.right + 0.5) problems.push(`right edge clipped by ${name}`);
      if (clipsY && ring.top < b.top - 0.5) problems.push(`top edge clipped by ${name}`);
      if (clipsY && ring.bottom > b.bottom + 0.5) problems.push(`bottom edge clipped by ${name}`);
    }
    if (ring.left < 0) problems.push('left edge off-screen');
    if (ring.right > innerWidth) problems.push('right edge off-screen');

    // Something painted over the ring's top edge, such as a fixed header.
    const y = ring.top + 1;
    if (y > 0) {
      for (const x of [ring.left + 8, (ring.left + ring.right) / 2, ring.right - 8]) {
        // Only something pinned over the page counts; the heading's own
        // wrapper (AskFynliq's <header>, for one) is underneath the ring.
        let cover = document.elementFromPoint(x, y);
        while (cover && !['fixed', 'sticky'].includes(getComputedStyle(cover).position)) cover = cover.parentElement;
        if (cover && !cover.contains(h1)) {
          problems.push(`top edge covered by ${cover.tagName.toLowerCase()}.${[...cover.classList].join('.')}`);
          break;
        }
      }
    }

    return {
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`,
      problems,
    };
  });

await test('17. focus ring is not clipped on any page heading at 320, 390, 768 and 1440px', async () => {
  const report = [];

  async function check(page, width, route) {
    await waitPath(page, route);
    const s = await waitHeadingFocus(page);
    assert.equal(s.focusVisible, true, `${route} @${width}: ring shows after a keyboard navigation`);
    await dropFollow(page);
    const ring = await measureRing(page);
    const file = `${width}${route === '/' ? '_home' : route.replace(/\//g, '_')}.png`;
    // The hero's words animate in on every arrival; shoot the settled page.
    await page
      .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), { timeout: 4_000 })
      .catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, file) });
    if (ring.problems.length) report.push(`${route} @${width}px: ${ring.problems.join('; ')} [${file}]`);
  }

  // One full load per width, then client-side only: the dev server serves
  // every module unbundled, and a reload per route exhausts Chrome's request
  // budget (net::ERR_INSUFFICIENT_RESOURCES) long before the run ends.
  for (const width of [320, 390, 768, 1440]) {
    const page = await freshPage({ width, height: width < 600 ? 844 : 900 });
    await load(page, '/');
    // Signed out first, for the two account pages.
    for (const route of ['/login', '/signup']) {
      await follow(page, route, { keyboard: true });
      await check(page, width, route);
    }
    await signUpWithKeyboard(page);
    await check(page, width, '/beta');
    for (const route of ['/search', '/ask', '/gradi', '/gradi/start', '/']) {
      await follow(page, route, { keyboard: true });
      await check(page, width, route);
    }
    await closePage(page);
  }
  assert.deepEqual(report, [], `clipped rings:\n${report.join('\n')}`);
});

await test('16. no page errors and no console errors other than missing /api endpoints', async () => {
  // The dev server serves no /api routes, so billing and similar calls 404.
  // The app treats that as "behave as before"; it is not a focus problem.
  const unexpected = consoleProblems.filter((p) => !/Failed to load resource: the server responded with a status of 404/.test(p));
  assert.deepEqual(unexpected, []);
});

await browser.close();

const missing = consoleProblems.length - consoleProblems.filter((p) => !/status of 404/.test(p)).length;
console.log(`\n${passed} passed, ${failed} failed${missing ? ` (${missing} expected 404s from missing /api routes)` : ''}`);
if (starvedLoads) console.log(`Chrome ran out of request budget ${starvedLoads} time(s); those loads were retried.`);
console.log(`Screenshots of every focused heading: ${SHOTS}`);
process.exitCode = failed ? 1 : 0;
