# SolarisPKN-Stats

🇦🇷 Español | 🇺🇸 [English](README.md)

## Descripción

SolarisPKN-Stats es un sistema automatizado para la recopilación, almacenamiento y actualización de estadísticas de proyectos alojados en diferentes plataformas y servicios.

Su objetivo es proporcionar datos estadísticos de forma **transparente, estructurada y reutilizable**, manteniendo la información recopilada en archivos JSON que pueden ser utilizados posteriormente por sitios web, dashboards, herramientas de análisis u otros proyectos.

El sistema utiliza una arquitectura basada en **connectors**, un registro central de proyectos mediante `registry.json`, GitHub Actions y un Cloudflare Worker encargado de ejecutar las recopilaciones de estadísticas de forma programada.

SolarisPKN-Stats fue desarrollado inicialmente para el ecosistema SolarisPKN, pero su arquitectura permite utilizarlo con cualquier conjunto de proyectos que pueda ser integrado mediante los connectors disponibles.

---

## ¿Cómo funciona?

Los proyectos que deben ser analizados se registran en el archivo:

```text
registry.json
```

Por ejemplo:

```json
{
  "projects": [
    {
      "id": "solarispkn-labs",
      "platforms": ["github", "cloudflare", "pagespeed"],
      "url": "https://labs.solarispkn.com.ar"
    },
    {
      "id": "solarispkn-control",
      "platforms": ["github"]
    }
  ]
}
```

Cada proyecto define qué plataformas deben ser consultadas.

Por ejemplo:

```text
solarispkn-labs
 ├── GitHub
 ├── Cloudflare
 └── PageSpeed Insights
```

Mientras que otro proyecto podría utilizar únicamente:

```text
solarispkn-control
 └── GitHub
```

Las plataformas disponibles son implementadas mediante connectors ubicados en:

```text
connectors/
```

---

# Arquitectura

El funcionamiento general del sistema es:

```text
                       registry.json
                            │
                            ▼
                     GitHub Actions
                            │
                  Compilación del sistema
                            │
                            ▼
                   Cloudflare Worker
                            │
                       Scheduler
                            │
              ┌─────────────┴─────────────┐
              │                           │
         Connector A                 Connector B
              │                           │
              ▼                           ▼
       API de plataforma            API de plataforma
              │                           │
       REST / GraphQL              REST / GraphQL
              │                           │
              └─────────────┬─────────────┘
                            ▼
                     Datos recopilados
                            │
                            ▼
                       stats.json
                            │
                            ▼
                         history/
```

La arquitectura separa el **despliegue del sistema** de la **recopilación periódica de estadísticas**.

GitHub Actions se utiliza para compilar y desplegar el sistema.

Una vez desplegado, el Cloudflare Worker se encarga de ejecutar las tareas de recopilación según los horarios definidos por cada connector.

---

# Registry

`registry.json` es el registro central de los proyectos que deben ser analizados.

Cada proyecto puede definir:

* Un identificador.
* Las plataformas que deben consultarse.
* La URL del proyecto cuando sea necesaria.

Ejemplo:

```json
{
  "id": "solarispkn-labs",
  "platforms": [
    "github",
    "cloudflare",
    "pagespeed"
  ],
  "url": "https://labs.solarispkn.com.ar"
}
```

El registry permite separar la configuración de los proyectos de la lógica utilizada para consultar cada plataforma.

De esta manera, agregar un nuevo proyecto no requiere modificar el núcleo del sistema.

---

# Connectors

Los connectors son el componente encargado de comunicarse con las diferentes plataformas y servicios.

Cada connector contiene la lógica necesaria para trabajar con una API determinada.

Un connector puede definir:

* Autenticación.
* Endpoints.
* Métodos de consulta.
* Datos que deben recopilarse.
* Procesamiento de las respuestas.
* Horarios de ejecución.
* Frecuencia de actualización.
* Manejo de errores.
* Formato de los datos obtenidos.

Actualmente el sistema utiliza connectors para:

* GitHub.
* Cloudflare.
* PageSpeed Insights.

La arquitectura está diseñada para permitir incorporar nuevas plataformas en el futuro.

Por ejemplo:

```text
connectors/
├── github/
├── cloudflare/
├── pagespeed/
└── ...
```

Un nuevo connector puede incorporarse sin necesidad de modificar la arquitectura principal del sistema.

---

# Estrategia de recopilación

Uno de los objetivos principales de SolarisPKN-Stats es **reducir la cantidad innecesaria de solicitudes realizadas a las APIs**.

