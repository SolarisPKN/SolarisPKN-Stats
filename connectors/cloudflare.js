// ================================================================
// connectors/cloudflare.js
// ================================================================
// Conector para la API de Cloudflare Analytics
// Obtiene métricas de tráfico y rendimiento de tu zona
// ================================================================

module.exports = {
  // Identificador único de la plataforma
  id: 'cloudflare',

  // Horas en las que se debe ejecutar este conector (formato 0-23)
  // Ejecutar todas las horas para tener datos actualizados constantemente
  hours: Array.from({ length: 24 }, (_, i) => i), // [0,1,2,3,...,23]

  /**
   * Obtiene métricas de Cloudflare para una zona específica
   * @param {string} projectId - ID del proyecto (nombre del subdominio o zona)
   * @param {string} projectUrl - URL del proyecto desde registry.json (no se usa acá)
   * @param {object} env - Variables de entorno del Worker
   * @returns {object} Métricas de Cloudflare
   */
  async fetchData(projectId, projectUrl, env) {
    // ============================================================
    // 1. CONFIGURACIÓN
    // ============================================================
    
    // El Zone ID se obtiene desde las variables de entorno
    // Cada proyecto puede tener su propia zona, o usar la misma
    // Por simplicidad, usamos la misma zona para todos los proyectos
    const zoneId = env.CF_ZONE_ID;
    
    if (!zoneId) {
      throw new Error('CF_ZONE_ID no configurado en las variables de entorno');
    }

    // ============================================================
    // 2. CONSTRUIR LA CONSULTA A LA API DE CLOUDFLARE
    // ============================================================
    
    // Usamos el endpoint de Analytics Dashboard que devuelve métricas agregadas
    // Documentación: https://developers.cloudflare.com/api/operations/zone-analytics-get-analytics-dashboard
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/analytics/dashboard`;
    
    // Parámetros de la consulta (últimas 24 horas)
    const params = new URLSearchParams({
      since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      until: new Date().toISOString(),
      // Podemos filtrar por subdominio si es necesario
      // query: `httpHost eq "${projectId}.solarispkn.com.ar"` // Filtro opcional
    });

    // ============================================================
    // 3. HACER LA PETICIÓN A CLOUDFLARE
    // ============================================================
    
    const response = await fetch(`${url}?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    // Verificar si la petición fue exitosa
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudflare API error: ${response.status} - ${errorText}`);
    }

    // Parsear la respuesta
    const data = await response.json();

    // Verificar si la respuesta tiene datos
    if (!data.success || !data.result) {
      throw new Error('Cloudflare API: Respuesta sin datos');
    }

    // ============================================================
    // 4. EXTRAER MÉTRICAS RELEVANTES
    // ============================================================
    
    const result = data.result;
    
    // Extraer métricas principales
    return {
      // Solicitudes totales en el período
      requests: result.requests?.total || 0,
      
      // Visitantes únicos
      visitors: result.visitors?.total || 0,
      
      // Ancho de banda en bytes (lo convertimos a MB para mejor legibilidad)
      bandwidth: result.bandwidth?.total || 0,
      
      // Amenazas bloqueadas (DDoS, WAF, etc.)
      threats: result.threats?.total || 0,
      
      // (Opcional) Tasa de acierto de caché
      // cacheHitRate: result.cacheHitRate || 0,
      
      // (Opcional) Métricas adicionales si están disponibles
      // pageViews: result.pageViews?.total || 0,
      // uniqueVisitors: result.uniqueVisitors?.total || 0,
      // totalRequests: result.totalRequests || 0
    };
  }
};