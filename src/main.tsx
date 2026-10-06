import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/print.css';
import { App } from './App';
import { captureArrival } from './analytics/attribution';
import { installErrorTracking } from './analytics/events';
import { analyticsPath } from './analytics/privacy';

// Read UTM tags and the referrer before the router can drop the query string.
captureArrival();

// Counts uncaught errors (type, bundle file, allow-listed route only; never the message).
installErrorTracking(window, analyticsPath);

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
