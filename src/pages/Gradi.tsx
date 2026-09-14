import { AppShell } from '../components/nav/AppShell/AppShell';
import { Aurora, Grain } from '../components/fx';
import styles from './Gradi.module.css';

/**
 * Become a Gradi creator.
 *
 * Fynliq's argument to students has always been that the cheapest money is
 * the money you do not borrow. Most of the product makes that argument about
 * aid — grants they did not ask for, loans they did not need to accept. This
 * page makes it about income, which is the other half of the same sentence.
 *
 * Two constraints shaped what is and is not written here.
 *
 * Gradi is somebody else's product. Everything stated about it is either the
 * offer on the referral link itself or something Gradi publishes, and there
 * is no earnings figure anywhere on this page, because Fynliq does not know
 * what a student will earn and a finance product for people deciding how much
 * debt to take on does not get to guess at that.
 *
 * And it is a referral link. The page says so, in the body rather than in
 * small print, and the link carries `rel="sponsored"` because that is what it
 * is.
 */

/** The client's referral link. The $10 offer belongs to it. */
const GRADI_LINK = 'https://gradi.app.link/HGFD9JiKp6b';

/**
 * Where Gradi is live.
 *
 * Gradi launched city by city and this was Houston at the time of writing.
 * It is a constant rather than a sentence in the markup because it is the one
 * fact on this page most likely to go stale — confirm it before launch and
 * edit this line, not the paragraph below.
 */
const GRADI_COVERAGE = 'Gradi is live in Houston, Texas, and adding cities.';

const STEPS = [
  {
    title: 'Open the link and claim the $10',
    body: 'The offer belongs to Gradi and lands in your Gradi account, not your Fynliq one. It takes about as long as installing any other app.',
  },
  {
    title: 'Post the food you were going to eat anyway',
    body: 'Gradi is a food discovery app: real dishes photographed by real people, tagged to the place that served them. Dining hall, taco truck, the place everyone goes after a night out. You are already taking these photographs.',
  },
  {
    title: 'Accept the ad requests worth accepting',
    body: 'Local businesses pay to place advertising on creators’ content. Requests arrive for you to accept or ignore, and the ones you ignore cost you nothing.',
  },
];

const HONEST = [
  {
    title: 'It is earnings, not aid',
    body: 'Nothing here touches your FAFSA, your award or your disbursement, and it cannot. It also will not reduce a bill that is due next week — money from this arrives the way any income arrives, over time.',
  },
  {
    title: 'Income can matter later',
    body: 'Student income above the protection allowance can raise your Student Aid Index in a future award year. For most students earning a modest amount on the side this changes nothing at all, but it is worth knowing it is not invisible, and worth keeping a record of what you earn.',
  },
  {
    title: 'Fynliq does not run Gradi',
    body: 'Gradi is a separate company and a separate app, with its own terms, its own payouts and its own support. Fynliq is not paying you, cannot see your Gradi account, and cannot resolve anything that goes wrong inside it.',
  },
  {
    title: 'This is a referral link',
    body: 'Fynliq has a referral relationship with Gradi, which is why this page exists. You are seeing it because it is a genuine way for a student to earn without borrowing — but you should know the nature of the link before you tap it.',
  },
];

export function Gradi() {
  const banner = (
    <section className={styles.hero}>
      <div className={styles.glow} aria-hidden="true">
        <Aurora tone="dark" />
      </div>
      <Grain />

      <div className={styles.heroInner}>
        <span className={styles.eyebrow}>Fynliq &times; Gradi</span>
        <h1 className={styles.title}>
          The cheapest money is the money{' '}
          <br />
          you did not have to borrow.
        </h1>
        <p className={styles.lede}>
          Fynliq spends most of its time helping you avoid debt you do not need. This is the other
          side of it: a way to earn from something you already do &mdash; photographing what you
          eat &mdash; without it costing you a shift you do not have time for.
        </p>

        <div className={styles.actions}>
          <a
            className={styles.pink}
            href={GRADI_LINK}
            target="_blank"
            rel="noreferrer noopener sponsored"
          >
            Get $10 on Gradi
            <span aria-hidden="true">&rarr;</span>
          </a>
          <p className={styles.actionNote}>
            Opens Gradi. The $10 is their offer, paid into your Gradi account.
          </p>
        </div>
      </div>
    </section>
  );

  return (
    <AppShell banner={banner}>
      {/* ---- What it actually is ----------------------------------- */}
      <section className={styles.block} aria-labelledby="what-title">
        <header className={styles.blockHead}>
          <h2 id="what-title" className={styles.blockTitle}>
            What Gradi is
          </h2>
          <p className={styles.blockLede}>
            A food discovery app built on photographs from people who actually ate the dish, rather
            than on stock images and star ratings. Students are the reason it works: you eat out
            more often, in more places, than anybody it is trying to serve. {GRADI_COVERAGE}
          </p>
        </header>

        <ol className={styles.steps}>
          {STEPS.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- The honest part --------------------------------------- */}
      <section className={styles.block} aria-labelledby="honest-title">
        <header className={styles.blockHead}>
          <h2 id="honest-title" className={styles.blockTitle}>
            Before you tap it
          </h2>
          <p className={styles.blockLede}>
            Fynliq does not put a figure on this page because Fynliq does not know what you would
            earn, and a product that exists to stop students being misled about money does not get
            to start now. Here is everything that is actually true about it.
          </p>
        </header>

        <div className={styles.honest}>
          {HONEST.map((item) => (
            <div key={item.title} className={styles.honestCard}>
              <h3 className={styles.honestTitle}>{item.title}</h3>
              <p className={styles.honestBody}>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Close -------------------------------------------------- */}
      <section className={styles.close} aria-labelledby="close-title">
        <h2 id="close-title" className={styles.closeTitle}>
          Worth ten minutes, on the strength of the $10 alone.
        </h2>
        <p className={styles.closeBody}>
          Whatever you make after that is yours to find out. If it turns out not to be for you,
          nothing about your aid, your award or your Fynliq account changes.
        </p>

        <a
          className={styles.pink}
          href={GRADI_LINK}
          target="_blank"
          rel="noreferrer noopener sponsored"
        >
          Get $10 on Gradi
          <span aria-hidden="true">&rarr;</span>
        </a>

        <p className={styles.closeFoot}>
          Still working out your aid?{' '}
          <a className={styles.closeLink} href="/search">
            See what students are searching
          </a>{' '}
          or{' '}
          <a className={styles.closeLink} href="/ask">
            ask about your own
          </a>
          .
        </p>
      </section>
    </AppShell>
  );
}
