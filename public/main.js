const els = {
    login: document.getElementById('login'),
    hubSelect: document.getElementById('hubSelect'),
    projectSelect: document.getElementById('projectSelect'),
    fileUrnInput: document.getElementById('fileUrnInput'),
    subscribeProject: document.getElementById('subscribeProject'),
    subscribeFile: document.getElementById('subscribeFile'),
    stopSubscription: document.getElementById('stopSubscription'),
    simulateDisconnect: document.getElementById('simulateDisconnect'),
    compareWithPolling: document.getElementById('compareWithPolling'),
    fileList: document.getElementById('fileList'),
    tracked: document.getElementById('tracked'),
    trackedSummary: document.getElementById('trackedSummary'),
    elements: document.getElementById('elements'),
    elementsResult: document.getElementById('elementsResult'),
    diff: document.getElementById('diff'),
    diffResult: document.getElementById('diffResult'),
    eventLog: document.getElementById('eventLog'),
    pollingComparison: document.getElementById('pollingComparison'),
    pollingStats: document.getElementById('pollingStats'),
    pollingLog: document.getElementById('pollingLog'),
};

let selectedHubId = null;
let selectedProjectId = null;

let projectEventSource = null;
let fileEventSource = null;
let projectClientId = null;
let fileClientId = null;

let pollingTimer = null;
let pollingStartedAt = null;
let pollingRequestCount = 0;

// Files discovered via the project-wide subscription (or the direct file subscription), keyed
// by elementGroup id. `extractionCount` distinguishes "first extraction we've ever seen for this
// file" from "this file changed again".
const discoveredFiles = new Map();
let trackedFile = null; // { elementGroupId, name, lastVersionNumber, lastWipVersionNumber }
let pendingTrackFileUrn = null; // set when "Subscribe by File" is used before we know the elementGroupId

