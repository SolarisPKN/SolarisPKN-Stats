// Read-only sample of Cloudflare Worker invocations via GraphQL.
// The Adaptive dataset is sampled: these values must NEVER be labelled
// as exhaustive 24-hour totals.
module.exports = {
  id: 'cloudflare-workers',
  hours: [6, 18],
  externalRequests: 1,
  maxDailyCalls: 2,
  requiredSecrets: ['CF_WORKERS_ANALYTICS_TOKEN'],
  async fetchData(projectId, task, env) {
    const scriptName = task.workerScript;
    if (!/^[a-z0-9][a-z0-9-]{1,70}$/.test(scriptName || ''))
      throw new Error('workerScript must be explicitly configured');
    const accountId = env.CF_ACCOUNT_ID;
    const token = env.CF_WORKERS_ANALYTICS_TOKEN || env.CF_API_TOKEN;
    if (!accountId || !token) throw new Error('Missing Cloudflare Workers analytics configuration');
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3600000);
    const query = `query WorkerSamples($accountTag: string, $start: string, $end: string, $scriptName: string) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(limit: 100, filter: {
            scriptName: $scriptName,
            datetime_geq: $start,
            datetime_leq: $end
          }) {
            sum { requests errors subrequests }
          }
        }
      }
    }`;
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST', redirect: 'manual',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query, variables: {
          accountTag: accountId, start: start.toISOString(),
          end: end.toISOString(), scriptName
        }
      })
    });
    if (!response.ok) {
      const error = new Error('Cloudflare Workers Analytics HTTP ' + response.status);
      error.httpStatus = response.status;
      throw error;
    }
    const json = await response.json();
    if (json.errors?.length) throw new Error('Cloudflare Workers Analytics GraphQL rejected query');
    const samples = json.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
    if (!Array.isArray(samples)) throw new Error('Worker analytics dataset unavailable');
    return {
      scriptName,
      sampledRecords: samples.length,
      sampledRequests: samples.reduce((n, r) => n + (r.sum?.requests || 0), 0),
      sampledErrors: samples.reduce((n, r) => n + (r.sum?.errors || 0), 0),
      sampledSubrequests: samples.reduce((n, r) => n + (r.sum?.subrequests || 0), 0),
      truncatedPossible: samples.length === 100,
      sampled: true,
      windowHours: 24
    };
  }
};
