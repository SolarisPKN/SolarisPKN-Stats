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
  assert.match(built, /await createDailySnapshot\(env, hour\)/);
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
    assert.equal(Object.hasOwn(result, 'logs'), false);
  } finally { global.fetch = previousFetch; }
});
