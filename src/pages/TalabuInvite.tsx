import { useState } from 'react';
import { AppShell } from '../components/nav/AppShell/AppShell';

/**
 * Explicit, member-initiated cross-product enrollment.
 * No Fynliq session, student-aid documents, passwords or account records
 * leave this application. Talabu Exchange has its own signup and consent.
 */
const TALABU_URL = 'https://fynliq-exchange-7x7k.vercel.app/join/fynliq';

export function TalabuInvite() {
  const [chosen, setChosen] = useState(false);

  return (
    <AppShell>
      <section aria-labelledby="talabu-invite-title" style={{
        maxWidth: 680, margin: '24px auto', padding: '32px 26px',
        borderRadius: 26, border: '1px solid var(--line)',
        background: 'var(--card)', boxShadow: '0 12px 36px rgba(24, 16, 45, 0.05)',
      }}>
        <p style={{ margin: 0, color: '#7651e9', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 12 }}>
          Optional invitation for Fynliq members
        </p>
        <h1 id="talabu-invite-title" style={{ margin: '14px 0', fontSize: 'clamp(32px, 6vw, 48px)', letterSpacing: '-.04em' }}>
          Meet Talabu Exchange.
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.55, marginBottom: 20 }}>
          Buy and sell everyday products using live bids, asking prices and price histories.
          Talabu Exchange is a separate marketplace built by the team behind Fynliq.
        </p>
        <div style={{ border: '1px solid var(--line)', borderRadius: 18, padding: 18, margin: '20px 0' }}>
          <h2 style={{ fontSize: 19, margin: '0 0 10px' }}>Your information stays separate.</h2>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            Joining Talabu is optional. Your Fynliq account remains unchanged.
            We do not transfer your FAFSA or financial-aid documents, account records,
            password or payment details. Talabu uses its own signup and privacy policy.
          </p>
        </div>
        <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', lineHeight: 1.5, margin: '22px 0 18px', cursor: 'pointer' }}>
          <input type="checkbox" checked={chosen} onChange={e => setChosen(e.target.checked)}
            style={{ width: 20, height: 20, flex: 'none', marginTop: 3, accentColor: '#7651e9' }}/>
          <span>I choose to continue to Talabu Exchange and understand that I will need a separate marketplace account.</span>
        </label>
        {chosen ? (
          <a href={TALABU_URL} style={{
            display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
            minHeight: 50, padding: '12px 24px', borderRadius: 999,
            color: '#fff', background: '#7045f2', fontWeight: 700, textDecoration: 'none',
          }}>
            Continue to Talabu Exchange →
          </a>
        ) : (
          <button type="button" disabled style={{
            minHeight: 50, padding: '12px 24px', borderRadius: 999, border: 0,
            color: '#fff', background: '#9c98a7', cursor: 'not-allowed',
            fontWeight: 700, opacity: .72,
          }}>
            Continue to Talabu Exchange →
          </button>
        )}
        <p style={{ margin: '16px 0 0', fontSize: 13, color: 'var(--mid)', lineHeight: 1.5 }}>
          Fynliq remains available whether or not you join. Talabu's age requirement
          and marketplace terms apply when you sign up there.
        </p>
      </section>
    </AppShell>
  );
}
