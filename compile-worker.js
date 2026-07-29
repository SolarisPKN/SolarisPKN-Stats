// ================================================================
// compile-worker.js
// ================================================================
// Este script:
// 1. Lee registry.json (configuración de proyectos)
// 2. Lee todos los conectores en la carpeta connectors/
// 3. Compila el executionPlan (tareas por hora) incluyendo URLs
// 4. Genera el código completo del Worker (con plan incrustado)
// 5. Sube el Worker a Cloudflare usando la API
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
  const module = require(connectorPath);
  const id = module.id || path.basename(file, '.js');
  connectors[id] = module;
  connectorCode[id] = fs.readFileSync(connectorPath, 'utf8');
  console.log(`  🔌 Conector cargado: ${id} (horas: ${module.hours?.join(', ') || 'todas'})`);
}

// ================================================================
// 4. COMPILAR EXECUTION PLAN
// ================================================================

const plan = {};

for (const project of registry.projects) {
  const projectId = project.id;
  const projectUrl = project.url || `https://${projectId}.solarispkn.com.ar`;

  for (const platform of project.platforms) {
    const connector = connectors[platform];
    if (!connector) {
      console.warn(`⚠️ Plataforma "${platform}" no tiene conector. Ignorando.`);
      continue;
    }
    const hours = connector.hours || Array.from({ length: 24 }, (_, i) => i);
    for (const hour of hours) {
      if (!plan[hour]) plan[hour] = {};
      if (!plan[hour][platform]) plan[hour][platform] = [];
      // Guardar tanto el id como la url en la tarea
      const existing = plan[hour][platform].find(t => t.id === projectId);
      if (!existing) {
        plan[hour][platform].push({ id: projectId, url: projectUrl });
      }
    }
  }
}

// Ordenar horas numéricamente
const sortedPlan = {};
Object.keys(plan).sort((a, b) => Number(a) - Number(b)).forEach(hour => {
  sortedPlan[Number(hour)] = plan[hour];
});

// Generar hash del registry para detectar cambios
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
// 5. GENERAR CÓDIGO DEL WORKER
// ================================================================

// Código del runtime (se ejecuta cada hora)
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

  // Mapeo de plataformas a sus conectores
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
      const { id: projectId, url } = task;
      try {
        console.log(\`📊 Consultando \${platform} para \${projectId}...\`);
        const data = await connector.fetchData(projectId, url, env);
        await updateProjectStats(env, projectId, platform, data);
      } catch (error) {
        console.error(\`❌ Error en \${platform} para \${projectId}:\`, error.message);
      }
    }
  }

  // Si es la hora 0 (medianoche), crear snapshot histórico
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
      'Authorization': \`Bearer \${env.GITHUB_TOKEN}\`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(\`GitHub GET error: \${response.status}\`);
  const data = await response.json();
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

async function saveToGitHub(env, path, content, message = 'Update stats') {
  const url = \`https://api.github.com/repos/SolarisPKN/SolarisPKN-Stats/contents/\${path}\`;
  const existing = await getFromGitHub(env, path);
  const sha = existing ? JSON.parse(existing).sha : undefined;
  const body = {
    message: \`\${message} - \${new Date().toISOString()}\`,
    content: Buffer.from(content).toString('base64'),
    sha: sha
  };
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': \`Bearer \${env.GITHUB_TOKEN}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(\`GitHub PUT error: \${response.status}\`);
  return response.json();
}

async function updateProjectStats(env, projectId, platform, data) {
  const statsPath = \`\${projectId}/Stats.json\`;
  const content = await getFromGitHub(env, statsPath);
  let stats = content ? JSON.parse(content) : { updatedAt: new Date().toISOString() };
  stats[platform] = data;
  stats.updatedAt = new Date().toISOString();
  await saveToGitHub(env, statsPath, JSON.stringify(stats, null, 2), \`Update \${projectId} stats\`);
}

async function createDailySnapshot(env) {
  console.log('📸 Creando snapshot histórico...');
  const today = new Date().toISOString().split('T')[0];
  const registryContent = await getFromGitHub(env, 'registry.json');
  if (!registryContent) {
    console.error('❌ No se pudo leer registry.json para snapshots');
    return;
  }
  const registry = JSON.parse(registryContent);
  for (const project of registry.projects) {
    const statsPath = \`\${project.id}/Stats.json\`;
    const historyPath = \`\${project.id}/History/\${today}.json\`;
    const statsContent = await getFromGitHub(env, statsPath);
    if (statsContent) {
      await saveToGitHub(env, historyPath, statsContent, \`Snapshot \${today} for \${project.id}\`);
      console.log(\`  ✅ Snapshot guardado para \${project.id}\`);
    }
  }
}
`;

// Código del index (punto de entrada)
const indexCode = `
// ================================================================
// WORKER - PUNTO DE ENTRADA
// ================================================================

export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const hour = now.getHours();
    if (now.getMinutes() === 0) {
      await runRuntime(env, hour);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.searchParams.has('run')) {
      const hour = parseInt(url.searchParams.get('hour') || new Date().getHours());
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

// Generar el código completo del Worker
const workerCode = `
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
${Object.entries(connectorCode).map(([id, code]) => `
// --- Conector: ${id} ---
${code}
`).join('\n')}

// ================================================================
${runtimeCode}

// ================================================================
${indexCode}
`;

// ================================================================
// 6. SUBIR WORKER A CLOUDFLARE
// ================================================================

async function deployWorker() {
  console.log(`🚀 Subiendo Worker a Cloudflare...`);

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`;
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/javascript'
    },
    body: workerCode
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Error al subir Worker: ${response.status} - ${errorText}`);
    process.exit(1);
  }

  console.log(`✅ Worker "${WORKER_NAME}" actualizado exitosamente en Cloudflare`);
  console.log(`📅 Plan generado: ${executionPlan.generatedAt}`);
  console.log(`📌 Versión: ${executionPlan.version}`);
}

// ================================================================
// 7. EJECUTAR
// ================================================================

deployWorker().catch(error => {
  console.error('❌ Error inesperado:', error);
  process.exit(1);
});