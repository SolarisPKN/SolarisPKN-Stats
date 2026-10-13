'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DAILY_CAPS, analyzePlan, validateConnectorPolicies } = require('../quota-policy.js');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8'));

function loadConnectors() {
  return Object.fromEntries(fs.readdirSync(path.join(root, 'connectors'))
    .filter(x => x.endsWith('.js'))
    .map(x => { const c = require(path.join(root, 'connectors', x)); return [c.id, c] }));
}
function buildPlan(projects, connectors) {
  const plan = {};
  projects.forEach((p, index) => {
    p.platforms.forEach(id => {
      const c = connectors[id];
      for (const hour of c.hours) {
        const scheduled = (hour + index % (c.spreadWindow || 1)) % 24;
        (plan[scheduled] ||= {})[id] ||= [];
        plan[scheduled][id].push({ id: p.id });
      }
    });
  });
  return plan;
}
test('all connectors have reviewed quotas, evenly-spaced hours and bounded request costs', () => {
  const connectors = loadConnectors();
  assert.doesNotThrow(() => validateConnectorPolicies(connectors));
  const plan = buildPlan(registry.projects, connectors);
  const report = analyzePlan(plan, registry.projects, connectors);
  assert.ok(Object.values(report.byHour).every(n => n <= 39));
  assert.ok(Object.entries(report.byConnector).every(([id, n]) => n <= DAILY_CAPS[id]));
  assert.ok(report.byConnector['youtube-public'] <= 2);
  assert.ok(report.byConnector['twitch-public'] <= 4);
});

test('quota policy rejects a burst above the Worker Free safe budget', () => {
  const c = { github: { id: 'github', hours: [0], maxDailyCalls: 1, externalRequests: 1 } };
  const projects = Array.from({ length: 20 }, (_, i) => ({
    id: 'repo' + i, platforms: ['github']
  }));
  const plan = { 0: { github: projects } };
  assert.throws(() => analyzePlan(plan, projects, c), /estimated external requests/);
});

test('YouTube connector uses one channels.list call and preserves public aggregate stats', async () => {
  const connector = require('../connectors/youtube-public.js');
  const previous = global.fetch;
  let calls = 0;
  try {
    global.fetch = async url => {
      calls++;
      const req = new URL(url);
      assert.equal(req.hostname, 'www.googleapis.com');
      assert.equal(req.searchParams.get('forHandle'), '@SolarisPKN');
      assert.equal(req.searchParams.get('part'), 'statistics,snippet');
      return { ok: true, json: async () => ({
        items: [{ id: 'UC-test', snippet: { title: 'SolarisPKN' },
          statistics: { subscriberCount: '123', viewCount: '5000', videoCount: '11' } }]
      }) };
    };
    const data = await connector.fetchData('solarispkn-livetools',
      { youtubeHandle: '@SolarisPKN' }, { YOUTUBE_API_KEY: 'test-only' });
    assert.equal(data.views, 5000);
    assert.equal(data.subscribers, 123);
    assert.equal(calls, 1);
  } finally { global.fetch = previous; }
});

test('Twitch connector obtains an app token then fetches stream without a user token', async () => {
  const c = require('../connectors/twitch-public.js');
  const previous = global.fetch;
  const urls = [];
  try {
    global.fetch = async (url, options) => {
      urls.push(String(url));
      if (String(url).includes('/oauth2/token')) {
        assert.equal(options.method, 'POST');
        return { ok: true, json: async () => ({ access_token: 'mock-app-token', expires_in: 3600 }) };
      }
      assert.equal(options.headers.Authorization, 'Bearer mock-app-token');
      return { ok: true, headers: { get: () => '790' },
        json: async () => ({ data: [{ type: 'live', viewer_count: 23, game_name: 'Minecraft' }] }) };
    };
    const info = await c.fetchData('solarispkn-livetools',
      { twitchLogin: 'SolarisPKN' }, { TWITCH_CLIENT_ID: 'public-test', TWITCH_CLIENT_SECRET: 'private-test' });
    assert.equal(info.live, true);
    assert.equal(info.viewers, 23);
    assert.equal(urls.length, 2);
    assert.match(urls[0], /^https:\/\/id\.twitch\.tv/);
    assert.match(urls[1], /^https:\/\/api\.twitch\.tv/);
  } finally { global.fetch = previous; }
});

test('Worker Analytics makes one account query and marks counts sampled', async () => {
  const c = require('../connectors/cloudflare-workers.js');
  const previous = global.fetch;
  try {
    global.fetch = async (url, options) => {
      const q = JSON.parse(options.body);
      assert.equal(q.variables.scriptName, 'solarispkn-stats');
      assert.match(q.query, /workersInvocationsAdaptive/);
      return { ok: true, json: async () => ({
        data: { viewer: { accounts: [{ workersInvocationsAdaptive: [
          { sum: { requests: 10, errors: 1, subrequests: 4 } }
        ] }] } }
      }) };
    };
    const data = await c.fetchData('solarispkn-stats',
      { workerScript: 'solarispkn-stats' },
      { CF_ACCOUNT_ID: 'test-account', CF_WORKERS_ANALYTICS_TOKEN: 'test-token' });
    assert.equal(data.sampled, true);
    assert.equal(data.sampledRequests, 10);
    assert.equal(data.sampledRecords, 1);
  } finally { global.fetch = previous; }
});

test('R2 connector sends HEAD only to explicitly approved public object', async () => {
  const c = require('../connectors/r2-public-health.js');
  const previous = global.fetch;
  let calls = 0;
  try {
    global.fetch = async (url, options) => {
      calls++;
      assert.equal(options.method, 'HEAD');
      return { status: 200, headers: { get: key =>
        key === 'content-length' ? '230' : null } };
    };
    await assert.rejects(() => c.fetchData('x', {
      r2PublicUrl: 'https://transport-data.solarispkn.com.ar/secret.json'
    }));
    assert.equal(calls, 0);
    const data = await c.fetchData('solarispkn-transport', {
      r2PublicUrl: 'https://transport-data.solarispkn.com.ar/current.json'
    });
    assert.equal(data.reachable, true);
    assert.equal(data.objectBytes, 230);
    assert.equal(calls, 1);
  } finally { global.fetch = previous; }
});
