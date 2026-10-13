'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8'));

test('registered projects contain only reviewed public ecosystem repos', () => {
  const ids = registry.projects.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const name of ['solarispkn-ia', 'solarispkn-engineer',
    'solarispkn-transport', 'solarispkn-arts',
    'solarispkn-os', 'solarispkn-converter']) assert.ok(ids.includes(name));
  assert.ok(!ids.includes('skills-introduction-to-github'));
});

test('dry-run generates syntactically valid Worker within Free request budget', () => {
  const run = spawnSync(process.execPath, ['compile-worker.js'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, STATS_BUILD_ONLY: 'true' }
  });
  assert.equal(run.status, 0, (run.stdout || '') + '\n' + (run.stderr || ''));
  const built = fs.readFileSync(path.join(root, 'worker-built.js'), 'utf8');
  const checked = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    cwd: root, encoding: 'utf8', input: built
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(built, /const c_github_actionsConnector/);
  assert.match(built, /Manual collection disabled/);
  assert.ok(built.includes('await createDailySnapshot(env, hour, scheduledAt)'), 'scheduled snapshot invocation');
  assert.ok(built.includes('event.scheduledTime'), 'cron must use scheduled event time');
  assert.ok(!built.includes('now.getMinutes()'), 'delayed cron must not be dropped');
  const planMatch = built.match(/const EXECUTION_PLAN = ([\s\S]*?);\nconst SNAPSHOT_PROJECTS/);
  assert.ok(planMatch, 'compiled execution plan must be embedded');
  const plan = JSON.parse(planMatch[1]).plan;
  for (let hour = 0; hour < 24; hour++) {
    const count = Object.values(plan[hour] || {}).reduce((n, tasks) => n + tasks.length, 0);
    const snapshots = registry.projects.filter((_, i) => i % 24 === hour).length;
    assert.ok(3 * (count + snapshots) <= 39, 'hour ' + hour + ' exceeds budget');
  }
});

test('Cloudflare connector filters traffic by hostname, not only zone', async () => {
  const connector = require('../connectors/cloudflare.js');
  const previousFetch = global.fetch;
  let request;
  try {
    global.fetch = async (url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({
        data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [
          { count: 9, sum: { visits: 3, edgeResponseBytes: 120 } }
        ] }] } }
      }) };
    };
    const result = await connector.fetchData('solarispkn-labs', {
      url: 'https://labs.solarispkn.com.ar', zoneId: 'zone-test'
    }, { CF_API_TOKEN: 'test-only' });
    assert.match(request.query, /clientRequestHTTPHost: \$hostname/);
    assert.equal(request.variables.hostname, 'labs.solarispkn.com.ar');
    assert.equal(result.hostname, 'labs.solarispkn.com.ar');
    assert.equal(result.visits, 3);
    assert.equal(result.requests, 9);
  } finally { global.fetch = previousFetch; }
});

test('GitHub Actions connector returns aggregate run health without logs', async () => {
  const connector = require('../connectors/github-actions.js');
  const previousFetch = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.match(url, /actions\/runs/);
      assert.equal(options.headers.Authorization, 'Bearer test-only');
      return { ok: true, json: async () => ({
        total_count: 2, workflow_runs: [
          { id: 2, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/test/run2' },
          { id: 1, name: 'CI', status: 'completed', conclusion: 'success', html_url: 'https://github.com/test/run1' }
        ]
      }) };
    };
    const result = await connector.fetchData('solarispkn-ia', {}, { GITHUB_TOKEN_READ: 'test-only' });
    assert.equal(result.failed, 1);
    assert.equal(result.successful, 1);
    assert.equal(result.latest.conclusion, 'failure');
    assert.equal(result.latestSuccess.id, 1);
    assert.equal(result.workflows.length, 1);
    assert.equal(result.workflows[0].latestFailure.id, 2);
    assert.equal(Object.hasOwn(result, 'logs'), false);
  } finally { global.fetch = previousFetch; }
});

