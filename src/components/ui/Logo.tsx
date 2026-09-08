import styles from './Logo.module.css';

interface LogoProps {
  large?: boolean;
  /** Shows the BETA tag beside the wordmark. */
  beta?: boolean;
}

/**
 * The Fynliq lockup. The lime mark is the one and only use of #9CE623 in the
 * whole interface — it never appears in text, buttons, badges or backgrounds.
 */
export function Logo({ large = false, beta = false }: LogoProps) {
  return (
    <span className={`${styles.lock} ${large ? styles.large : ''}`}>
      <img className={styles.mark} src="/fynliq-mark.png" alt="" width={142} height={160} />
      <span className={styles.word}>Fynliq</span>
      {beta && <span className={styles.beta}>Beta</span>}
    </span>
  );
}
