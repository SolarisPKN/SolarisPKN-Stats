// ================================================================
// connectors/cloudflare.js
// ================================================================
// Conector para la GraphQL Analytics API de Cloudflare.
// La vieja REST /zones/{id}/analytics/dashboard está migrando a este
// esquema (Cloudflare tiene su propia guía oficial de migración).
//
// Dataset: httpRequestsAdaptiveGroups (no httpRequests1mGroups).
// OJO — a diferencia de lo que pensábamos antes, estos dos datasets
// NO tienen el mismo shape de campos. httpRequests1mGroups (rico: países,
// status codes, tipos de contenido, amenazas) requiere plan Pro+ — en
// zona Free tira "does not have access to the path" (403).
// httpRequestsAdaptiveGroups SÍ está en todos los planes, pero su `sum`
// solo trae 2 campos: `visits` y `edgeResponseBytes` (confirmado contra
// la guía oficial de migración de Cloudflare y varios hilos de su
// comunidad). El total de requests sale de `count`, no de `sum.requests`
// (ese campo no existe acá). Si en algún momento pasás a plan pago,
// volver a httpRequests1mGroups te da mucha más data (países, amenazas,
// browsers, etc.) en la misma única petición.
// ================================================================

module.exports = {
  // Identificador único de la plataforma
  id: 'cloudflare',

  // Horas en las que se debe ejecutar este conector (formato 0-23)
  hours: Array.from({ length: 24 }, (_, i) => i), // [0,1,2,3,...,23]

  /**
   * Obtiene métricas de Cloudflare para una zona específica
   * @param {string} projectId - ID del proyecto (para logs)
   * @param {object} task - Tarea del plan (trae .zoneId, resuelto en build time por compile-worker.js)
   * @param {object} env - Variables de entorno del Worker
   * @returns {object} Métricas de Cloudflare de las últimas 24hs
   */
  async fetchData(projectId, task, env) {
    // ============================================================
    // 1. CONFIGURACIÓN — zona por proyecto, con fallback al global
    // ============================================================

    const zoneId = (task && task.zoneId) || env.CF_ZONE_ID;

    if (!zoneId) {
      throw new Error(
        `No hay Zone ID para "${projectId}": compile-worker.js no pudo resolverlo a partir de su URL en el último deploy. ` +
        `Verificá que el dominio esté en Cloudflare, o configurá CF_ZONE_ID como fallback global en los secrets del Worker.`
      );
    }

    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // ============================================================
    // 2. QUERY GRAPHQL — dataset disponible en plan Free
    // ============================================================

    const query = `
      query ZoneStats($zoneTag: string, $start: Time, $end: Time) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequestsAdaptiveGroups(
              limit: 1
              filter: {
                datetime_geq: $start
                datetime_lt: $end
                requestSource: "eyeball"
              }
            ) {
              count
              sum {
                visits
                edgeResponseBytes
              }
            }
          }
        }
      }
    `;

    // ============================================================
    // 3. HACER LA PETICIÓN
    // ============================================================

    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        variables: {
          zoneTag: zoneId,
          start: since.toISOString(),
          end: now.toISOString()
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudflare GraphQL API error: ${response.status} - ${errorText}`);
    }

    const json = await response.json();

    // GraphQL devuelve 200 OK incluso con errores — hay que chequear
    // el array "errors" del body además del status HTTP.
    if (json.errors && json.errors.length > 0) {
      const messages = json.errors.map(e => e.message).join('; ');
      throw new Error(`Cloudflare GraphQL error: ${messages}`);
    }

    // ============================================================
    // 4. EXTRAER MÉTRICAS
    // ============================================================

    const zones = json.data && json.data.viewer && json.data.viewer.zones;
    const group = zones && zones[0] && zones[0].httpRequestsAdaptiveGroups && zones[0].httpRequestsAdaptiveGroups[0];

    if (!group) {
      // Sin tráfico en la ventana pedida no es un error, es una zona tranquila
      return { requests: 0, visitors: 0, bandwidth: 0, zoneId };
    }

    return {
      requests: group.count || 0,
      visitors: (group.sum && group.sum.visits) || 0,
      bandwidth: (group.sum && group.sum.edgeResponseBytes) || 0,
      // Qué zona se consultó — útil para debug con varios proyectos/zonas
      zoneId
    };
  }
};