function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function appendLog(container, event) {
    const div = document.createElement('div');
    div.className = `log-entry type-${event.type}`;
    const ts = new Date(event.timestamp ?? Date.now()).toLocaleTimeString();
    div.innerHTML = `<span class="ts">${ts}</span>${escapeHtml(JSON.stringify(event))}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// --- Hub / project ---
async function loadHubs() {
    const resp = await fetch('/api/hubs');
    if (!resp.ok) return;
    const hubs = await resp.json();
    els.hubSelect.innerHTML = '<option value="">Select a hub…</option>' +
        hubs.map((h) => `<option value="${h.id}">${escapeHtml(h.name)}</option>`).join('');
}

async function loadProjects(hubId) {
    els.projectSelect.innerHTML = '<option value="">Loading…</option>';
    els.projectSelect.disabled = true;
    const resp = await fetch(`/api/hubs/${encodeURIComponent(hubId)}/projects`);
    const projects = resp.ok ? await resp.json() : [];
    els.projectSelect.innerHTML = '<option value="">Select a project…</option>' +
        projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    els.projectSelect.disabled = false;
}

function resetDemoState() {
    discoveredFiles.clear();
    trackedFile = null;
    pendingTrackFileUrn = null;
    renderFileList();
    els.tracked.classList.add('hidden');
    els.elements.classList.add('hidden');
    els.diff.classList.add('hidden');
    els.eventLog.innerHTML = '';
}

els.hubSelect.addEventListener('change', async () => {
    selectedHubId = els.hubSelect.value || null;
    selectedProjectId = null;
    stopAllSubscriptions();
    resetDemoState();
    els.projectSelect.innerHTML = '<option value="">Select a project…</option>';
    els.projectSelect.disabled = true;
    updateSubscribeButtons();
    if (selectedHubId) await loadProjects(selectedHubId);
});

els.projectSelect.addEventListener('change', () => {
    selectedProjectId = els.projectSelect.value || null;
    stopAllSubscriptions();
    resetDemoState();
    updateSubscribeButtons();
});

els.fileUrnInput.addEventListener('input', updateSubscribeButtons);

function updateSubscribeButtons() {
    els.subscribeProject.disabled = !selectedProjectId || !!projectEventSource;
    els.subscribeFile.disabled = !selectedProjectId || !els.fileUrnInput.value.trim() || !!fileEventSource;
    els.stopSubscription.disabled = !projectEventSource && !fileEventSource;
    els.simulateDisconnect.disabled = !projectClientId && !fileClientId;
}

// --- Discovered files list ---
function renderFileList() {
    els.fileList.innerHTML = '';
    if (!discoveredFiles.size) {
        els.fileList.innerHTML = '<p class="hint">No files discovered yet.</p>';
        return;
    }
    for (const file of discoveredFiles.values()) {
        const row = document.createElement('div');
        row.className = 'file-row' + (trackedFile?.elementGroupId === file.id ? ' tracked' : '');
        row.innerHTML = `<span>${escapeHtml(file.name)}</span><span class="meta">v${file.versionNumber ?? '?'} / wip${file.wipVersionNumber ?? '?'} · seen ${file.extractionCount}×</span>`;
        row.addEventListener('click', () => selectFileToTrack(file.id));
        els.fileList.appendChild(row);
    }
}

function selectFileToTrack(id) {
    const file = discoveredFiles.get(id);
    if (!file) return;
    trackedFile = {
        elementGroupId: id,
        name: file.name,
        lastVersionNumber: file.versionNumber,
        lastWipVersionNumber: file.wipVersionNumber,
    };
    els.tracked.classList.remove('hidden');
    els.trackedSummary.textContent = `Tracking "${file.name}" — waiting for the next change to diff against v${file.versionNumber ?? '?'} / wip${file.wipVersionNumber ?? '?'}.`;
    renderFileList();
    fetchAndShowElements(id);
}

// --- Extraction success handling (shared by both subscription modes) ---
function onExtractionSuccess(elementGroup, fallbackFileUrn) {
    const id = elementGroup.id;
    const prior = discoveredFiles.get(id);
    const entry = {
        id,
        name: elementGroup.name,
        fileUrn: elementGroup.alternativeIdentifiers?.fileUrn ?? prior?.fileUrn ?? fallbackFileUrn,
        versionNumber: elementGroup.version?.versionNumber,
        wipVersionNumber: elementGroup.version?.wipVersionNumber,
        extractionCount: (prior?.extractionCount ?? 0) + 1,
    };
    discoveredFiles.set(id, entry);

    if (!trackedFile && pendingTrackFileUrn && entry.fileUrn === pendingTrackFileUrn) {
        pendingTrackFileUrn = null;
        selectFileToTrack(id);
        return;
    }

    renderFileList();

    if (trackedFile?.elementGroupId !== id) return;

    const versionChanged = entry.versionNumber !== trackedFile.lastVersionNumber ||
        entry.wipVersionNumber !== trackedFile.lastWipVersionNumber;
    if (!versionChanged) return;

    const sinceVersion = trackedFile.lastVersionNumber;
    trackedFile.lastVersionNumber = entry.versionNumber;
    trackedFile.lastWipVersionNumber = entry.wipVersionNumber;
    els.trackedSummary.textContent = `"${entry.name}" changed again — now at v${entry.versionNumber ?? '?'} / wip${entry.wipVersionNumber ?? '?'}.`;
    fetchAndShowDiff(id, sinceVersion);
}

async function fetchAndShowElements(id) {
    els.elements.classList.remove('hidden');
    els.elementsResult.textContent = 'Loading elementsByElementGroup…';
    try {
        const resp = await fetch(`/api/element-groups/${encodeURIComponent(id)}/elements`);
        const data = await resp.json();
        els.elementsResult.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        els.elementsResult.textContent = `Failed: ${err.message}`;
    }
}

async function fetchAndShowDiff(id, startVersion) {
    els.diff.classList.remove('hidden');
    els.diffResult.textContent = 'Loading diffElementGroupByVersionWithLatest…';
    try {
        const resp = await fetch(`/api/element-groups/${encodeURIComponent(id)}/diff?startVersion=${encodeURIComponent(startVersion)}`);
        const data = await resp.json();
        els.diffResult.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        els.diffResult.textContent = `Failed: ${err.message}`;
    }
}

// --- Subscriptions ---
function openStream(url, onPayload) {
    const clientId = crypto.randomUUID();
    const source = new EventSource(`${url}&clientId=${clientId}`);
    source.onmessage = (msg) => {
        const event = JSON.parse(msg.data);
        appendLog(els.eventLog, event);
        if (event.type === 'payload') onPayload(event.data);
    };
    source.onerror = () => {
        appendLog(els.eventLog, { type: 'error', message: 'EventSource connection error (browser-side)', timestamp: Date.now() });
    };
    return { source, clientId };
}

els.subscribeProject.addEventListener('click', () => {
    if (!selectedProjectId) return;
    const { source, clientId } = openStream(
        `/api/subscriptions/project/stream?accProjectId=${encodeURIComponent(selectedProjectId)}`,
        (data) => {
            const status = data?.payload?.data?.elementGroupExtractionStatusByProject;
            if (status?.status === 'SUCCESS' && status.elementGroup?.id) {
                onExtractionSuccess(status.elementGroup);
            }
        }
    );
    projectEventSource = source;
    projectClientId = clientId;
    updateSubscribeButtons();
});

els.subscribeFile.addEventListener('click', () => {
    const fileUrn = els.fileUrnInput.value.trim();
    if (!selectedProjectId || !fileUrn) return;
    pendingTrackFileUrn = fileUrn;
    const { source, clientId } = openStream(
        `/api/subscriptions/file/stream?accProjectId=${encodeURIComponent(selectedProjectId)}&fileUrn=${encodeURIComponent(fileUrn)}`,
        (data) => {
            const status = data?.payload?.data?.elementGroupExtractionStatusByFileUrn;
            if (status?.status === 'SUCCESS' && status.elementGroup?.id) {
                onExtractionSuccess(status.elementGroup, fileUrn);
            }
        }
    );
    fileEventSource = source;
    fileClientId = clientId;
    startPollingComparisonIfEnabled(fileUrn);
    updateSubscribeButtons();
});

function stopAllSubscriptions() {
    if (projectEventSource) { projectEventSource.close(); projectEventSource = null; projectClientId = null; }
    if (fileEventSource) { fileEventSource.close(); fileEventSource = null; fileClientId = null; }
    stopPollingComparison();
    updateSubscribeButtons();
}

els.stopSubscription.addEventListener('click', stopAllSubscriptions);

els.simulateDisconnect.addEventListener('click', async () => {
    for (const clientId of [projectClientId, fileClientId].filter(Boolean)) {
        await fetch('/api/subscriptions/kill', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ clientId }),
        });
    }
});

// --- Polling comparison (file mode only, matches the tutorial's legacy polling baseline) ---
function startPollingComparisonIfEnabled(fileUrn) {
    if (!els.compareWithPolling.checked) return;
    els.pollingComparison.classList.remove('hidden');
    els.pollingLog.innerHTML = '';
    pollingRequestCount = 0;
    pollingStartedAt = Date.now();
    renderPollingStats();

    pollingTimer = setInterval(async () => {
        pollingRequestCount++;
        try {
            const resp = await fetch(`/api/element-groups/extraction-status?fileUrn=${encodeURIComponent(fileUrn)}`);
            const data = await resp.json();
            appendLog(els.pollingLog, { type: 'pollingUpdate', data, timestamp: Date.now() });
            if (data?.status === 'SUCCESS' || data?.status === 'FAILED') stopPollingComparison();
        } catch (err) {
            appendLog(els.pollingLog, { type: 'pollingError', message: err.message, timestamp: Date.now() });
        }
        renderPollingStats();
    }, 5000);
}

function stopPollingComparison() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
}

function renderPollingStats() {
    if (!pollingStartedAt) return;
    const elapsedSec = Math.round((Date.now() - pollingStartedAt) / 1000);
    els.pollingStats.textContent = `Polling requests so far: ${pollingRequestCount} · Elapsed: ${elapsedSec}s · Compare this against the subscription's single connection + event log above.`;
}

// --- Auth ---
async function init() {
    try {
        const resp = await fetch('/api/auth/profile');
        if (resp.ok) {
            const user = await resp.json();
            els.login.innerText = `Logout (${user.name})`;
            els.login.onclick = () => window.location.replace('/api/auth/logout');
            await loadHubs();
        } else {
            els.login.innerText = 'Login';
            els.login.onclick = () => window.location.replace('/api/auth/login');
        }
        els.login.style.visibility = 'visible';
    } catch (err) {
        alert('Could not initialize the application. See console for more details.');
        console.error(err);
    }
}

renderFileList();
init();
