'use strict';
// Compile-time discovery ONLY. Uses the public GitHub user repository API;
// it never lists private repositories, touches git remotes, or mutates GitHub.
const OWNER = 'SolarisPKN';
const EXCLUDED = new Set([
  'skills-introduction-to-github' // EXO training exercise; not ecosystem telemetry
]);
async function discoverPublicRepos(projects, fetcher = fetch) {
  const registered = new Set(projects.map(p => p.id.toLowerCase()));
  const discovered = [];
  let page = 1;
  while (page <= 5) {
    const url = 'https://api.github.com/users/' + OWNER +
      '/repos?type=owner&per_page=100&page=' + page;
    const response = await fetcher(url, {
      headers: {
        'User-Agent': 'SolarisPKN-Stats/2.0',
        Accept: 'application/vnd.github+json'
      }
    });
    if (!response.ok) throw new Error('Public GitHub discovery HTTP ' + response.status);
    const repos = await response.json();
    if (!Array.isArray(repos)) throw new Error('Invalid GitHub public repository listing');
    for (const repo of repos) {
      if (repo.owner?.login?.toLowerCase() !== OWNER.toLowerCase() ||
          repo.private !== false || repo.visibility !== 'public' ||
          repo.archived || repo.disabled || repo.fork) continue;
      const id = String(repo.name || '').toLowerCase();
      if (!/^[a-z0-9._-]{1,100}$/.test(id) || EXCLUDED.has(id) ||
          registered.has(id)) continue;
      projects.push({ id, platforms: ['github'] });
      registered.add(id);
      discovered.push(id);
    }
    if (repos.length < 100) break;
    page++;
  }
  if (page > 5) throw new Error('Public repository pagination exceeded safety limit');
  return discovered;
}
module.exports = { discoverPublicRepos };