test('public discovery excludes nonpublic, forks and unrelated training repos', async () => {
  const { discoverPublicRepos } = require('../discover-public-repos.js');
  const projects = [{ id: 'existing-public', platforms: ['github'] }];
  const response = { ok: true, json: async () => [
    { name: 'Existing-Public', owner: { login: 'SolarisPKN' }, private: false, visibility: 'public' },
    { name: 'New-Public', owner: { login: 'SolarisPKN' }, private: false, visibility: 'public' },
    { name: 'Private-Sandbox', owner: { login: 'SolarisPKN' }, private: true, visibility: 'private' },
    { name: 'fork-test', owner: { login: 'SolarisPKN' }, private: false, visibility: 'public', fork: true },
    { name: 'skills-introduction-to-github', owner: { login: 'SolarisPKN' }, private: false, visibility: 'public' }
  ] };
  const result = await discoverPublicRepos(projects, async () => response);
  assert.deepEqual(result, ['new-public']);
  assert.equal(projects.length, 2);
  assert.deepEqual(projects[1].platforms, ['github']);
});

test('HTTP health only checks approved public HTTPS hosts', async () => {
  const connector = require('../connectors/http-health.js');
  const previousFetch = global.fetch;
  let called = 0;
  try {
    global.fetch = async () => {
      called++;
      return { status: 200, body: { cancel: async () => {} } };
    };
    await assert.rejects(() => connector.fetchData('demo', { url: 'http://localhost:4317' }));
    await assert.rejects(() => connector.fetchData('demo', { url: 'https://example.com/' }));
    assert.equal(called, 0);
    const result = await connector.fetchData('solarispkn-labs',
      { url: 'https://labs.solarispkn.com.ar/' });
    assert.equal(result.reachable, true);
    assert.equal(result.hostname, 'labs.solarispkn.com.ar');
    assert.equal(called, 1);
  } finally { global.fetch = previousFetch; }
});

test('generated Worker stops further GitHub GraphQL calls after HTTP 429', async () => {
  const built = fs.readFileSync(path.join(root, 'worker-built.js'), 'utf8');
  const match = built.match(/const EXECUTION_PLAN = ([\s\S]*?);\nconst SNAPSHOT_PROJECTS/);
  assert.ok(match);
  const plan = JSON.parse(match[1]).plan;
  const hour = Number(Object.keys(plan).find(h => (plan[h].github || []).length >= 2));
  assert.ok(Number.isInteger(hour));
  const uri = 'data:text/javascript;base64,' + Buffer.from(built).toString('base64');
  const mod = await import(uri);
  const previous = global.fetch;
  let graphqlCalls = 0;
  try {
    global.fetch = async url => {
      if (String(url) === 'https://api.github.com/graphql') {
        graphqlCalls++;
        return { ok: false, status: 429 };
      }
      return { ok: false, status: 404 };
    };
    const event = { scheduledTime: Date.UTC(2026, 9, 13, hour) };
    await assert.rejects(() => mod.default.scheduled(event,
      { GITHUB_TOKEN_READ: 'mock', GITHUB_TOKEN_WRITE: 'mock' }, {}));
    assert.equal(graphqlCalls, 1, '429 must stop further calls from the same provider');
  } finally { global.fetch = previous; }
});

test('GitHub Actions interprets exhausted 403 quota as a stop signal', async () => {
  const c = require('../connectors/github-actions.js');
  const previous = global.fetch;
  try {
    global.fetch = async () => ({
      status: 403, ok: false, headers: {
        get: key => key === 'x-ratelimit-remaining' ? '0' : null
      }
    });
    await assert.rejects(
      () => c.fetchData('solarispkn-engineer', {}, { GITHUB_TOKEN_READ: 'mock' }),
      e => e.httpStatus === 429
    );
  } finally { global.fetch = previous; }
});
