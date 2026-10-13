// Public-repository GitHub Actions health. Read-only; never fetches logs or secrets.
module.exports = {
  id: 'github-actions',
  hours: [3, 15],
  spreadWindow: 6,
  async fetchData(projectId, task, env) {
    const token = env.GITHUB_TOKEN_READ;
    if (!token) throw new Error('GITHUB_TOKEN_READ is required');
    const url = 'https://api.github.com/repos/SolarisPKN/' +
      encodeURIComponent(projectId) + '/actions/runs?per_page=30&exclude_pull_requests=false';
    const response = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'SolarisPKN-Stats/2.0',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) {
      // Do not propagate raw API responses; they may contain sensitive metadata.
      throw new Error('GitHub Actions API returned HTTP ' + response.status);
    }
    const json = await response.json();
    const runs = Array.isArray(json.workflow_runs) ? json.workflow_runs : [];
    const latest = runs[0] || null;
    const completed = runs.filter(r => r.status === 'completed');
    const succeeded = completed.filter(r => r.conclusion === 'success');
    const failed = completed.filter(r => r.conclusion === 'failure');
    const relevant = r => r ? {
      id: r.id,
      workflow: r.name,
      event: r.event,
      status: r.status,
      conclusion: r.conclusion,
      startedAt: r.run_started_at || r.created_at,
      completedAt: r.updated_at,
      url: r.html_url
    } : null;
    // Preserve independent workflow states. A healthy schedules update must not
    // mask a failed live deployment in the same repository.
    const byWorkflow = new Map();
    for (const run of runs) {
      const key = String(run.workflow_id || run.name || 'unknown');
      let state = byWorkflow.get(key);
      if (!state) {
        state = { workflow: run.name || 'unknown', latest: relevant(run),
          latestSuccess: null, latestFailure: null };
        byWorkflow.set(key, state);
      }
      if (run.conclusion === 'success' && !state.latestSuccess)
        state.latestSuccess = relevant(run);
      if (run.conclusion === 'failure' && !state.latestFailure)
        state.latestFailure = relevant(run);
    }
    return {
      workflows: [...byWorkflow.values()],
      sampleSize: runs.length,
      totalRuns: Number.isFinite(json.total_count) ? json.total_count : null,
      completed: completed.length,
      successful: succeeded.length,
      failed: failed.length,
      inProgress: runs.filter(r => r.status !== 'completed').length,
      latest: relevant(latest),
      latestSuccess: relevant(succeeded[0] || null),
      latestFailure: relevant(failed[0] || null)
    };
  }
};
