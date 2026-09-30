import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getBillingStatus, type BillingStatus } from './client';

/**
 * Where the logged-in account stands on the FYNQ Beta Unlock, read once and
 * shared, so the My Aid pages and the step bar agree without each asking.
 *
 * `loading` is true until the first answer. A failed check leaves `status`
 * null, which every page treats as "behave as before" — the server's 402 on
 * /api/analyze is the real gate either way.
 */
interface BillingValue {
  status: BillingStatus | null;
  loading: boolean;
  refresh: () => Promise<BillingStatus | null>;
}

const BillingContext = createContext<BillingValue>({ status: null, loading: false, refresh: async () => null });

export function BillingProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await getBillingStatus();
    setStatus(next);
    setLoading(false);
    return next;
  }, []);

  // Asked again whenever somebody logs in or out.
  const who = session?.account.email ?? null;
  useEffect(() => {
    if (!who) { setStatus(null); setLoading(false); return; }
    setLoading(true);
    const controller = new AbortController();
    void getBillingStatus(controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setStatus(next);
      setLoading(false);
    });
    return () => controller.abort();
  }, [who]);

  const value = useMemo(() => ({ status, loading, refresh }), [status, loading, refresh]);
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export const useBilling = () => useContext(BillingContext);
