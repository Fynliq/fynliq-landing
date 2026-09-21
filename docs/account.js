/**
 * Signing in, for the screenshot harnesses.
 *
 * The three tabbed pages are behind an account now, so a harness that drives
 * them has to get through the door first. That is the same six lines in every
 * script, which is why it lives here rather than three times over.
 *
 * It signs up rather than logs in, and with a fresh address each run, so a
 * harness never depends on a state left behind by the last one.
 */

/** Unique per run, so repeated runs never collide in the local store. */
export function freshEmail() {
  return `shots.${Date.now().toString(36)}@school.edu`;
}

export const PASSWORD = 'rainyTuesday7';

/**
 * Creates an account and waits until the app has let us through.
 *
 * Returns the address used, so a caller can put it in a screenshot caption
 * or assert on what the header shows.
 */
export async function signUp(page, url, { email = freshEmail(), password = PASSWORD } = {}) {
  await page.goto(`${url}/signup`, { waitUntil: 'networkidle2', timeout: 60_000 });

  /*
   * Pages in one browser share an origin's storage, so the second harness
   * page of a run arrives already logged in — and the app, correctly,
   * moves it along rather than showing it a sign-up form. That is a pass,
   * not a failure, so wait for whichever of the two happens and take it.
   */
  await page.waitForFunction(
    () =>
      document.querySelector('input[name="email"]') !== null ||
      !['/login', '/signup'].includes(window.location.pathname.replace(/\/+$/, '')),
    { timeout: 20_000 },
  );

  if (!(await page.$('input[name="email"]'))) return null;

  await page.type('input[name="email"]', email, { delay: 8 });
  await page.type('input[name="password"]', password, { delay: 8 });
  await page.type('input[name="confirmPassword"]', password, { delay: 8 });

  await page.click('button[type="submit"]');

  // The gate sends a new account to the upload page. Waiting on the route
  // rather than a timeout means a slow hash does not turn into a flaky run.
  await page.waitForFunction(
    () => !['/login', '/signup'].includes(window.location.pathname.replace(/\/+$/, '')),
    { timeout: 30_000 },
  );

  return email;
}
