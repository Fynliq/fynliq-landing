/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The document reader's endpoint.
   *
   * Unset — the default — runs the flow on the local stub, which walks the
   * same stages and labels its figures as demo ones on screen. Set it and the
   * whole product runs on real reads. Nothing else changes.
   *
   * See `docs/ANALYSIS_API.md` for the request and response contract.
   */
  readonly VITE_FYNLIQ_ANALYZE_URL?: string;

  /**
   * The FYNQ Beta Unlock endpoint (`/api/billing`). Production defaults to
   * same-origin; unset in local development, the paywall is off. It carries
   * no secret: Stripe keys are server-only and never prefixed with VITE_.
   */
  readonly VITE_FYNLIQ_BILLING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
