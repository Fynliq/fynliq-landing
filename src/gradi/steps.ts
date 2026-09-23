import { GRADI_CODE, GRADI_FEE } from './offer';

/**
 * The six things a student has to do before Gradi pays them.
 *
 * Written as a checklist rather than prose because it is one: six discrete
 * acts, in order, in somebody else's app, with a payout at the end. A student
 * doing this is switching between two apps and will lose their place, so the
 * page remembers which steps they have ticked.
 */
export interface GradiStep {
  readonly title: string;
  readonly body: string;
}

export const GRADI_STEPS: readonly GradiStep[] = [
  {
    title: 'Copy your code',
    body: `${GRADI_CODE}. Enter it when Gradi asks for a referral.`,
  },
  {
    title: `Open Gradi and pay the ${GRADI_FEE} creator fee`,
    body: 'The button opens the app, or the App Store if you don\u2019t have it. The fee is what makes you a creator.',
  },
  {
    title: 'Apply as a sole proprietor',
    body: 'Pick \u201Csole proprietor\u201D when Gradi asks how you\u2019re applying.',
  },
  {
    title: 'Sign in as a creator/marketer',
    body: 'Choose the creator/marketer login, not the regular one.',
  },
  {
    title: 'Add a profile pic and post 3 photos',
    body: 'A profile photo of yourself, then three photos to your profile.',
  },
  {
    title: 'Reach 10 likes total',
    body: '10 likes combined across your three photos. Share them with friends to get there faster.',
  },
];

export const TOTAL_STEPS = GRADI_STEPS.length;

/** Where the ticks are kept. Per browser, never sent anywhere. */
export const STORAGE_KEY = 'fynliq.gradi.steps';

/**
 * Read a stored set of ticked steps out of whatever is actually in storage.
 *
 * Storage is shared with the rest of the origin, survives deploys, and is
 * editable by hand, so the stored value is treated as hostile: anything that
 * is not a number inside the current range is dropped rather than trusted.
 * A checklist that throws on a stale key would take the whole page with it,
 * and the page is the only route to the money.
 */
export function parseProgress(raw: string | null): ReadonlySet<number> {
  if (raw === null) return new Set();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }

  if (!Array.isArray(parsed)) return new Set();

  const done = new Set<number>();
  for (const entry of parsed) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) continue;
    if (entry < 0 || entry >= TOTAL_STEPS) continue;
    done.add(entry);
  }
  return done;
}

/** The stored form: sorted, so a written value is stable to diff and eyeball. */
export function serialiseProgress(done: ReadonlySet<number>): string {
  return JSON.stringify([...done].sort((a, b) => a - b));
}

/** Tick or untick one step, returning a new set rather than mutating. */
export function toggleStep(done: ReadonlySet<number>, index: number): ReadonlySet<number> {
  const next = new Set(done);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/** How full the bar is, 0 to 100, rounded to a whole percent. */
export function progressPercent(done: ReadonlySet<number>): number {
  if (TOTAL_STEPS === 0) return 0;
  return Math.round((done.size / TOTAL_STEPS) * 100);
}

/** Read the ticks, tolerating a browser that refuses storage entirely. */
export function readProgress(): ReadonlySet<number> {
  try {
    return parseProgress(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Set();
  }
}

/** Write the ticks. A refusal is not worth telling the student about. */
export function writeProgress(done: ReadonlySet<number>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serialiseProgress(done));
  } catch {
    /* Private windows and blocked storage: the page works, it just forgets. */
  }
}
