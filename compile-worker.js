// ================================================================
// compile-worker.js
// ================================================================
// Este script:
// 1. Lee registry.json (configuración de proyectos)
// 2. Lee todos los conectores en la carpeta connectors/
// 3. Resuelve el Zone ID de Cloudflare de cada proyecto a partir de su
//    URL (NO se guarda en registry.json — se resuelve en build time y
//    solo queda incrustado dentro del Worker compilado)
// 4. Compila el executionPlan (tareas por hora)
// 5. Genera el código completo del Worker (con plan incrustado)
// 6. Sube el Worker a Cloudflare usando la API
// 7. Configura el Cron Trigger
// ================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ================================================================
// 1. CONFIGURACIÓN
// ================================================================

const {
  CF_ACCOUNT_ID,
  CF_API_TOKEN,
  WORKER_NAME = 'solarispkn-stats'
} = process.env;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error('❌ Faltan variables de entorno: CF_ACCOUNT_ID y CF_API_TOKEN');
  process.exit(1);
}

// ================================================================
// 2. LEER REGISTRY
// ================================================================

const registryPath = path.join(__dirname, 'registry.json');
if (!fs.existsSync(registryPath)) {
  console.error('❌ No se encuentra registry.json');
  process.exit(1);
}
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
console.log(`📋 Registry cargado: ${registry.projects.length} proyectos`);

// ================================================================
// 3. LEER CONECTORES
// ================================================================

const connectorsDir = path.join(__dirname, 'connectors');
if (!fs.existsSync(connectorsDir)) {
  console.error('❌ No se encuentra la carpeta connectors/');
  process.exit(1);
}

const connectorFiles = fs.readdirSync(connectorsDir).filter(f => f.endsWith('.js'));
const connectors = {};
const connectorCode = {};

for (const file of connectorFiles) {
  const connectorPath = path.join(connectorsDir, file);
  const connectorModule = require(connectorPath);
  const id = connectorModule.id || path.basename(file, '.js');
  connectors[id] = connectorModule;
  const code = fs.readFileSync(connectorPath, 'utf8');
  connectorCode[id] = code;
  console.log(`  🔌 Conector cargado: ${id} (horas: ${connectorModule.hours?.join(', ') || 'todas'})`);
}

// ================================================================
// 4. RESOLVER ZONE IDs DE CLOUDFLARE (sin guardarlos en registry.json)
// ================================================================
// El zoneId de cada proyecto con plataforma "cloudflare" no vive en
// ningún archivo del repo. Se resuelve acá, en build time, contra la
// API de Cloudflare (List Zones) a partir del hostname de "url", y
// queda incrustado ÚNICAMENTE dentro del Worker compilado — que no es
// público como sí lo es este repo de GitHub.
//
// Requisito: el CF_API_TOKEN de este Action necesita, además del
// permiso que ya tenía (Workers Scripts: Edit), el permiso de zona
// Zone → Zone → Read (alcanza con "Read" para listar zonas).

async function listZonesByName(name) {
  const url = `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudflare Zones API error: ${response.status} - ${errorText}`);
  }
  const json = await response.json();
  return json.result || [];
}

async function resolveZoneId(hostname) {
  const parts = hostname.split('.');
  // Probamos desde el hostname completo hacia arriba, sacando un label
  // de la izquierda cada vez:
  //   labs.solarispkn.com.ar -> solarispkn.com.ar -> com.ar
  // hasta encontrar una zona que exista de verdad en la cuenta. Así no
  // hace falta adivinar dónde termina el dominio en ccTLDs compuestos
  // (.com.ar, .co.uk, etc.) sin depender de una lista pública de sufijos.
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const zones = await listZonesByName(candidate);
    if (zones.length > 0) {
      return zones[0].id;
    }
  }
  return null;
}

const zoneIdCache = {}; // por si dos proyectos comparten el mismo dominio

