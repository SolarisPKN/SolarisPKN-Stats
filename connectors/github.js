// ================================================================
// connectors/github.js
// ================================================================
// Conector para la API de GitHub
// Obtiene métricas de un repositorio: estrellas, forks, issues, watchers
// ================================================================

module.exports = {
  // Identificador único de la plataforma
  id: 'github',

  // Horas en las que se debe ejecutar este conector (formato 0-23)
  // [0, 5, 11, 17, 23] = 00:00, 05:00, 11:00, 17:00, 23:00
  hours: [0, 5, 11, 17, 23],

  /**
   * Obtiene métricas de un repositorio de GitHub
   * @param {string} projectId - ID del proyecto (nombre del repositorio)
   * @param {string} projectUrl - URL del proyecto desde registry.json (no se usa acá, github.js arma su propia URL de API)
   * @param {object} env - Variables de entorno del Worker
   * @returns {object} Métricas del repositorio
   */
  async fetchData(projectId, projectUrl, env) {
    // Construir URL de la API de GitHub
    // Asumimos que el repositorio está en la organización SolarisPKN
    const repoName = projectId; // El ID del proyecto es el nombre del repo
    const url = `https://api.github.com/repos/SolarisPKN/${repoName}`;

    // Hacer la petición a GitHub
    const response = await fetch(url, {
      headers: {
        // Usar token de GitHub para aumentar el límite de rate limit
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'SolarisPKN-Stats/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    // Verificar si la petición fue exitosa
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} - ${response.statusText}`);
    }

    // Parsear la respuesta
    const data = await response.json();

    // Extraer solo las métricas que nos interesan
    return {
      stars: data.stargazers_count || 0,
      forks: data.forks_count || 0,
      issues: data.open_issues_count || 0,
      watchers: data.watchers_count || 0,
      // Opcional: puedes añadir más campos si quieres
      // size: data.size,
      // language: data.language,
      // lastPush: data.pushed_at,
    };
  }
};