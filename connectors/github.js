// ================================================================
// connectors/github.js
// ================================================================
// Conector para la API GraphQL (v4) de GitHub.
// Trae TODAS las métricas del repo en una sola petición HTTP, en vez
// de encadenar varios GET a la REST API.
// Usa env.GITHUB_TOKEN_READ (solo lectura, todos los repos) — NO el
// mismo token que usan getFromGitHub/saveToGitHub en compile-worker.js,
// que es env.GITHUB_TOKEN_WRITE (R&W, scopeado solo a SolarisPKN-Stats).
// ================================================================

module.exports = {
  // Identificador único de la plataforma
  id: 'github',

  // Horas en las que se debe ejecutar este conector (formato 0-23)
  hours: [0, 5, 11, 17, 23],

  /**
   * Obtiene métricas de un repositorio de GitHub vía GraphQL (1 sola petición)
   * @param {string} projectId - ID del proyecto (nombre del repositorio)
   * @param {string} projectUrl - URL del proyecto desde registry.json (no se usa acá)
   * @param {object} env - Variables de entorno del Worker
   * @returns {object} Métricas del repositorio
   */
  async fetchData(projectId, projectUrl, env) {
    const owner = 'SolarisPKN';
    const repoName = projectId; // El ID del proyecto es el nombre del repo

    // Una sola query trae: stars, forks, issues (abiertos y cerrados),
    // PRs (abiertos y mergeados), releases, licencia, lenguajes,
    // topics, último commit, total de commits, y el rate limit gastado.
    const query = `
      query RepoStats($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          name
          description
          homepageUrl
          createdAt
          updatedAt
          pushedAt
          diskUsage
          isArchived
          isFork
          isPrivate
          stargazerCount
          forkCount
          watchers { totalCount }
          openIssues: issues(states: OPEN) { totalCount }
          closedIssues: issues(states: CLOSED) { totalCount }
          openPRs: pullRequests(states: OPEN) { totalCount }
          mergedPRs: pullRequests(states: MERGED) { totalCount }
          releases { totalCount }
          licenseInfo { name spdxId }
          primaryLanguage { name color }
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            totalSize
            edges {
              size
              node { name color }
            }
          }
          repositoryTopics(first: 10) {
            nodes { topic { name } }
          }
          defaultBranchRef {
            name
            target {
              ... on Commit {
                oid
                message
                committedDate
                history { totalCount }
              }
            }
          }
        }
        rateLimit { limit cost remaining resetAt }
      }
    `;

    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        // Token de solo lectura, con acceso a todos los repos (públicos
        // siempre incluidos; privados necesitan estar en el scope del PAT)
        'Authorization': `Bearer ${env.GITHUB_TOKEN_READ}`,
        'User-Agent': 'SolarisPKN-Stats/1.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        variables: { owner, name: repoName }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub GraphQL API error: ${response.status} - ${errorText}`);
    }

    const json = await response.json();

    // GraphQL devuelve 200 OK incluso con errores — hay que chequear
    // el array "errors" del body además del status HTTP.
    if (json.errors && json.errors.length > 0) {
      const messages = json.errors.map(e => e.message).join('; ');
      throw new Error(`GitHub GraphQL error: ${messages}`);
    }

    const repo = json.data && json.data.repository;
    if (!repo) {
      throw new Error(`Repositorio no encontrado o sin acceso: ${owner}/${repoName}`);
    }

    const commit = repo.defaultBranchRef && repo.defaultBranchRef.target;
    const languageEdges = (repo.languages && repo.languages.edges) || [];
    const topicNodes = (repo.repositoryTopics && repo.repositoryTopics.nodes) || [];

    return {
      // --- Métricas clásicas (mismos nombres que la versión REST) ---
      stars: repo.stargazerCount || 0,
      forks: repo.forkCount || 0,
      issues: (repo.openIssues && repo.openIssues.totalCount) || 0,
      // OJO: en REST, watchers_count era en realidad un alias de
      // stargazers_count (quirk histórico de GitHub). Acá en GraphQL
      // watchers.totalCount es la cuenta REAL de gente siguiendo
      // notificaciones del repo — va a ser un número distinto (y casi
      // siempre más chico) al que veías antes en Stats.json.
      watchers: (repo.watchers && repo.watchers.totalCount) || 0,

      // --- Extra que trae la GraphQL "gratis" en la misma petición ---
      issuesClosed: (repo.closedIssues && repo.closedIssues.totalCount) || 0,
      pullRequestsOpen: (repo.openPRs && repo.openPRs.totalCount) || 0,
      pullRequestsMerged: (repo.mergedPRs && repo.mergedPRs.totalCount) || 0,
      releases: (repo.releases && repo.releases.totalCount) || 0,
      description: repo.description || null,
      homepageUrl: repo.homepageUrl || null,
      license: (repo.licenseInfo && (repo.licenseInfo.spdxId || repo.licenseInfo.name)) || null,
      sizeKB: repo.diskUsage || 0,
      isArchived: !!repo.isArchived,
      isFork: !!repo.isFork,
      primaryLanguage: (repo.primaryLanguage && repo.primaryLanguage.name) || null,
      languages: languageEdges.map(e => ({
        name: e.node.name,
        color: e.node.color,
        bytes: e.size
      })),
      topics: topicNodes.map(n => n.topic.name),
      defaultBranch: (repo.defaultBranchRef && repo.defaultBranchRef.name) || null,
      totalCommits: (commit && commit.history && commit.history.totalCount) || 0,
      lastCommit: commit ? {
        sha: commit.oid,
        message: commit.message,
        date: commit.committedDate
      } : null,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
      pushedAt: repo.pushedAt,

      // Costo de la query en puntos de rate limit de GraphQL (5000/hora
      // el pool, cada campo/conexión cuesta puntos distintos) — útil
      // para ver en los logs si en algún momento nos acercamos al límite.
      _rateLimit: json.data.rateLimit
    };
  }
};