No todas las estadísticas necesitan actualizarse con la misma frecuencia.

Por este motivo, cada connector puede definir sus propios horarios y procedimientos de recopilación.

Por ejemplo:

```text
00:00 → GitHub
01:00 → Cloudflare
02:00 → Cloudflare
03:00 → GitHub
04:00 → PageSpeed
05:00 → Cloudflare
...
```

Los horarios reales dependen de la configuración de cada connector.

De esta manera, el Worker solamente consulta las APIs necesarias en cada momento.

Esto permite reducir:

* Cantidad de solicitudes.
* Consumo de APIs.
* Uso innecesario de recursos.
* Latencia.
* Riesgo de alcanzar límites de las APIs.

---

# Optimización mediante GraphQL

Cuando una plataforma dispone de una API GraphQL, SolarisPKN-Stats puede utilizarla para reducir la cantidad de solicitudes necesarias durante una recopilación.

GraphQL **no es el formato de salida de SolarisPKN-Stats ni reemplaza a las APIs convencionales**.

Es simplemente un método de consulta que los connectors pueden utilizar cuando resulta más eficiente.

Por ejemplo, una API convencional podría requerir:

```text
GET /metric-1
GET /metric-2
GET /metric-3
GET /metric-4
GET /metric-5
```

Para obtener cinco métricas diferentes.

Si la plataforma dispone de GraphQL, el connector puede solicitar esas métricas mediante una única operación:

```text
POST /graphql
```

con una consulta que incluya todos los datos necesarios.

Esto permite que el Worker obtenga una mayor cantidad de información utilizando menos solicitudes.

La estrategia es:

```text
                 Connector
                    │
          ┌─────────┴─────────┐
          │                   │
      API normal          GraphQL
          │                   │
          └─────────┬─────────┘
                    ▼
             Datos obtenidos
                    │
                    ▼
                 Worker
                    │
                    ▼
               stats.json
```

El método utilizado depende de las capacidades de cada plataforma.

SolarisPKN-Stats busca utilizar el método de consulta más eficiente disponible para cada connector.

---

# Primera ejecución

Cuando SolarisPKN-Stats se despliega por primera vez, el sistema realiza una recopilación inicial de las estadísticas correspondientes a los proyectos registrados.

El Worker crea la estructura necesaria para almacenar los datos de cada proyecto.

Por ejemplo:

```text
stats/
├── solarispkn-labs/
│   ├── stats.json
│   └── history/
│
└── solarispkn-control/
    ├── stats.json
    └── history/
```

A partir de ese momento, el Worker continúa ejecutando las actualizaciones de acuerdo con los horarios definidos por los connectors.

---

# Almacenamiento de estadísticas

Cada proyecto dispone de su propia carpeta.

Dentro de ella se encuentra:

```text
stats.json
```

que contiene las estadísticas actuales recopiladas.

También existe:

```text
history/
```

donde se almacenan los datos históricos.

La estructura permite mantener separadas las estadísticas de cada proyecto.

Ejemplo:

```text
stats/
│
├── solarispkn-labs/
│   ├── stats.json
│   └── history/
│       ├── ...
│       └── ...
│
├── solarispkn-control/
│   ├── stats.json
│   └── history/
│       ├── ...
│       └── ...
│
└── otro-proyecto/
    ├── stats.json
    └── history/
```

---

# Datos Raw

SolarisPKN-Stats prioriza la conservación de los datos estadísticos en formato **raw JSON**.

Esto permite que los datos puedan ser procesados posteriormente por diferentes aplicaciones sin depender de una interfaz específica.

Los datos pueden ser utilizados por:

* Sitios web.
* Dashboards.
* Scripts.
* Aplicaciones.
* Herramientas de análisis.
* Sistemas de visualización.
* Otros proyectos.

El sistema funciona como una capa de recopilación y almacenamiento de datos, dejando que cada consumidor decida cómo presentar o analizar esa información.

---

# Flujo completo

El flujo general de SolarisPKN-Stats es:

```text
1. registry.json
        │
        ▼
2. Identificación de proyectos
        │
        ▼
3. Identificación de connectors
        │
        ▼
4. Cloudflare Worker
        │
        ▼
5. Scheduler
        │
        ▼
6. Connector
        │
        ├── API convencional
        │
        └── GraphQL cuando esté disponible
        │
        ▼
7. Datos estadísticos
        │
        ▼
8. stats.json
        │
        ▼
9. history/
```

---

# Automatización

El sistema utiliza GitHub Actions para realizar el despliegue inicial y las actualizaciones necesarias del Worker.

