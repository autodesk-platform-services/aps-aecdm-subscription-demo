import { getValidAccessToken } from './auth.js';

const BASE = 'https://developer.api.autodesk.com';

async function dmGet(path) {
  const token = await getValidAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Data Management request failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function toSummary(node) {
  return { id: node.id, name: node.attributes?.name };
}

export async function getHubs() {
  const json = await dmGet('/project/v1/hubs');
  return json.data.map(toSummary);
}

export async function getProjects(hubId) {
  const json = await dmGet(`/project/v1/hubs/${hubId}/projects`);
  return json.data.map(toSummary);
}
