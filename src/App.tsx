import { AidBreakdown } from './components/AidBreakdown/AidBreakdown';
import { AskPreview } from './components/AskPreview/AskPreview';
import { CTA } from './components/CTA/CTA';
import { Footer } from './components/Footer/Footer';
import { GetMore } from './components/GetMore/GetMore';
import { Hero } from './components/Hero/Hero';
import { LoanDecision } from './components/LoanDecision/LoanDecision';
import { MoneyClarity } from './components/MoneyClarity/MoneyClarity';
import { Navbar } from './components/Navbar/Navbar';
import { TaskList } from './components/TaskList/TaskList';
import { TrustSection } from './components/TrustSection/TrustSection';
import { ScrollProgress } from './components/fx';
import { Reveal } from './Reveal';
import styles from './App.module.css';

export function App() {
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <ScrollProgress />
      <Navbar />

      <main id="main">
        <Hero />

        {/* Full-width section wrappers only ever move on the vertical axis or
            in depth — a horizontal reveal on a full-bleed block would widen
            the page while it played. */}
        <Reveal variant="tilt">
          <MoneyClarity />
        </Reveal>
        <Reveal>
          <AidBreakdown />
        </Reveal>
        <Reveal variant="tilt">
          <LoanDecision />
        </Reveal>
        <Reveal>
          <GetMore />
        </Reveal>
        <Reveal variant="tilt">
          <TaskList />
        </Reveal>
        <Reveal>
          <AskPreview />
        </Reveal>
        <Reveal variant="scale">
          <TrustSection />
        </Reveal>
        <Reveal>
          <CTA />
        </Reveal>
      </main>

      <Footer />
    </>
  );
}
