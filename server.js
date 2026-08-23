import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getAuthorizeUrl,
  exchangeCodeForToken,
  isAuthenticated,
  getUserProfile,
  logout,
} from './src/auth.js';
import { getHubs, getProjects } from './src/dataManagementClient.js';
import {
  getElementsByElementGroup,
  getDiffAgainstLatest,
  getExtractionStatusPolling,
} from './src/aecdmClient.js';
import { runSubscriptionSession, killUpstream, stopSession } from './src/subscriptionSession.js';
import { EXTRACTION_STATUS_BY_FILE_URN, EXTRACTION_STATUS_BY_PROJECT } from './src/queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 3-legged OAuth ---
app.get('/api/auth/login', (req, res) => res.redirect(getAuthorizeUrl()));

app.get('/api/auth/callback', async (req, res) => {
  try {
    await exchangeCodeForToken(req.query.code);
    res.redirect('/');
  } catch (err) {
    res.status(500).send(`Auth failed: ${err.message}`);
  }
});

app.get('/api/auth/logout', (req, res) => {
  logout();
  res.redirect('/');
});

app.get('/api/auth/profile', async (req, res) => {
  if (!isAuthenticated()) return res.status(401).end();
  try {
    const profile = await getUserProfile();
    res.json({ name: profile.name ?? profile.email ?? 'Autodesk user' });
  } catch {
    res.status(401).end();
  }
});

// --- Hub / project browsing (Data Management API) ---
app.get('/api/hubs', async (req, res) => {
  try {
    res.json(await getHubs());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hubs/:hubId/projects', async (req, res) => {
  try {
    res.json(await getProjects(req.params.hubId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The AEC Data Model subscription expects accProjectId without the "b." prefix that Data
// Management API project ids carry.
function toAecProjectId(dataManagementProjectId) {
  return dataManagementProjectId.replace(/^b\./, '');
}

function setupSse(res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
}

function sendSse(res, event) {
  res.write(`data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`);
}

// --- Subscriptions: one SSE stream per browser EventSource, relaying every parsed multipart
// part (keep-alive/payload/unparsed/reconnect/error) straight through. The browser owns the
// narrative logic (deciding what a SUCCESS event means), the server just relays. ---
app.get('/api/subscriptions/file/stream', async (req, res) => {
  if (!isAuthenticated()) return res.status(401).end();
  const { accProjectId, fileUrn, clientId } = req.query;
  setupSse(res);
  req.on('close', () => stopSession(clientId));
  await runSubscriptionSession(
    clientId,
    EXTRACTION_STATUS_BY_FILE_URN,
    { input: { accProjectId: toAecProjectId(accProjectId), fileUrn } },
    (event) => sendSse(res, event)
  );
  res.end();
});

app.get('/api/subscriptions/project/stream', async (req, res) => {
  if (!isAuthenticated()) return res.status(401).end();
  const { accProjectId, clientId } = req.query;
  setupSse(res);
  req.on('close', () => stopSession(clientId));
  await runSubscriptionSession(
    clientId,
    EXTRACTION_STATUS_BY_PROJECT,
    { input: { accProjectId: toAecProjectId(accProjectId) } },
    (event) => sendSse(res, event)
  );
  res.end();
});

app.post('/api/subscriptions/kill', (req, res) => {
  killUpstream(req.body.clientId);
  res.status(202).end();
});

// --- Element group queries, fired by the browser once it decides a SUCCESS event matters ---
app.get('/api/element-groups/:id/elements', async (req, res) => {
  try {
    res.json(await getElementsByElementGroup(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/element-groups/:id/diff', async (req, res) => {
  try {
    res.json(await getDiffAgainstLatest(req.params.id, Number(req.query.startVersion)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/element-groups/extraction-status', async (req, res) => {
  try {
    res.json(await getExtractionStatusPolling(req.query.fileUrn));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`AECDM subscription demo running on http://localhost:${PORT}`);
});
