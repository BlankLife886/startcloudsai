# AI Assistant Tool Roadmap

## Current capabilities

Source review: 2026-09-22. This section describes implemented paths, not a new end-to-end validation against paid providers. Actual availability depends on runtime tool and model configuration.

The assistant already supports:

- Public web search with source links and bounded retries.
- Attached-file metadata, passage search, and segmented reading.
- Downloadable TXT, Markdown, CSV, JSON, and PPTX creation.
- Image generation/edit proposals with model-capability validation.
- Dedicated PPT and PSD generation paths.
- Guarded media actions, image search, public-page capture, workspace handoff,
  reference-rebuild drafts, product-page import, delivery export, and allowlisted
  site navigation. See [the current user tool catalog](USER_TOOL_CATALOG.md).
- Local, account-cloud, and official instruction skills via `@` mentions in the
  supported composers; these expand prompt text and do not grant extra permissions.
- Read-only `task_status` diagnostics for the current user's task stage, timing,
  retries, failure reason, charge, and refund state. Internal IDs and provider
  routing data are removed before results reach the model.

Canvas tools are intentionally separate. They operate on browser canvas state and
must not be exposed to normal chat without an explicit workspace and permission
boundary.

Image proposals can use the user's automatic-approval preference when the server
marks the proposal eligible. Ordinary tool confirmations and Canvas high-risk
confirmations remain separate policies; new tools should not assume every image
proposal always requires another manual click.

## Recommended next tools

| Priority | Tool | User value | Safety boundary |
| --- | --- | --- | --- |
| P0 | `url_read` | Reads a user-provided page after search and extracts the relevant sections instead of relying on snippets. | SSRF protection, public HTTP(S) only, size/time limits, prompt-injection isolation. |
| P0 | `assets_search` | Finds the user's own images/files by keyword, date, model, tag, or project and makes them reusable in chat. | Read-only by default; current user only; signed URLs with short expiry. |
| P0 | `calculator` | Handles pricing, dimensions, ratios, percentages, totals, and token/cost calculations deterministically. | Pure local evaluation; no arbitrary code execution. |
| P1 | `model_catalog` | Recommends available models using real capabilities, price, limits, and health instead of model memory. | Public configuration only; hide endpoints, keys, provider IDs, and margins. |
| P1 | `image_inspect` | Reads dimensions, format, transparency, dominant colors, OCR text, and quality warnings from an attached image. | Attached or owned images only; bounded decoding and OCR. |
| P1 | `document_create` | Adds DOCX, XLSX, and PDF to the existing safe file generator. | Structured schemas, output-size limits, virus/signature checks, owned storage. |
| P1 | `project_context` | Reads recent project conversations, assets, and accepted requirements so long work can continue consistently. | Explicit project scope; read-only; token budget and retention limits. |
| P2 | Generalized `workflow_draft` | Extends the existing `reference_rebuild` draft path to a general goal-to-workflow planner. | Draft-only first; execution follows the Canvas confirmation and pricing boundary. |

## Recommended implementation order

1. `url_read` to make web research complete rather than snippet-based.
2. `assets_search` so conversations can reuse the product's existing asset library.
3. `calculator` and `model_catalog` for reliable planning and cost answers.
4. Structured DOCX/XLSX/PDF creation, then project memory and workflow drafts.

## Tools to avoid for now

- Arbitrary shell, SQL, or code execution.
- General browser control inside normal user chats.
- Email, social posting, payments, or account changes without a dedicated approval flow.
- Automatic deletion or bulk asset mutation.
- Direct exposure of Canvas mutation tools outside the Infinite Canvas workspace.

Every new tool should use a strict JSON schema, a per-call timeout, bounded output,
least-privilege permissions, an audit trace, and a user-readable failure message.
