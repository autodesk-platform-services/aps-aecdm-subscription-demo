import { Readable } from 'node:stream';
import { getValidAccessToken } from './auth.js';

const AECDM_GRAPHQL_URL = process.env.AEC_DM_GRAPHQL_ENDPOINT;

// Required on every subscription request per the AEC Data Model "Subscribe to Element Group
// Extraction Status Events" tutorial. Without it the server treats the request as a standard
// GraphQL query and does not stream events.
const SUBSCRIPTION_ACCEPT_HEADER = 'multipart/mixed;subscriptionSpec=1.0, application/json';

export async function query(gqlQuery, variables) {
  const token = await getValidAccessToken();
  const res = await fetch(AECDM_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: gqlQuery, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

// Opens a GraphQL subscription. The response is a multipart/mixed HTTP stream rather than a
// single JSON payload — the Accept header above is what tells the server to stream instead of
// answering as a normal query. The boundary token is read from the response's own Content-Type
// header rather than assumed, falling back to "graphql" (every tutorial example uses that
// literal marker, but a real server is free to negotiate a different one).
export async function openSubscription(gqlSubscription, variables, signal) {
  const token = await getValidAccessToken();
  const res = await fetch(AECDM_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: SUBSCRIPTION_ACCEPT_HEADER,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: gqlSubscription, variables }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Subscription request failed with status ${res.status}${text ? `: ${text}` : ''}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const boundaryMatch = contentType.match(/boundary=("?)([^;"]+)\1/i);
  const boundary = boundaryMatch ? boundaryMatch[2] : 'graphql';

  return { stream: Readable.fromWeb(res.body), boundary };
}
