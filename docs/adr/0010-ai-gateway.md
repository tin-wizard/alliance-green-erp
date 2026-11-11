# ADR 0010 — AI Gateway seam, disabled until inference is funded

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

The human provisioned **Neon AI Gateway** with the same branch credential system as object
storage. The gateway advertises a model catalogue, but inference is not available: the project
has no prepaid AI credits. A live probe returns:

```
HTTP 403
{"error":{"message":"AI Gateway credits required. Add credits to continue.",
          "unavailable_reason":"credits_required"}}
```

The platform must wire the seam now, without pretending features work or silently falling back to
another provider.

## Decision

1. **`packages/ai`** exposes `listModels()`, `chat(messages, options)` and `aiHealth()`. Nothing
   else imports the gateway URL or token.
2. **Feature flag `AI_ENABLED` defaults to `false`.** With the flag off, `chat()` throws
   `AiUnavailableError` (503, code `ai_unavailable`) and `aiHealth()` reports `disabled`. No
   placeholder answer is ever returned.
3. **`listModels()` is allowed even when inference is unfunded**; it is a read-only catalogue call
   and is useful for diagnostics. `aiHealth()` reports the count and states that inference needs
   prepaid credits.
4. **Provider errors are surfaced as 503 with the provider's message.** When credits are added,
   no code change is needed beyond `AI_ENABLED=true`; the default model is
   `AI_DEFAULT_MODEL` (currently `claude-haiku-4-5`, chosen for cost).
5. **No AI call is on a request path.** The seam is for future assistive features (summaries,
   extraction, drafting), never for authorization, pricing or accounting postings.

## Alternatives considered

1. **Call the gateway anyway and swallow the error.** Rejected: it wastes latency and hides a
   known outage.
2. **Fall back to a public provider with a separate key.** Rejected: the human provisioned Neon
   AI Gateway; adding a vendor and a secret is a decision for them.
3. **Local model.** Rejected for phase 1: the LAN server has no GPU and the operational burden is
   disproportionate.
4. **No seam until credits exist.** Rejected: wiring it now is small, and the health report makes
   the state explicit.

## Consequences

- **Positive:** the integration point exists and is testable; enabling it is a flag plus credits.
- **Positive:** the app never presents an LLM answer it did not receive.
- **Negative:** AI features are unavailable until the billing step is taken. Reported in
  `/api/health`, the dashboard and `platform/NEON.md`.
- **Guardrail:** AI output must never be the sole basis for a financial or compliance action.

## Verification

- Live `GET /v1/models` returns the catalogue; live `POST /v1/chat/completions` returns 403
  `credits_required` (recorded in `platform/NEON.md`).
- With the flag off, `aiHealth()` reports `disabled` and `chat()` throws; covered by the health
  payload and the package contract.
