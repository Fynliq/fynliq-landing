# Company AI cloud — GPU gateway foundation

Standalone **private model gateway**, designed to sit alongside the existing product baseline. No live site routes, databases, payments, messaging, or Vercel deployments are modified.

## What works in this iteration

- Authenticated server-to-server POST /v1/chat/completions, with a fixed model and fixed private upstream.
- Bounded text-only requests, limited output tokens, concurrency caps, and per-process rate limiting.
- GET /healthz (public *process liveness*), GET /v1/metrics (authenticated counters).
- Data-minimal logging; the gateway never persists prompts, personal financial information, or answers.
- A local Node runner, Docker configuration, and no-network unit tests.
- Uses any trusted vLLM-compatible chat server. No GPU or model is provisioned automatically.

**Not yet implemented:** Training, GPU scheduling, a customer-facing cloud dashboard, multitenancy, SMS, persistent memory, video, audio, billing, or integration with the existing Ask API. In particular, the product's existing /api/ask contract uses strict structured outputs; do not redirect it to this chat-only endpoint without a tested provider adapter and fallback.

## Start locally (Node.js 22+)

    cd cloud
    cp .env.example .env
    openssl rand -hex 32      # put the result into CLOUD_GATEWAY_API_KEY
    # edit CLOUD_MODEL_NAME, CLOUD_UPSTREAM_URL and optional CLOUD_UPSTREAM_API_KEY
    npm run check
    npm run start:env

Run an existing private vLLM-compatible model server on your GPU at the configured URL. See:
https://docs.vllm.ai/en/latest/serving/openai_compatible_server/

From a **trusted backend**, supply the gateway key in an Authorization: Bearer header.
Example, with CLOUD_GATEWAY_API_KEY already exported in your shell:

    curl http://127.0.0.1:8787/v1/chat/completions \
      -H "Authorization: Bearer $CLOUD_GATEWAY_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"model":"company-model","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'

## Docker

For a model server on the Docker host, set CLOUD_UPSTREAM_URL in cloud/.env to
http://host.docker.internal:8000/v1/chat/completions **only if the server is accessible on a trusted private network**.
Then run in cloud/:

    docker compose up --build -d

Docker binds the gateway to the machine's localhost, not to the public internet. If no GPU model server is running, chat calls will fail safely.

## Security/operations before production

- Never place the gateway key in browser/client code. Keep it in a server-side secret manager.
- vLLM's API key does **not** guard every vLLM endpoint. Keep the raw model server network-private and behind a suitable firewall/reverse proxy.
- Add TLS/private ingress, distributed quotas, tenants, authentication, redacted telemetry, backups, abuse monitoring, and a safe rollout mechanism before exposing a commercial API.
- Metrics and rate limits are currently only in process memory. Health checks **do not** prove GPU availability.
- Review all personal data access and user consent; do not auto-train shared models on private chats or finances.
- Keep your existing AI provider enabled until the first private GPU has been tested under load, including timeout, retry, latency, and quality behavior.

## Next phase

Connect a private GPU model to this gateway, benchmark it, and build a server-only adapter for the existing application. The separate experimental Ollama Cloud and model-training branches can be integrated later after review.
