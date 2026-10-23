import { createHmac } from 'node:crypto';

/**
 * Stores only a keyed hash of the customer's verified inbound number.
 * SMS does not prove ownership of any Fynliq financial account; do not use it
 * to authorize access to customer accounts or private records.
 */
export function createSmsConsentStore({
  supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  hashSecret = process.env.FYNLIQ_SMS_PHONE_HASH_KEY,
  fetchImpl = fetch,
} = {}) {
  if (!supabaseUrl || !serviceRoleKey || !hashSecret || hashSecret.length < 32) {
    throw new Error('SMS consent storage is not configured');
  }
  const base = new URL('/rest/v1/fynliq_sms_consent', supabaseUrl).toString();
  const headers = {
    apikey: serviceRoleKey,
    Authorization: 'Bearer ' + serviceRoleKey,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  function identity(from) {
    if (!/^\+1[2-9]\d{9}$/.test(from)) throw new Error('Unsupported SMS sender');
    return createHmac('sha256', hashSecret).update(from, 'utf8').digest('hex');
  }
  return {
    forPhone(from) {
      const phoneHash = identity(from);
      return {
        async getStatus() {
          const url = base + '?phone_hash=eq.' + encodeURIComponent(phoneHash) + '&select=state';
          const response = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error('Consent lookup failed');
          const data = await response.json();
          return Array.isArray(data) ? (data[0]?.state ?? null) : null;
        },
        async setStatus(state) {
          if (!['pending', 'active', 'opted_out'].includes(state)) throw new Error('Invalid consent state');
          const response = await fetchImpl(base + '?on_conflict=phone_hash', {
            method: 'POST',
            headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ phone_hash: phoneHash, state, updated_at: new Date().toISOString() }),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error('Consent update failed');
        },
      };
    },
  };
}
