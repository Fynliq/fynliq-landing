import { Aurora, Coin3D } from '../fx';
import styles from './CTA.module.css';

export function CTA() {
  return (
    <section className={styles.wrap} id="join" aria-labelledby="join-title">
      <div className={styles.inner}>
        <div className={styles.panel}>
          <div className={styles.glow} aria-hidden="true">
            <Aurora tone="dark" />
          </div>

          <span className={styles.eyebrow}>The beta</span>
          <h2 id="join-title" className={styles.title}>
            Add your award. See what it actually leaves you.
          </h2>
          <p className={styles.body}>
            A screenshot of your Accept/Decline page is enough to start. Upload it and Fynliq reads
            the figures, then shows you the same screens you have seen here &mdash; with your
            numbers in place of the demo ones, and what to do next in plain English.
          </p>

          <div className={styles.actions}>
            <a className={styles.primary} href="/beta">
              Upload your aid summary
              <span aria-hidden="true">&rarr;</span>
            </a>
            <a className={styles.secondary} href="#clarity">
              Look through it again
            </a>
          </div>

          <div className={styles.aside}>
            <Coin3D size={124} className={styles.coin} />
            <p className={styles.foot}>
              The beta is a small group while the award reader is still learning new portal layouts.
              We will tell you what it could not read rather than guessing at it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
