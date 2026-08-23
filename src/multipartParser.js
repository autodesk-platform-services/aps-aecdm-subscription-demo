// Parses the multipart/mixed stream used by AEC Data Model GraphQL subscriptions. Each part
// looks like:
//
//   --graphql
//   content-type: application/json
//
//   {}
//
// Chunks arrive at arbitrary byte boundaries, so this buffers everything seen so far and only
// emits a part once the *next* boundary marker proves the previous one is complete.
export class MultipartParser {
  constructor(boundary = 'graphql') {
    this.marker = `--${boundary}`;
    this.buffer = '';
  }

  // Feed a chunk (Buffer or string). Returns every complete part found so far as
  // { raw, data }, where `data` is undefined if the part's body wasn't valid JSON (e.g. the
  // closing "--graphql--" terminator, which carries no JSON body at all).
  push(chunk) {
    this.buffer += chunk.toString('utf8');
    const parts = [];
    let idx;
    // Search from index 1 so we don't immediately re-match the boundary marker left at the
    // start of the buffer by the previous call.
    while ((idx = this.buffer.indexOf(this.marker, 1)) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx);
      parts.push({ raw, data: parsePartBody(raw) });
    }
    return parts;
  }

  // Call once the underlying stream has ended, in case a final part never got a trailing
  // boundary marker to confirm it.
  flush() {
    const raw = this.buffer;
    this.buffer = '';
    if (!raw.trim()) return undefined;
    return { raw, data: parsePartBody(raw) };
  }
}

function parsePartBody(raw) {
  const withoutBoundaryLine = raw.replace(/^--[^\r\n]*\r?\n/, '');
  const blankLineMatch = withoutBoundaryLine.match(/\r?\n\r?\n/);
  const bodyText = (blankLineMatch
    ? withoutBoundaryLine.slice(blankLineMatch.index + blankLineMatch[0].length)
    : withoutBoundaryLine
  ).trim();
  if (!bodyText) return undefined;
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}

// A part with an empty object body ({}) is a keep-alive per the tutorial.
export function isKeepAlive(data) {
  return !!data && typeof data === 'object' && Object.keys(data).length === 0;
}
