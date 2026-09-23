import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/nav/AppShell/AppShell';
import { GRADI_CODE, GRADI_FEE, GRADI_LINK, GRADI_PAYOUT } from '../gradi/offer';
import {
  GRADI_STEPS,
  TOTAL_STEPS,
  progressPercent,
  readProgress,
  toggleStep,
  writeProgress,
} from '../gradi/steps';
import styles from './GradiStart.module.css';

/**
 * The walkthrough to the $10.
 *
 * `/gradi` makes the argument — that the cheapest money is the money you did
 * not borrow, made about income instead of aid. This page assumes the student
 * has already agreed with it and is now trying to actually do the thing, in
 * somebody else's app, switching back and forth and losing their place. So it
 * is a checklist rather than an essay, it remembers which steps are ticked,
 * and the code they have to type sits at the top where it can be copied.
 *
 * Three things are load-bearing and easy to erode in a redesign.
 *
 * The $10 and the $5 always appear together. A page that leads with a payout
 * and buries the fee is the kind of page this product exists to argue
 * against, so the fee is in the hero, in step two, in the questions and in
 * the terms — and the terms say plainly that the $5 is gone whether or not
 * the likes ever arrive.
 *
 * There is still no earnings figure. The $10 is a fixed sum on a referral
 * link, not a guess at what a creator makes, and nothing here turns it into
 * a rate.
 *
 * And the referral relationship is answered in the student's own words —
 * "Does Fynliq get anything?" — rather than disclosed in small print.
 */

const QUESTIONS: readonly { q: string; a: string }[] = [
  {
    q: 'When do I get paid?',
    a: `Gradi pays the ${GRADI_PAYOUT} once your three photos reach ten likes between them. It lands in your Gradi account, on Gradi’s schedule. Fynliq cannot see it, speed it up, or chase it for you.`,
  },
  {
    q: `Why is there a ${GRADI_FEE} fee?`,
    a: `Gradi charges it once, and paying it is what makes you a creator rather than an ordinary user. Worth being clear about the order: you are ${GRADI_FEE} down from the moment you join, and if your photos never reach ten likes, that ${GRADI_FEE} does not come back.`,
  },
  {
    q: 'The button didn’t do anything',
    a: 'It opens the Gradi app if you have it, and the App Store if you don’t. If neither happened, your browser probably blocked the jump — copy the code above, search for Gradi in your app store, and enter the code when it asks for a referral.',
  },
  {
    q: 'Gradi didn’t fill in my code',
    a: `Type ${GRADI_CODE} in yourself when Gradi asks for a referral. Coming through from here usually carries it across, but not always, and without it the ${GRADI_PAYOUT} has nothing to attach to.`,
  },
  {
    q: 'Does Fynliq get anything?',
    a: 'Yes. This is a referral link, and Fynliq is credited when you join. That is why the page exists, and it is why you are reading it here rather than in the footer. Your place in the beta, and everything Fynliq tells you about your own aid, is identical whether you sign up or ignore this entirely.',
  },
];

type IconName = 'clock' | 'lock' | 'check';

