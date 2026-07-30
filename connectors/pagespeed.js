// ================================================================
// connectors/pagespeed.js
// ================================================================
// Conector para Google PageSpeed Insights API
// Obtiene métricas de rendimiento, SEO, accesibilidad y buenas prácticas
// La URL del proyecto se recibe desde registry.json
// ================================================================

module.exports = {
  id: 'pagespeed',

  // Horas en las que se ejecuta (límite de 250 consultas/día en plan gratuito)
  hours: [0, 6, 12, 18],

  /**
   * Obtiene métricas de PageSpeed Insights para una URL
   * @param {string} projectId - ID del proyecto (para logs)
   * @param {string} url - URL del proyecto a analizar (desde registry.json)
   * @param {object} env - Variables de entorno del Worker
   * @returns {object} Métricas de rendimiento, SEO, accesibilidad y mejores prácticas
   */
  async fetchData(projectId, url, env) {
    // ============================================================
    // 1. VALIDAR QUE TENEMOS URL
    // ============================================================
    
    if (!url) {
      throw new Error(`No se proporcionó URL para el proyecto: ${projectId}`);
    }

    const apiKey = env.PAGESPEED_API_KEY;
    if (!apiKey) {
      throw new Error('PAGESPEED_API_KEY no configurado en las variables de entorno');
    }

    // ============================================================
    // 2. CONSTRUIR LA PETICIÓN
    // ============================================================
    
    const params = new URLSearchParams({
      url: url,
      key: apiKey,
      strategy: 'desktop'
    });
    // URLSearchParams permite claves repetidas via .append(), a diferencia
    // del objeto de arriba (donde 'category' repetido solo se queda con 'seo').
    ['performance', 'accessibility', 'best-practices', 'seo'].forEach(cat => {
      params.append('category', cat);
    });

    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;

    // ============================================================
    // 3. HACER LA PETICIÓN
    // ============================================================
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PageSpeed API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`PageSpeed API error: ${data.error.message}`);
    }

    // ============================================================
    // 4. EXTRAER MÉTRICAS
    // ============================================================
    
    const lighthouse = data.lighthouseResult;
    if (!lighthouse) {
      throw new Error('PageSpeed API: No se encontraron resultados de Lighthouse');
    }

    const categories = lighthouse.categories || {};
    
    const performance = categories.performance?.score !== undefined 
      ? Math.round(categories.performance.score * 100) 
      : 0;
    
    const accessibility = categories.accessibility?.score !== undefined 
      ? Math.round(categories.accessibility.score * 100) 
      : 0;
    
    const bestPractices = categories['best-practices']?.score !== undefined 
      ? Math.round(categories['best-practices'].score * 100) 
      : 0;
    
    const seo = categories.seo?.score !== undefined 
      ? Math.round(categories.seo.score * 100) 
      : 0;

    // Core Web Vitals
    const audits = lighthouse.audits || {};
    const firstContentfulPaint = audits['first-contentful-paint']?.numericValue || 0;
    const largestContentfulPaint = audits['largest-contentful-paint']?.numericValue || 0;
    const totalBlockingTime = audits['total-blocking-time']?.numericValue || 0;
    const cumulativeLayoutShift = audits['cumulative-layout-shift']?.numericValue || 0;
    const speedIndex = audits['speed-index']?.numericValue || 0;
    const timeToInteractive = audits['interactive']?.numericValue || 0;

    return {
      performance: performance,
      accessibility: accessibility,
      bestPractices: bestPractices,
      seo: seo,
      firstContentfulPaint: Math.round(firstContentfulPaint),
      largestContentfulPaint: Math.round(largestContentfulPaint),
      totalBlockingTime: Math.round(totalBlockingTime),
      cumulativeLayoutShift: Math.round(cumulativeLayoutShift * 100) / 100,
      speedIndex: Math.round(speedIndex),
      timeToInteractive: Math.round(timeToInteractive),
      url: url,
      strategy: 'desktop'
    };
  }
};