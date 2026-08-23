import { openSubscription } from './graphqlClient.js';
import { MultipartParser, isKeepAlive } from './multipartParser.js';

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

function backoffDelay(attempt) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const activeSessions = new Map();

export function killUpstream(clientId) {
  activeSessions.get(clientId)?.abort();
}

export function stopSession(clientId) {
  const session = activeSessions.get(clientId);
  if (session) {
    session.stopped = true;
    session.abort();
  }
  activeSessions.delete(clientId);
}

// Runs a subscription for the lifetime of one browser EventSource connection: opens the
// multipart stream, emits every part (keep-alive, payload, or unparsed) via `emit`, and
// reconnects with backoff if the stream drops before the caller calls stopSession. This app
// expects a single connection to carry many terminal events over time (every Revit publish/sync
// in the project, or every republish of one file), so a SUCCESS/FAILED event never ends the loop
// on its own — only an explicit stop, or exhausting the reconnect budget, does.
export async function runSubscriptionSession(clientId, gqlQuery, variables, emit) {
  let attempt = 0;

  while (attempt <= MAX_RECONNECT_ATTEMPTS) {
    if (attempt > 0) emit({ type: 'reconnecting', attempt });

    const controller = new AbortController();
    activeSessions.set(clientId, { abort: () => controller.abort(), stopped: false });

    try {
      const { stream, boundary } = await openSubscription(gqlQuery, variables, controller.signal);
      const parser = new MultipartParser(boundary);

      for await (const chunk of stream) {
        for (const part of parser.push(chunk)) {
          emitPart(emit, part);
        }
      }
      const final = parser.flush();
      if (final) emitPart(emit, final);

      if (activeSessions.get(clientId)?.stopped) return;
      emit({ type: 'disconnected', reason: 'stream-ended' });
    } catch (err) {
      if (activeSessions.get(clientId)?.stopped) return;
      emit({ type: 'error', message: err.message, aborted: err.name === 'AbortError' });
    }

    attempt++;
    if (attempt <= MAX_RECONNECT_ATTEMPTS) {
      const delayMs = backoffDelay(attempt);
      emit({ type: 'backoff', delayMs, attempt });
      await sleep(delayMs);
    }
  }

  emit({ type: 'fatal', message: 'Max reconnect attempts exceeded' });
  activeSessions.delete(clientId);
}

function emitPart(emit, part) {
  if (part.data === undefined) {
    emit({ type: 'unparsed', raw: part.raw });
  } else if (isKeepAlive(part.data)) {
    emit({ type: 'keepAlive' });
  } else {
    emit({ type: 'payload', data: part.data });
  }
}
