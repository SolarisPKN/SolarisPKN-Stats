// Public R2-object health via HTTP HEAD. Never lists buckets or downloads data.
module.exports = {
  id: 'r2-public-health',
  hours: [4, 16],
  externalRequests: 1,
  maxDailyCalls: 2,
  async fetchData(projectId, task) {
    const endpoint = new URL(task.r2PublicUrl || '');
    if (endpoint.protocol !== 'https:' ||
      endpoint.hostname !== 'transport-data.solarispkn.com.ar' ||
      endpoint.pathname !== '/current.json' ||
      endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
      throw new Error('R2 health is restricted to an approved public object');
    }
    const response = await fetch(endpoint.toString(), {
      method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000)
    });
    return {
      reachable: response.status === 200,
      httpStatus: response.status,
      lastModified: response.headers?.get?.('last-modified') || null,
      objectBytes: Number(response.headers?.get?.('content-length')) || null,
      checkedAt: new Date().toISOString(),
      method: 'HEAD',
      source: 'public R2 custom domain, not bucket administration'
    };
  }
};
