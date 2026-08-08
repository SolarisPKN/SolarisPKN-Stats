// ================================================================
// connectors/cloudflare.js
// ================================================================
// Conector para la GraphQL Analytics API de Cloudflare.
// La vieja REST /zones/{id}/analytics/dashboard está migrando a este
// esquema (Cloudflare tiene su propia guía oficial de migración) —
// una sola petición trae totales de tráfico, bandwidth, amenazas y
// varios desgloses (países, status codes, tipos de contenido, browsers).
//
// Dataset: httpRequestsAdaptiveGroups (no httpRequests1mGroups). Los dos
// tienen el mismo shape de campos, pero 1mGroups requiere plan Pro+ —
// en zona Free tira "does not have access to the path" (403). Adaptive
// está disponible en todos los planes.
//
// Soporta MÚLTIPLES zonas: compile-worker.js resuelve el zoneId de cada
// proyecto a partir de su "url" (llamando a la API de Zones de Cloudflare
// en build time) y lo incrusta acá en la tarea — nunca vive en registry.json,
// así no queda a la vista en el repo público.
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
    // 2. QUERY GRAPHQL — sin "dimensions", así viene como total
    //    agregado del período en vez de desglosado por bloques de tiempo
    //    (así lo indica la propia guía de migración de Cloudflare).
    // ============================================================

    const query = `
      query ZoneStats($zoneTag: string, $start: Time, $end: Time) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequestsAdaptiveGroups(
              limit: 1
              filter: { datetime_geq: $start, datetime_lt: $end }
            ) {
              sum {
                requests
                bytes
                cachedBytes
                cachedRequests
                encryptedBytes
                encryptedRequests
                pageViews
                threats
                countryMap { clientCountryName requests bytes threats }
                responseStatusMap { edgeResponseStatus requests }
                contentTypeMap { edgeResponseContentTypeName requests bytes }
                browserMap { uaBrowserFamily pageViews }
                threatPathingMap { threatPathingName requests }
              }
              uniq { uniques }
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
      return {
        requests: 0, visitors: 0, bandwidth: 0, threats: 0,
        cachedRequests: 0, cachedBytes: 0, pageViews: 0,
        topCountries: [], statusCodes: [], contentTypes: [], browsers: [], threatTypes: [],
        zoneId
      };
    }

    const sum = group.sum;

    return {
      // --- Métricas clásicas (mismos nombres que la versión REST) ---
      requests: sum.requests || 0,
      visitors: (group.uniq && group.uniq.uniques) || 0,
      bandwidth: sum.bytes || 0,
      threats: sum.threats || 0,

      // --- Extra que trae la GraphQL en la misma petición ---
      cachedRequests: sum.cachedRequests || 0,
      cachedBytes: sum.cachedBytes || 0,
      encryptedRequests: sum.encryptedRequests || 0,
      encryptedBytes: sum.encryptedBytes || 0,
      pageViews: sum.pageViews || 0,
      topCountries: (sum.countryMap || [])
        .slice()
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 5)
        .map(c => ({ country: c.clientCountryName, requests: c.requests, bytes: c.bytes, threats: c.threats })),
      statusCodes: (sum.responseStatusMap || [])
        .map(s => ({ status: s.edgeResponseStatus, requests: s.requests })),
      contentTypes: (sum.contentTypeMap || [])
        .slice()
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 5)
        .map(c => ({ type: c.edgeResponseContentTypeName, requests: c.requests, bytes: c.bytes })),
      browsers: (sum.browserMap || [])
        .slice()
        .sort((a, b) => b.pageViews - a.pageViews)
        .slice(0, 5)
        .map(b => ({ browser: b.uaBrowserFamily, pageViews: b.pageViews })),
      threatTypes: (sum.threatPathingMap || [])
        .map(t => ({ type: t.threatPathingName, requests: t.requests })),

      // Qué zona se consultó — útil para debug con varios proyectos/zonas
      zoneId
    };
  }
};