async function getZoneIdForProject(project) {
  if (!project.url) return null;
  const hostname = new URL(project.url).hostname;
  if (hostname in zoneIdCache) return zoneIdCache[hostname];

  console.log(`  🔍 Resolviendo Zone ID para ${hostname}...`);
  const zoneId = await resolveZoneId(hostname);
  if (!zoneId) {
    throw new Error(
      `No se encontró ninguna zona de Cloudflare para "${hostname}" (proyecto "${project.id}"). ` +
      `Verificá que el dominio esté en la misma cuenta de Cloudflare que CF_ACCOUNT_ID, ` +
      `y que CF_API_TOKEN tenga el permiso Zone → Zone → Read.`
    );
  }
  console.log(`  ✅ Zone ID resuelto para ${hostname}`);
  zoneIdCache[hostname] = zoneId;
  return zoneId;
}

// ================================================================
// 5. COMPILAR EXECUTION PLAN Y DESPLEGAR
// ================================================================
// Todo lo que sigue necesita await (resolver zone ids, y más adelante
// subir el Worker), así que va adentro de main().

async function main() {
  const plan = {};

  for (const project of registry.projects) {
    for (const platform of project.platforms) {
      const connector = connectors[platform];
      if (!connector) {
        console.warn(`⚠️ Plataforma "${platform}" no tiene conector. Ignorando.`);
        continue;
      }

      // Solo resolvemos zoneId para proyectos que efectivamente usan
      // la plataforma cloudflare — no pegamos contra la API al pedo.
      let zoneId = null;
      if (platform === 'cloudflare') {
        zoneId = await getZoneIdForProject(project);
      }

      const hours = connector.hours || Array.from({ length: 24 }, (_, i) => i);
      for (const hour of hours) {
        if (!plan[hour]) plan[hour] = {};
        if (!plan[hour][platform]) plan[hour][platform] = [];
        const task = { id: project.id };
        if (project.url) task.url = project.url;
        if (zoneId) task.zoneId = zoneId;
        if (!plan[hour][platform].some(t => t.id === project.id)) {
          plan[hour][platform].push(task);
        }
      }
    }
  }

  // Ordenar horas
  const sortedPlan = {};
  Object.keys(plan).sort((a, b) => Number(a) - Number(b)).forEach(hour => {
    sortedPlan[Number(hour)] = plan[hour];
  });

  const registryHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(registry))
    .digest('hex');

  const executionPlan = {
    version: Date.now(),
    generatedAt: new Date().toISOString(),
    registryHash,
    plan: sortedPlan
  };

  console.log(`📦 Plan compilado:`);
  console.log(`  - Versión: ${executionPlan.version}`);
  console.log(`  - Generado: ${executionPlan.generatedAt}`);
  console.log(`  - Hash: ${executionPlan.registryHash.slice(0, 8)}...`);
  console.log(`  - Horas con tareas: ${Object.keys(sortedPlan).length}`);

  // ================================================================
  // 5b. GENERAR CÓDIGO DEL WORKER
  // ================================================================

  const connectorsCode = Object.entries(connectorCode).map(([id, code]) => {
    return `
// --- Conector: ${id} ---
const ${id}Connector = (function() {
  let module = { exports: {} };
  (function(module, exports) {
    ${code}
  })(module, module.exports);
  return module.exports;
})();
`;
  }).join('\n');

  const runtimeCode = `
// ================================================================
// RUNTIME
// ================================================================

async function runRuntime(env, hour) {
  console.log(\`⏰ Ejecutando runtime para la hora \${hour}...\`);

  const tasks = EXECUTION_PLAN.plan[hour] || {};
  if (Object.keys(tasks).length === 0) {
    console.log(\`⏸️ No hay tareas para la hora \${hour}\`);
    return;
  }

  const connectorMap = {
${Object.keys(connectors).map(id => `    "${id}": ${id}Connector`).join(',\n')}
  };

  for (const [platform, taskList] of Object.entries(tasks)) {
    const connector = connectorMap[platform];
    if (!connector) {
      console.error(\`❌ Conector no encontrado: \${platform}\`);
      continue;
    }
    for (const task of taskList) {
      const projectId = task.id;
      try {
        console.log(\`📊 Consultando \${platform} para \${projectId}...\`);
        // Le pasamos al conector projectId, la tarea completa (id/url/zoneId/lo que traiga) y env
        const data = await connector.fetchData(projectId, task, env);
        await updateProjectStats(env, projectId, platform, data);
      } catch (error) {
        console.error(\`❌ Error en \${platform} para \${projectId}:\`, error.message);
      }
    }
  }

  if (hour === 0) {
    await createDailySnapshot(env);
  }
  console.log(\`✅ Runtime completado para la hora \${hour}\`);
}

// ================================================================
// HELPERS DE GITHUB
// ================================================================

async function getFromGitHub(env, path) {
  const url = \`https://api.github.com/repos/SolarisPKN/SolarisPKN-Stats/contents/\${path}\`;
  const response = await fetch(url, {
    headers: {
      'Authorization': \`Bearer \${env.GITHUB_TOKEN_WRITE}\`,
      // GitHub rechaza CUALQUIER request REST sin este header (403
      // Forbidden), sin excepción. No es opcional.
      'User-Agent': 'SolarisPKN-Stats/1.0',
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(\`GitHub GET error: \${response.status} - \${errorText}\`);
  }
  const data = await response.json();
  // Devolvemos content Y sha — el sha vive en la respuesta de la API
  // (metadata de GitHub), NUNCA dentro del contenido del archivo en sí.
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha
  };
}

async function saveToGitHub(env, path, content, message = 'Update stats') {
  const url = \`https://api.github.com/repos/SolarisPKN/SolarisPKN-Stats/contents/\${path}\`;
  const existing = await getFromGitHub(env, path);
  const body = {
    message: \`\${message} - \${new Date().toISOString()}\`,
    content: Buffer.from(content).toString('base64'),
    // Antes esto siempre daba undefined (buscaba .sha adentro del
    // contenido parseado, que nunca lo tiene). Ahora sale de la
    // metadata real que devuelve getFromGitHub.
    sha: existing ? existing.sha : undefined
  };
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': \`Bearer \${env.GITHUB_TOKEN_WRITE}\`,
      'User-Agent': 'SolarisPKN-Stats/1.0',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(\`GitHub PUT error: \${response.status} - \${errorText}\`);
  }
  return response.json();
}

async function updateProjectStats(env, projectId, platform, data) {
  const statsPath = \`\${projectId}/Stats.json\`;
  const existing = await getFromGitHub(env, statsPath);
  let stats = existing ? JSON.parse(existing.content) : { updatedAt: new Date().toISOString() };
  stats[platform] = data;
  stats.updatedAt = new Date().toISOString();
  await saveToGitHub(env, statsPath, JSON.stringify(stats, null, 2), \`Update \${projectId} stats\`);
}

async function createDailySnapshot(env) {
  console.log('📸 Creando snapshot histórico...');
  const today = new Date().toISOString().split('T')[0];
  const registryFile = await getFromGitHub(env, 'registry.json');
  if (!registryFile) {
    console.error('❌ No se pudo leer registry.json para snapshots');
    return;
  }
  const registry = JSON.parse(registryFile.content);
  for (const project of registry.projects) {
    const statsPath = \`\${project.id}/Stats.json\`;
    const historyPath = \`\${project.id}/History/\${today}.json\`;
    const statsFile = await getFromGitHub(env, statsPath);
    if (statsFile) {
      await saveToGitHub(env, historyPath, statsFile.content, \`Snapshot \${today} for \${project.id}\`);
      console.log(\`  ✅ Snapshot guardado para \${project.id}\`);
    }
  }
}
`;

  const indexCode = `
// ================================================================
// WORKER - PUNTO DE ENTRADA
// ================================================================

export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const hour = now.getHours();
    // La hora 0 (github+cloudflare+pagespeed + snapshot a History/) NO se
    // dispara acá — la dispara compile-worker.js justo después de cada
    // deploy (programado o manual), así el deploy siempre deja Stats.json
    // fresco. Este cron solo cubre las horas 1-23.
    if (hour === 0) return;
    if (now.getMinutes() === 0) {
      await runRuntime(env, hour);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.has('run')) {
      const hourParam = url.searchParams.get('hour');
      const hour = hourParam !== null ? parseInt(hourParam, 10) : new Date().getHours();
      await runRuntime(env, hour);
      return new Response(\`Runtime ejecutado para la hora \${hour}\`);
    }
    return new Response(JSON.stringify({
      status: 'OK',
      planVersion: EXECUTION_PLAN.version,
      generatedAt: EXECUTION_PLAN.generatedAt
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
`;

  const workerCode = `// @ts-nocheck
// El editor de Cloudflare (Quick Edit) corre un chequeo de TypeScript
// incluso sobre archivos .js. Sin esta línea tira falsos positivos:
// "Promise<T>" en los métodos async de los conectores, y "Cannot find
// name 'Buffer'" (porque Buffer solo existe en runtime gracias al flag
// nodejs_compat del deploy, cosa que el editor no sabe). No son errores
// reales — el Worker ya corre así en producción — esto es solo estético.
// ================================================================
// WORKER GENERADO AUTOMÁTICAMENTE POR compile-worker.js
// ================================================================
// No editar manualmente. Ejecutar node compile-worker.js para actualizar.
// ================================================================

// PLAN DE EJECUCIÓN INCRUSTADO
const EXECUTION_PLAN = ${JSON.stringify(executionPlan, null, 2)};

// ================================================================
// CONECTORES
// ================================================================
${connectorsCode}

// ================================================================
// RUNTIME Y HELPERS
// ================================================================
${runtimeCode}

// ================================================================
// PUNTO DE ENTRADA
// ================================================================
${indexCode}
`;

  // ================================================================
  // 6. GUARDAR WORKER GENERADO (para depuración)
  // ================================================================

  const builtPath = path.join(__dirname, 'worker-built.js');
  fs.writeFileSync(builtPath, workerCode);
  console.log(`📝 Worker generado guardado en: ${builtPath}`);

  // ================================================================
  // 7. SUBIR WORKER A CLOUDFLARE
  // ================================================================

  await deployWorker(workerCode, executionPlan, builtPath);

  // ================================================================
  // 8. CONFIGURAR CRON TRIGGER
  // ================================================================

  await setCronTrigger();

  // ================================================================
  // 9. DISPARAR LA HORA 0 (github+cloudflare+pagespeed + snapshot)
  // ================================================================
  // No fatal: si esto falla, el deploy en sí ya está hecho y el cron
  // de las horas 1-23 va a seguir andando solo. Un fallo acá solo
  // significa "no hubo refresh inmediato", no "el sistema está roto".
  try {
    await triggerInitialRun();
  } catch (err) {
    console.warn(`⚠️ No se pudo disparar la corrida inicial (hora 0): ${err.message}`);
    console.warn(`⚠️ El deploy y el cron ya están OK — esto solo afecta el refresh inmediato.`);
  }
}

