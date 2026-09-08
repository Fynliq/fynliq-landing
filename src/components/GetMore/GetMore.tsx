import { Card, Pill, Section } from '../ui';
import { useCopy } from '../../lib/useCopy';
import { ROUTES } from './routes';
import styles from './GetMore.module.css';

export function GetMore() {
  const { copiedId, copy } = useCopy();

  return (
    <Section
      id="get-more"
      eyebrow="Get more"
      title="Six routes to money you never repay"
      lede="Ordered by what is usually worth most for the least effort. Each one comes with the exact wording to send, because the hard part is rarely the asking — it is knowing what to ask for."
      sunk
    >
      <ul className={styles.grid}>
        {ROUTES.map((route) => (
          <Card as="li" key={route.id}>
            <div className={styles.route}>
              <div className={styles.head}>
                <h3 className={styles.title}>{route.title}</h3>
                <Pill tone={route.worthIsAmount ? 'green' : 'neutral'} glyph={false}>
                  {route.worth}
                </Pill>
              </div>

              <p className={styles.body}>{route.body}</p>

              {route.message && <p className={styles.quote}>&ldquo;{route.message}&rdquo;</p>}

              <div className={styles.meta}>
                <span>{route.meta[0]}</span>
                <span>{route.meta[1]}</span>
              </div>

              {route.message && (
                <button
                  type="button"
                  className={`${styles.copy} ${copiedId === route.id ? styles.copied : ''}`}
                  onClick={() => copy(route.id, route.message as string)}
                >
                  {copiedId === route.id ? (
                    <>
                      <span aria-hidden="true">&#10003;</span> Copied
                    </>
                  ) : (
                    'Copy message'
                  )}
                </button>
              )}
            </div>
          </Card>
        ))}
      </ul>

      <p className={styles.note}>
        Fynliq lists the categories and the questions, not individual scholarships. Shipping
        invented listings with made-up deadlines would cost more trust than the feature is worth.
        Real listings need a verified data source, so they wait until we have one.
      </p>
    </Section>
  );
}
