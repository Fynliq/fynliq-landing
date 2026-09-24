import { Analytics } from '@vercel/analytics/react';
import { useRouter } from '../router/router';
import { analyticsPath, redactPageview } from './privacy';

export function SiteAnalytics() {
  const { path } = useRouter();
  // Preview deployments and local testing should not inflate visitor reports.
  if (!import.meta.env.PROD || !['fynliq.com', 'www.fynliq.com'].includes(window.location.hostname)) return null;
  const safePath = analyticsPath(path);
  return <Analytics route={safePath} path={safePath} beforeSend={redactPageview} debug={false} />;
}
