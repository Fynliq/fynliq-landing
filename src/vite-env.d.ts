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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
