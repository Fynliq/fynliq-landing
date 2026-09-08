import { Logo } from '../ui';
import styles from './Footer.module.css';

const COLUMNS = [
  {
    heading: 'The beta',
    links: [
      { label: 'Your money', href: '#clarity' },
      { label: 'Financial aid', href: '#aid' },
      { label: 'Loan decision', href: '#loan' },
    ],
  },
  {
    heading: 'More',
    links: [
      { label: 'Get more', href: '#get-more' },
      { label: 'Deadlines', href: '#tasks' },
      { label: 'Ask', href: '#ask' },
    ],
  },
  {
    heading: 'Authoritative sources',
    links: [
      { label: 'studentaid.gov', href: 'https://studentaid.gov', external: true },
      { label: 'Your school\u2019s aid office', href: '#trust' },
      { label: 'How we handle figures', href: '#trust' },
    ],
  },
];

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <Logo large beta />
          <p className={styles.tagline}>
            Fynliq helps students understand their money, financial aid, loans, deadlines and the
            funding still worth asking for &mdash; using their own figures.
          </p>
        </div>

        <nav className={styles.nav} aria-label="Footer">
          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className={styles.heading}>{column.heading}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      className={styles.link}
                      href={link.href}
                      {...('external' in link && link.external
                        ? { target: '_blank', rel: 'noreferrer noopener' }
                        : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className={styles.legal}>
          <p className={styles.disclaimer}>
            Educational guidance only. Fynliq is not affiliated with FAFSA, Federal Student Aid, the
            Department of Education, or your school. Your aid office and studentaid.gov are the
            authoritative sources. Figures shown on this page are demo figures.
          </p>
          <p className={styles.copy}>&copy; {new Date().getFullYear()} Fynliq</p>
        </div>
      </div>
    </footer>
  );
}
