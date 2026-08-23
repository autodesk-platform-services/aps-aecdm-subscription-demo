import state from './state.js';

const CLIENT_ID = process.env.APS_CLIENT_ID;
const CLIENT_SECRET = process.env.APS_CLIENT_SECRET;
const CALLBACK_URL = process.env.APS_CALLBACK_URL;
const SCOPE = 'data:read';

const AUTHORIZE_URL = 'https://developer.api.autodesk.com/authentication/v2/authorize';
const TOKEN_URL = 'https://developer.api.autodesk.com/authentication/v2/token';

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

function applyTokenResponse(json) {
  state.accessToken = json.access_token;
  state.refreshToken = json.refresh_token ?? state.refreshToken;
  state.expiresAt = Date.now() + (json.expires_in - 60) * 1000;
}

export function getAuthorizeUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    scope: SCOPE,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CALLBACK_URL,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  applyTokenResponse(json);
}

async function refreshAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: state.refreshToken,
    scope: SCOPE,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  applyTokenResponse(json);
}

export async function getValidAccessToken() {
  if (!state.accessToken) throw new Error('Not authenticated — log in via /api/auth/login first');
  if (Date.now() >= state.expiresAt) await refreshAccessToken();
  return state.accessToken;
}

export function isAuthenticated() {
  return Boolean(state.accessToken);
}

export async function getUserProfile() {
  const token = await getValidAccessToken();
  const res = await fetch('https://api.userprofile.autodesk.com/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch user profile: ${res.status}`);
  return res.json();
}

export function logout() {
  state.accessToken = null;
  state.refreshToken = null;
  state.expiresAt = 0;
}
