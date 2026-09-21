import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Logo } from '../ui';
import styles from './Navbar.module.css';

const LINKS = [
  { href: '#clarity', label: 'Your money' },
  { href: '#aid', label: 'Aid' },
  { href: '#loan', label: 'Loans' },
  { href: '#get-more', label: 'Get more' },
  { href: '#tasks', label: 'Deadlines' },
  { href: '#ask', label: 'Ask' },
] as const;

export function Navbar() {
  const { session } = useAuth();
  const [lifted, setLifted] = useState(false);
  const [current, setCurrent] = useState<string>('');

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Marks the link for whichever section currently occupies the viewport.
  useEffect(() => {
    const sections = LINKS.map((link) => document.querySelector(link.href)).filter(
      (node): node is Element => node !== null,
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setCurrent(`#${visible.target.id}`);
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <header className={`${styles.bar} ${lifted ? styles.on : ''}`}>
      <div className={styles.inner}>
        <a className={styles.home} href="#top" aria-label="Fynliq, back to top">
          <Logo beta />
        </a>

        <nav className={styles.links} aria-label="Sections">
          {LINKS.map((link) => (
            <a
              key={link.href}
              className={`${styles.link} ${current === link.href ? styles.current : ''}`}
              href={link.href}
              aria-current={current === link.href ? 'true' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/*
          One button, and it always points at /beta.

          A returning student needs no separate "Log in" link: the gate sends
          anybody without an account to the log-in page anyway, so a second
          button here would lead to the same screen and only make the bar
          harder to read. What does change is the label — "Join the beta" is
          a strange thing to read once you have joined.
        */}
        <a className={styles.cta} href="/beta">
          {session ? 'My aid' : 'Join the beta'}
        </a>
      </div>
    </header>
  );
}
