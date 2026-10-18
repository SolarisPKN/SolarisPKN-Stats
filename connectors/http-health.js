// Read-only, bounded availability check for public SolarisPKN websites.
// No generic URL fetch: this connector rejects non-HTTPS and off-domain hosts.
module.exports = {
  id: 'http-health',
  hours: [5, 11, 17, 23],
  externalRequests: 1,
  maxDailyCalls: 4,
  async fetchData(projectId, task) {
    if (!task?.url) throw new Error('HTTP health requires a public URL');
    const u = new URL(task.url);
    if (u.protocol !== 'https:' ||
        !(u.hostname === 'solarispkn.com.ar' || u.hostname.endsWith('.solarispkn.com.ar')) ||
        u.username || u.password || (u.port && u.port !== '443')) {
      throw new Error('HTTP health destination is not an approved public SolarisPKN HTTPS host');
    }
    const started = Date.now();
    const response = await fetch(u.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'text/html,application/json' }
    });
    // We only need the status. Never collect page HTML or personal content.
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
    const code = response.status;
    return {
      reachable: code >= 200 && code < 400,
      httpStatus: code,
      latencyMs: Math.max(0, Date.now() - started),
      checkedAt: new Date().toISOString(),
      hostname: u.hostname
    };
  }
};