const REASONS: readonly { title: string; body: string; icon: IconName }[] = [
  {
    icon: 'clock',
    title: 'Aid is slow.',
    body: `Refunds can take weeks after the semester starts. ${GRADI_PAYOUT} now covers something while you wait.`,
  },
  {
    icon: 'lock',
    title: 'Your Fynliq data stays here.',
    body: 'Nothing from your Fynliq account is shared with Gradi.',
  },
  {
    icon: 'check',
    title: 'It’s optional.',
    body: 'Your place in the Fynliq beta is the same whether you sign up or not.',
  },
];

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {name === 'clock' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </>
      )}
      {name === 'lock' && (
        <>
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
        </>
      )}
      {name === 'check' && <path d="m5 13 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function GradiStart() {
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');

  /**
   * Read on mount rather than in the initial state, so the first paint is the
   * same whatever is in storage and a restored tick does not flash in.
   */
  useEffect(() => {
    setDone(readProgress());
  }, []);

  const tick = useCallback((index: number) => {
    setDone((current) => {
      const next = toggleStep(current, index);
      writeProgress(next);
      return next;
    });
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(GRADI_CODE);
      setCopied('ok');
    } catch {
      /* Denied clipboard, or an insecure origin. The code is on screen. */
      setCopied('failed');
    }
  }, []);

  useEffect(() => {
    if (copied === 'idle') return;
    const clear = window.setTimeout(() => setCopied('idle'), 2400);
    return () => window.clearTimeout(clear);
  }, [copied]);

  const percent = progressPercent(done);

  const banner = (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <p className={styles.lockup}>
          <img className={styles.mark} src="/fynliq-mark.png" alt="" width={142} height={160} />
          <span className={styles.times} aria-hidden="true">
            &times;
          </span>
          <span className={styles.partner}>Gradi</span>
        </p>

        <p className={styles.badge}>Official Fynliq partner</p>

        <h1 className={styles.title}>Make your first {GRADI_PAYOUT} while you wait on aid.</h1>

        <p className={styles.lede}>
          Refunds take time. Join Gradi as a creator, post three photos, and once they reach 10
          likes, Gradi pays you {GRADI_PAYOUT}.
        </p>

        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt className={styles.statValue}>{GRADI_PAYOUT}</dt>
            <dd className={styles.statLabel}>after 10 likes</dd>
          </div>
          <div className={styles.stat}>
            <dt className={`${styles.statValue} ${styles.statCost}`}>{GRADI_FEE}</dt>
            <dd className={styles.statLabel}>creator fee to join</dd>
          </div>
        </dl>
      </div>
    </section>
  );

  return (
    <AppShell banner={banner}>
      {/* ---- The code they have to type ----------------------------- */}
      <section className={styles.codeCard} aria-labelledby="code-title">
        <h2 id="code-title" className={styles.codeHead}>
          Your referral code
        </h2>
        <p className={styles.code}>{GRADI_CODE}</p>
        <p className={styles.codeNote}>Enter this in Gradi if it isn’t filled in for you.</p>
        <button type="button" className={styles.copy} onClick={copy}>
          {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Select it above' : 'Copy code'}
        </button>
        <p className={styles.live} role="status">
          {copied === 'ok' ? `${GRADI_CODE} copied to your clipboard.` : ''}
        </p>
      </section>

      {/* ---- The checklist ------------------------------------------ */}
      <section className={styles.path} aria-labelledby="path-title">
        <h2 id="path-title" className={styles.pathTitle}>
          Your path to {GRADI_PAYOUT}
        </h2>

        <div className={styles.pathMeta}>
          <p className={styles.count}>
            {done.size} of {TOTAL_STEPS} done
          </p>
          <p className={styles.hint}>Tap a step when you finish it</p>
        </div>

        <div
          className={styles.track}
          role="progressbar"
          aria-valuenow={done.size}
          aria-valuemin={0}
          aria-valuemax={TOTAL_STEPS}
          aria-label={`${done.size} of ${TOTAL_STEPS} steps done`}
        >
          <span className={styles.fill} style={{ width: `${percent}%` }} />
        </div>

        <ol className={styles.steps}>
          {GRADI_STEPS.map((step, index) => {
            const ticked = done.has(index);
            return (
              <li key={step.title}>
                <button
                  type="button"
                  className={`${styles.step} ${ticked ? styles.stepDone : ''}`}
                  aria-pressed={ticked}
                  onClick={() => tick(index)}
                >
                  <span className={styles.stepNumber} aria-hidden="true">
                    {ticked ? '✓' : index + 1}
                  </span>
                  <span className={styles.stepText}>
                    <span className={styles.stepTitle}>{step.title}</span>
                    <span className={styles.stepBody}>{step.body}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <p className={styles.payout}>
          <span className={styles.payoutMark} aria-hidden="true">
            $
          </span>
          <span>
            <span className={styles.payoutTitle}>Gradi pays you {GRADI_PAYOUT}</span>
            <span className={styles.payoutBody}>Once your photos hit 10 likes.</span>
          </span>
        </p>

        <a
          className={styles.dark}
          href={GRADI_LINK}
          target="_blank"
          rel="noreferrer noopener sponsored"
        >
          Sign up for Gradi &middot; get {GRADI_PAYOUT}
        </a>
      </section>

      {/* ---- Why this sits on a financial-aid product --------------- */}
      <section className={styles.why} aria-labelledby="why-title">
        <h2 id="why-title" className={styles.sectionTitle}>
          Why we partner with Gradi
        </h2>
        <ul className={styles.reasons}>
          {REASONS.map((reason) => (
            <li key={reason.title} className={styles.reason}>
              <span className={styles.reasonIcon}>
                <Icon name={reason.icon} />
              </span>
              <p className={styles.reasonBody}>
                <strong className={styles.reasonTitle}>{reason.title}</strong> {reason.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Questions ---------------------------------------------- */}
      <section className={styles.faq} aria-labelledby="faq-title">
        <h2 id="faq-title" className={styles.sectionTitle}>
          Questions
        </h2>
        {QUESTIONS.map((item) => (
          <details key={item.q} className={styles.question}>
            <summary className={styles.summary}>
              <span>{item.q}</span>
              <span className={styles.plus} aria-hidden="true" />
            </summary>
            <p className={styles.answer}>{item.a}</p>
          </details>
        ))}
      </section>

      {/* ---- The terms, in the body rather than the small print ----- */}
      <section className={styles.terms} aria-labelledby="terms-title">
        <h2 id="terms-title" className={styles.sectionTitle}>
          Before you sign up
        </h2>
        <div className={styles.termsCard}>
          <p className={styles.term}>
            <strong>Gradi is an official Fynliq partner.</strong> You’ll be creating a Gradi account,
            which runs under Gradi’s own terms and privacy policy.
          </p>
          <p className={styles.term}>
            <strong>Joining costs {GRADI_FEE}.</strong> Gradi charges a one-time {GRADI_FEE} creator
            fee. The {GRADI_PAYOUT} is paid only after your three photos reach 10 likes combined, and
            the {GRADI_FEE} is not refunded if they don’t.
          </p>
          <p className={styles.term}>
            You need to be 18 or older. Read Gradi’s privacy policy before uploading photos of
            yourself, and check what they’re used for and how to delete them.
          </p>
        </div>

        <p className={styles.backLink}>
          <a href="/beta/results">Back to my aid analysis</a>
        </p>

        <p className={styles.offerNote}>Offer amount and terms are set by Gradi and may change.</p>
      </section>

      {/* ---- The one thing the page is for -------------------------- */}
      <div className={styles.sticky}>
        <a
          className={styles.cta}
          href={GRADI_LINK}
          target="_blank"
          rel="noreferrer noopener sponsored"
        >
          Get my {GRADI_PAYOUT} <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </AppShell>
  );
}
