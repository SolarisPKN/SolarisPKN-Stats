# Cuotas y conectores gratuitos — octubre de 2026

Esta guía describe **límites oficiales** y **presupuestos locales, más conservadores**, que no son lo mismo. Nunca se utilizan los topes externos como objetivo de consumo. Todas las métricas publicadas por Stats pertenecen a repositorios y canales **públicos**. No incluir datos privados de dispositivos, aprendizaje, clientes ni usuarios.

## Conectores ejecutables actualmente

| ID | Datos | Intervalo | Techo local/día por fuente | Solicitudes externas por ejecución | Autenticación |
| --- | --- | --- | --- | --- | --- |
| `github` | Metadatos GraphQL de repositorios públicos | 6 horas | 4 | 1 | `GITHUB_TOKEN_READ` |
| `github-actions` | Resultados de workflows públicos | 12 horas | 2 | 1 | `GITHUB_TOKEN_READ` |
| `cloudflare` | Tráfico de un hostname concreto | 6 horas | 4 | 1 | `CF_API_TOKEN` |
| `pagespeed` | Lighthouse escritorio | 24 horas | 1 | 1 | `PAGESPEED_API_KEY` |
| `http-health` | Disponibilidad de sitios HTTPS autorizados | 6 horas | 4 | 1 | No |
| `youtube-public` | Vista pública de un canal, `channels.list` | 12 horas | 2 | 1 (1 unidad) | `YOUTUBE_API_KEY` |
| `twitch-public` | Directo y audiencia pública, Helix | 6 horas | 4 | 2, como máximo | `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET` |
| `cloudflare-workers` | Muestra de invocaciones del Worker | 12 horas | 2 | 1 | `CF_WORKERS_ANALYTICS_TOKEN` y `CF_ACCOUNT_ID` |
| `r2-public-health` | Estado de un objeto público R2 vía HEAD | 12 horas | 2 | 1 | No |

Los desplazamientos horarios por proyecto pueden alterar la hora UTC, **no** los intervalos. La recopilación funciona con el cron hourly ya existente. Se reserva presupuesto también para leer y escribir `Stats.json` y snapshots diarios.

El presupuesto de ejecución en Workers Free es **39 subsolicitudes estimadas**, inferior al máximo oficial de 50 subsolicitudes externas por invocación. `quota-policy.js` valida automáticamente horarios, costes previstos y presupuestos globales de cada proveedor durante la compilación. Es una protección estática; no puede contabilizar consumo realizado por aplicaciones ajenas ni todos los cambios externos de tarifa o límite.

### Topes externos comprobados

- **Cloudflare Workers Free:** 100.000 invocaciones/día y 50 subsolicitudes externas/invocación.
- **Cloudflare Analytics GraphQL:** límite general predeterminado de aproximadamente 300 consultas/5 minutos, más límites de API y de datasets por plan. No toda tabla/columna está habilitada en Free.
- **Cloudflare R2 Standard:** 10 GB-mes, 1 millón de operaciones clase A y 10 millones clase B mensuales gratuitas; egress gratuito. HEAD público sobre `current.json` no accede a la API de administración ni enumera buckets.
- **YouTube Data API:** cuota estándar de 10.000 unidades/día en su bolsa general; `channels.list` cuesta 1 unidad. El presupuesto de este proyecto es 2 unidades/día para ese canal.
- **Twitch Helix:** puntos por minuto con buckets y límites concretos informados en cabeceras `Ratelimit-*`. El ejemplo documental utiliza 800 puntos, **no** se presupone como derecho garantizado. No se consultan chats, seguidores ni datos de usuarios.
- **Google Search Console:** 1.200 consultas/minuto por sitio para Search Analytics, con **límites adicionales de carga** y por cuenta/proyecto.
- **Google Analytics 4 Data API:** propiedades Standard hasta 200.000 tokens Core/día y 40.000/hora, dependiendo del coste de la consulta. No integrado todavía.
- **Arduino Cloud Free:** 2 Things, 5 variables por Thing, un día de retención; en la tabla oficial figura **10 solicitudes API/segundo**. No se integra en el repositorio público para no exponer información operativa del ESP32.
- **YouTube Analytics (propietario):** OAuth, métricas internas con cuota variable; no integrado sin autorización específica del propietario.

Referencias oficiales:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/analytics/graphql-api/limits/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://dev.twitch.tv/docs/api/guide
- https://developers.google.com/webmaster-tools/limits
- https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- https://cloud.arduino.cc/plans/
- https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/

## Activación segura y privacidad

- En **Cloudflare Workers > Settings > Variables and Secrets**, introducir las credenciales aplicables. No incluir credenciales en `registry.json`, en GitHub, en un README o en imágenes.
- `solarispkn-livetools` tiene habilitados los IDs `youtube-public` y `twitch-public` en el registro, pero **se omiten sin peticiones y sin fallos** si faltan sus secretos.
- `solarispkn-stats` consulta `cloudflare-workers` solo con un token de Analytics específico; nunca utiliza el token de despliegue para adquirir nuevos permisos.
- `solarispkn-transport` comprueba `https://transport-data.solarispkn.com.ar/current.json` exclusivamente mediante HEAD. No hay descargas, listados ni escritura sobre R2.
- Twitch intercambia `client_id` y `client_secret` por un **app access token**, nunca por credenciales de espectadores.
- YouTube usa el identificador público `@SolarisPKN`; no hay OAuth de propietario para estas métricas públicas.
- Cloudflare Workers GraphQL publica `sampled: true` y campos `sampledRequests` etc.; **no deben interpretarse como total de invocaciones**.
- Si el proveedor responde HTTP 429, no hay reintentos inmediatos. Las demás tareas de ese mismo conector se detienen durante esa ejecución y se conserva lo último válido; la próxima oportunidad viene de su horario planificado.

**No aumentar la frecuencia de Twitch a cada minuto para Stats.** Un multichat o un contador de audiencia en directo debe usar un colector específico mientras dure el stream, no un Worker de históricos que crea commits.

## Pruebas

Compilación offline y tests: `STATS_BUILD_ONLY=true node compile-worker.js`, `node --test tests/*.test.cjs`. La CI del PR es de solo validación; no configura secretos ni despliega en Cloudflare.