La idea es evitar ejecutar constantemente un proceso completo de recopilación desde GitHub Actions.

En cambio:

```text
GitHub Actions
      │
      └── despliega / actualiza
                 │
                 ▼
          Cloudflare Worker
                 │
                 ├── 00:00
                 ├── 01:00
                 ├── 02:00
                 ├── 03:00
                 └── ...
```

El Worker permanece encargado de las tareas periódicas.

La configuración de los connectors determina qué APIs deben consultarse en cada momento.

---

# Características

## Recopilación

* Registro centralizado de proyectos.
* Sistema modular de connectors.
* Integración con múltiples plataformas.
* Consultas programadas.
* Actualización incremental.
* Horarios independientes por connector.
* Soporte para APIs convencionales.
* Uso de GraphQL cuando una plataforma lo permite.

## Almacenamiento

* Estadísticas en formato JSON.
* Datos actuales mediante `stats.json`.
* Historial mediante `history/`.
* Organización independiente por proyecto.
* Conservación de datos raw.

## Automatización

* GitHub Actions.
* Cloudflare Workers.
* Scheduler.
* Despliegue automatizado.
* Recopilación periódica.

## Extensibilidad

* Nuevos proyectos mediante `registry.json`.
* Nuevas plataformas mediante connectors.
* Configuración independiente por proyecto.
* Arquitectura desacoplada de las APIs.

---

# Configuración

SolarisPKN-Stats necesita credenciales para los connectors que estén habilitados en `registry.json`.

Las credenciales deben almacenarse como **Secrets** y nunca deben incluirse directamente dentro del código fuente.

Existen dos niveles principales de configuración:

```text
GitHub Actions
      │
      └── Credenciales utilizadas durante el despliegue

Cloudflare Worker
      │
      └── Credenciales utilizadas durante la recopilación
```

---

# Secrets de GitHub Actions

## `CF_API_TOKEN`

Token de Cloudflare utilizado por GitHub Actions para desplegar y configurar el Cloudflare Worker.

El token debe disponer de los permisos necesarios para los recursos de Cloudflare utilizados por el proyecto.

Se recomienda otorgar acceso a las zonas necesarias de la cuenta para evitar tener que modificar el token cada vez que se incorpora una nueva zona o proyecto.

## `CF_ACCOUNT_ID`

ID de la cuenta de Cloudflare donde será desplegado el Worker.

---

# Secrets del Cloudflare Worker

Los Secrets requeridos dependen de los connectors utilizados.

---

## Cloudflare

Si el proyecto utiliza estadísticas de Cloudflare:

### `CF_API_TOKEN`

Token de Cloudflare utilizado para consultar las estadísticas necesarias.

Debe disponer de los permisos de lectura requeridos sobre las cuentas y zonas correspondientes.

### `CF_ACCOUNT_ID`

ID de la cuenta de Cloudflare utilizada para las consultas.

---

## PageSpeed Insights

Si el proyecto utiliza PageSpeed Insights:

### `PAGESPEED_API_KEY`

API Key utilizada para consultar PageSpeed Insights.

---

## GitHub

Si el proyecto utiliza el connector de GitHub:

### `GITHUB_TOKEN_READ`

Token utilizado para consultar las estadísticas de los repositorios.

Debe disponer de los permisos de lectura necesarios sobre los repositorios analizados.

Dependiendo de los datos recopilados, pueden ser necesarios permisos de lectura para recursos como:

* Dependabot alerts.
* Actions.
* Code.
* Commit statuses.
* Issues.
* Metadata.
* Pull requests.
* Repository advisories.
* Security events.

Se recomienda limitar el acceso del token a los repositorios que realmente serán analizados.

---

# Token de escritura de estadísticas

Independientemente de si GitHub se utiliza como fuente de estadísticas, SolarisPKN-Stats necesita un token adicional para escribir los datos generados en el repositorio de estadísticas.

## `GITHUB_TOKEN_WRITE`

Este token se utiliza para crear y actualizar los archivos generados por SolarisPKN-Stats.

Debe disponer de:

* **Read** access to repository metadata.
* **Read and Write** access to repository code.

Este token permite mantener:

```text
stats.json
history/
```

La separación entre:

```text
GITHUB_TOKEN_READ
```

y:

```text
GITHUB_TOKEN_WRITE
```

permite mantener separadas las credenciales utilizadas para consultar información de GitHub de las utilizadas para modificar el repositorio de estadísticas.

---

# Seguridad

Los tokens, API Keys y demás credenciales **nunca deben almacenarse directamente en el repositorio**.