// ================================================================
// deployWorker / setCronTrigger
// ================================================================

async function deployWorker(workerCode, executionPlan, builtPath) {
  console.log(`🚀 Subiendo Worker a Cloudflare...`);

  // El worker generado usa sintaxis de ES Modules (export default { scheduled, fetch }),
  // así que hay que subirlo como multipart/form-data con metadata.main_module.
  // Con Content-Type: application/javascript a secas, Cloudflare lo trata como
  // Service Worker legacy y devuelve: "Uncaught SyntaxError: Unexpected token 'export'".
  const scriptFile = `${WORKER_NAME}.js`;
  const metadata = {
    main_module: scriptFile,
    compatibility_date: new Date().toISOString().split('T')[0],
    // Buffer.from(...) se usa en getFromGitHub/saveToGitHub para
    // leer y escribir Stats.json. Sin este flag, Buffer no existe
    // en el runtime de Workers y esas funciones tiran ReferenceError.
    compatibility_flags: ['nodejs_compat'],
    // Como deployamos por API cruda (no wrangler), no hay wrangler.jsonc
    // que active esto por default — lo seteamos acá explícitamente para
    // que los console.log/console.error queden guardados y sean
    // consultables después en el dashboard, no solo mientras mirás en vivo.
    observability: {
      enabled: true,
      head_sampling_rate: 1 // logueá el 100% de las invocaciones
    }
  };

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append(scriptFile, new Blob([workerCode], { type: 'application/javascript+module' }), scriptFile);

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`
        // OJO: no seteamos Content-Type a mano acá, fetch arma el
        // multipart/form-data con el boundary correcto solo.
      },
      body: formData
    });
  } catch (err) {
    guardarArtefactoDeError(builtPath);
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Error al subir Worker: ${response.status} - ${errorText}`);
    guardarArtefactoDeError(builtPath);
    process.exit(1);
  }

  console.log(`✅ Worker "${WORKER_NAME}" actualizado exitosamente en Cloudflare`);
  console.log(`📅 Plan generado: ${executionPlan.generatedAt}`);
  console.log(`📌 Versión: ${executionPlan.version}`);
}

