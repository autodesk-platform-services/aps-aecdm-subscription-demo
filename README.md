# AEC Data Model — Extraction Status Subscription Demo

Demonstrates the AEC Data Model (AECDM) **Subscription API**: instead of
polling `elementGroupExtractionStatus`, this app opens a long-lived HTTP
multipart connection and reacts the moment a Revit model finishes extracting
after a sync or publish. UI modeled on the internal `aps-aecdm-subscription-sample`
reference app.

Flow demonstrated:

1. Pick a **Hub** and **Project**, click **Subscribe by Project** — this
   opens `elementGroupExtractionStatusByProject`, which streams an event for
   every file's extraction in that project, whether or not AEC Data Model
   has ever seen the file before.
2. Publish a Revit model for the first time → it shows up in **Discovered
   Files** the moment extraction succeeds. Click it to track it — the app
   immediately calls `elementsByElementGroup` and shows the result.
3. Edit the model in Revit and publish again → the same project subscription
   delivers another event for the tracked file; the app calls
   `diffElementGroupByVersionWithLatest` against the previous version and
   shows the diff.

`Subscribe by File` + a manual `fileUrn` is also available as a direct path
(matching the reference sample) for targeting one already-known file without
the project-wide noise; `Simulate Disconnect` and `Compare with polling`
demonstrate the subscription's resilience/backoff and contrast it against
the legacy `elementGroupExtractionStatus` poll loop.

## Prerequisites

- Node.js 18+
- An APS app at https://aps.autodesk.com/myapps with the **AEC Data Model
  API** enabled.
- Callback URL registered on the APS app: `http://localhost:3000/api/auth/callback`
  (or whatever `PORT`/`APS_CALLBACK_URL` you configure — this is a normal
  OAuth redirect, no tunneling needed since the subscription itself is not a
  webhook).
- Access to an ACC/Forma project containing a Revit model you can publish to.

## Setup

```bash
cp .env.example .env
# fill in APS_CLIENT_ID / APS_CLIENT_SECRET
npm install
npm run dev
```

Open http://localhost:3000, click **Login**, pick a **Hub** and **Project**,
then click **Subscribe by Project** and publish/sync a Revit model to see it
appear in the Discovered Files list.

## Architecture notes

- `src/graphqlClient.js` — raw `fetch`-based one-shot `query()` and
  `openSubscription()` (multipart stream, boundary negotiated from the
  response's `Content-Type` header rather than hardcoded).
- `src/multipartParser.js` — parses the `--graphql` multipart stream into
  keep-alive / payload / unparsed parts.
- `src/subscriptionSession.js` — runs one subscription for the lifetime of a
  browser `EventSource`, reconnecting with exponential backoff (up to 5
  attempts) if the stream drops, and supports a `clientId`-scoped
  `killUpstream`/`stopSession` for the Stop / Simulate Disconnect buttons.
- The server relays raw subscription events over SSE; the browser
  (`public/main.js`) owns all narrative logic — deciding what a `SUCCESS`
  event means, maintaining the Discovered Files list, and firing the
  `elementsByElementGroup` / `diffElementGroupByVersionWithLatest` follow-up
  calls.
- State is kept in memory for a single demo session (no database, no
  multi-user auth) — this is a demo, not a production app.
- `diffElementGroupByVersionWithLatest` takes `startVersion` (not
  `versionNumber`) and returns `result[].differences.results[]` (not flat
  `elementsAdded`/`elementsRemoved`/`elementsModified` lists) — confirmed
  against the live schema after an initial guess failed, and cross-checked
  against `aps-aecdm-extensibility-web-application-sample`.
- `elementGroupExtractionStatus` (used for the polling-comparison feature)
  takes `fileUrn` directly rather than a wrapped `input` argument — confirmed
  against the reference sample's own testing notes.