Todas las credenciales deben configurarse mediante:

* GitHub Actions Secrets.
* Cloudflare Worker Secrets.

Se recomienda utilizar siempre el principio de **mínimo privilegio**.

Especialmente en el caso de GitHub, se recomienda mantener separadas las credenciales de lectura y escritura.

```text
GITHUB_TOKEN_READ
        │
        └── Lectura de estadísticas

GITHUB_TOKEN_WRITE
        │
        └── Escritura de estadísticas e historial
```

---

# Compatibilidad y extensibilidad

La arquitectura de SolarisPKN-Stats permite incorporar nuevas plataformas mediante connectors.

El núcleo del sistema no necesita conocer los detalles internos de cada API.

Por ejemplo:

```text
SolarisPKN-Stats
│
├── Connector GitHub
├── Connector Cloudflare
├── Connector PageSpeed
├── Connector GitLab
├── Connector Bitbucket
└── ...
```

Cada connector se encarga de adaptar su plataforma al sistema.

Esto permite que diferentes proyectos utilicen diferentes combinaciones de plataformas.

---

# Casos de uso

SolarisPKN-Stats puede utilizarse para proporcionar estadísticas a:

### Sitios web

Mostrar automáticamente estadísticas de proyectos.

### Portfolios

Mostrar actividad y evolución de repositorios.

### Dashboards

Crear paneles con información actual e histórica.

### Herramientas de análisis

Procesar los archivos JSON mediante scripts u otras herramientas.

### Automatizaciones

Utilizar las estadísticas como entrada para otros sistemas.

### Ecosistemas de proyectos

Centralizar estadísticas de múltiples proyectos y plataformas.

---

# Uso independiente

Aunque SolarisPKN-Stats fue creado originalmente para el ecosistema SolarisPKN, el sistema puede utilizarse de manera independiente.

El proyecto a analizar solamente necesita:

1. Estar definido en `registry.json`.
2. Utilizar un connector compatible.
3. Tener configuradas las credenciales necesarias.
4. Si se trata de un sitio web, proporcionar su URL correspondiente.

Por lo tanto, una instalación independiente podría contener:

```text
registry.json
│
├── proyecto-a
├── proyecto-b
└── proyecto-c
```

sin depender de otros proyectos de SolarisPKN.

---

# Tecnología

Tecnologías utilizadas:

* GitHub
* GitHub Actions
* Cloudflare Workers
* Cloudflare API
* GitHub API
* PageSpeed Insights API
* JSON
* GraphQL

GraphQL se utiliza únicamente como método de consulta optimizado cuando la plataforma correspondiente lo permite.

El formato principal de almacenamiento y distribución de los datos continúa siendo JSON.

---

# Repositorio

GitHub:

https://github.com/SolarisPKN/SolarisPKN-Stats

---

# Filosofía del proyecto

SolarisPKN-Stats está construido alrededor de tres principios:

### Transparencia

Los datos estadísticos se conservan en formatos estructurados y reutilizables.

### Automatización

Una vez configurado el sistema, la recopilación y actualización de estadísticas se realiza automáticamente.

### Eficiencia

Las APIs solamente se consultan cuando es necesario y, cuando una plataforma ofrece mecanismos más eficientes como GraphQL, los connectors pueden utilizarlos para reducir la cantidad de solicitudes.

El objetivo no es crear simplemente un dashboard de estadísticas.

El objetivo es construir una **capa automatizada de recopilación y almacenamiento de datos estadísticos** que pueda ser utilizada por diferentes aplicaciones.

En términos simples:

> **Configurar una vez, recopilar automáticamente, almacenar transparentemente y utilizar los datos donde sea necesario.**

---

# Roadmap

## Fase 1 — Núcleo

* Registry de proyectos.
* Arquitectura de connectors.
* GitHub Actions.
* Despliegue mediante Cloudflare Worker.
* Recopilación de estadísticas.
* Generación de `stats.json`.

## Fase 2 — Automatización

* Scheduler por connector.
* Actualizaciones incrementales.
* Historial de estadísticas.
* Optimización de consultas.
* Incorporación de nuevos connectors.

## Fase 3 — Integración

* Integración con sitios web.
* Dashboards.
* Herramientas de visualización.
* Mayor cantidad de plataformas compatibles.

## Fase 4 — Ecosistema

* Nuevos proveedores de estadísticas.
* Análisis histórico avanzado.
* Agregación de métricas.
* Automatización de informes.
* Integraciones con otros proyectos.

---

# Licencia

La información de licencia será definida en una futura versión.