// Esto es un recurso separado del script: subir el código NO alcanza
// para que scheduled() se dispare solo. Hay que registrar el cron acá
// (o una vez a mano desde el dashboard). Como es idempotente, no pasa
// nada por reenviarlo en cada deploy.
async function setCronTrigger() {
  console.log(`⏰ Configurando Cron Trigger...`);

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/schedules`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{ cron: '0 * * * *' }]) // cada hora en punto (UTC)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Error al configurar Cron Trigger: ${response.status} - ${errorText}`);
    process.exit(1);
  }

  console.log(`✅ Cron Trigger configurado: "0 * * * *" (cada hora en punto, UTC)`);
}

// Resuelve https://{WORKER_NAME}.{subdominio}.workers.dev y le pega a
// ?run&hour=0 para forzar el refresh completo (github+cloudflare+pagespeed
// + snapshot a History/) apenas termina el deploy — sin esperar a que
// llegue la próxima hora en punto.
async function triggerInitialRun() {
  console.log(`🔥 Disparando corrida inicial (hora 0)...`);

  // 1. Resolver el subdominio workers.dev de la cuenta
  const subdomainUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/subdomain`;
  const subdomainRes = await fetch(subdomainUrl, {
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }
  });
  if (!subdomainRes.ok) {
    throw new Error(`No se pudo resolver el subdominio workers.dev: ${subdomainRes.status} - ${await subdomainRes.text()}`);
  }
  const subdomainJson = await subdomainRes.json();
  const subdomain = subdomainJson.result && subdomainJson.result.subdomain;
  if (!subdomain) {
    throw new Error('La cuenta no tiene un subdominio workers.dev configurado');
  }

  // 2. Asegurar que este Worker tenga habilitada la ruta *.workers.dev
  //    (si solo lo estabas usando con un dominio propio, puede estar apagada)
  const routeUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/subdomain`;
  const routeRes = await fetch(routeUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ enabled: true })
  });
  if (!routeRes.ok) {
    throw new Error(`No se pudo habilitar la ruta workers.dev: ${routeRes.status} - ${await routeRes.text()}`);
  }

  // 3. Pegarle al endpoint ?run&hour=0 del Worker recién deployado
  const runUrl = `https://${WORKER_NAME}.${subdomain}.workers.dev/?run&hour=0`;
  const runRes = await fetch(runUrl);
  if (!runRes.ok) {
    throw new Error(`El Worker respondió ${runRes.status} al disparar la hora 0`);
  }
  const runText = await runRes.text();
  console.log(`✅ Corrida inicial completada: ${runText}`);
}

function guardarArtefactoDeError(builtPath) {
  try {
    const artifactPath = path.join(__dirname, 'worker-built-error.js');
    fs.copyFileSync(builtPath, artifactPath);
    console.error(`El archivo se ha guardado como ${artifactPath} para inspección.`);
  } catch (_) {
    // si ni esto se puede guardar, no hay mucho más para hacer acá
  }
}

// ================================================================
// EJECUTAR
// ================================================================

main().catch(error => {
  console.error('❌ Error inesperado:', error);
  process.exit(1);
});
