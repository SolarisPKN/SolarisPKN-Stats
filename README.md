# SolarisPKN-Stats

🇺🇸 English | 🇦🇷 [Español](README.es.md)

## Overview

SolarisPKN-Stats is an automated system for collecting, storing, and updating statistics from projects hosted across different platforms and services.

Its goal is to provide statistical data in a **transparent, structured, and reusable** format, keeping collected information in JSON files that can later be consumed by websites, dashboards, analytics tools, or other projects.

The system uses a **connector-based architecture**, a central project registry through `registry.json`, GitHub Actions, and a Cloudflare Worker responsible for executing scheduled statistics collection.

SolarisPKN-Stats was initially developed for the SolarisPKN ecosystem, but its architecture allows it to be used with any collection of projects that can be integrated through the available connectors.

---

# How It Works

Projects that should be analyzed are registered in:

```text
registry.json
```

For example:

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

Each project defines which platforms should be queried.

For example:

```text
solarispkn-labs
 ├── GitHub
 ├── Cloudflare
 └── PageSpeed Insights
```

While another project could use only:

```text
solarispkn-control
 └── GitHub
```

Available platforms are implemented through connectors located in:

```text
connectors/
```

---

# Architecture

The general system architecture is:

```text
                       registry.json
                            │
                            ▼
                     GitHub Actions
                            │
                  System compilation
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
       Platform API                Platform API
              │                           │
       REST / GraphQL              REST / GraphQL
              │                           │
              └─────────────┬─────────────┘
                            ▼
                    Collected data
                            │
                            ▼
                       stats.json
                            │
                            ▼
                         history/
```

The architecture separates **system deployment** from **periodic statistics collection**.

GitHub Actions is used to compile and deploy the system.

Once deployed, the Cloudflare Worker is responsible for executing collection tasks according to the schedules defined by each connector.

---

# Registry

`registry.json` is the central registry of projects that should be analyzed.

Each project can define:

* An identifier.
* The platforms that should be queried.
* The project URL when required.

Example:

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

The registry separates project configuration from the logic used to query each platform.

This means that adding a new project does not require modifying the core system.

---

# Connectors

Connectors are the components responsible for communicating with different platforms and services.

Each connector contains the logic required to work with a specific API.

A connector can define:

* Authentication.
* Endpoints.
* Query methods.
* Data to collect.
* Response processing.
* Execution schedules.
* Update frequency.
* Error handling.
* Output data handling.

The system currently uses connectors for:

* GitHub.
* Cloudflare.
* PageSpeed Insights.

The architecture is designed to allow additional platforms to be added in the future.

For example:

```text
connectors/
├── github/
├── cloudflare/
├── pagespeed/
└── ...
```

A new connector can be added without requiring changes to the core system architecture.

---

# Collection Strategy

One of the main goals of SolarisPKN-Stats is to **reduce unnecessary API requests**.

Not every statistic needs to be updated at the same frequency.

For this reason, each connector can define its own collection schedules and procedures.

For example:

```text
00:00 → GitHub
01:00 → Cloudflare
02:00 → Cloudflare
03:00 → GitHub
04:00 → PageSpeed
05:00 → Cloudflare
...
```

The actual schedules depend on the configuration of each connector.

This allows the Worker to query only the APIs that are required at a given time.

This helps reduce:

* Number of requests.
* API consumption.
* Unnecessary resource usage.
* Latency.
* Risk of reaching API limits.

---

# GraphQL Request Optimization

When a platform provides a GraphQL API, SolarisPKN-Stats can use it to reduce the number of requests required during a collection cycle.

GraphQL **is not the output format of SolarisPKN-Stats and does not replace conventional APIs**.

It is simply a query method that connectors can use when it is more efficient.

For example, a conventional API might require:

```text
GET /metric-1
GET /metric-2
GET /metric-3
GET /metric-4
GET /metric-5
```

to retrieve five different metrics.

If the platform provides GraphQL, the connector can request those metrics through a single operation:

```text
POST /graphql
```

with a query containing all required data.

This allows the Worker to retrieve more information using fewer requests.

The strategy is:

```text
                 Connector
                    │
          ┌─────────┴─────────┐
          │                   │
      Conventional API     GraphQL
          │                   │
          └─────────┬─────────┘
                    ▼
              Retrieved data
                    │
                    ▼
                  Worker
                    │
                    ▼
               stats.json
```

The method used depends on the capabilities of each platform.

SolarisPKN-Stats aims to use the most efficient query method available for each connector.

---

# First Execution

When SolarisPKN-Stats is deployed for the first time, the system performs an initial collection of statistics for the projects registered in the system.

The Worker creates the required structure for storing each project's data.

For example:

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

From that point onward, the Worker continues performing updates according to the schedules defined by the connectors.

---

# Statistics Storage

Each project has its own directory.

Inside it:

```text
stats.json
```

contains the current statistics collected for that project.

The project also contains:

```text
history/
```

where historical data is stored.

This structure keeps statistics from different projects separated.

Example:

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
└── another-project/
    ├── stats.json
    └── history/
```

---

# Raw Data

SolarisPKN-Stats prioritizes preserving statistical data in **raw JSON** format.

This allows the data to be processed later by different applications without depending on a specific interface.

The data can be used by:

* Websites.
* Dashboards.
* Scripts.
* Applications.
* Analytics tools.
* Visualization systems.
* Other projects.

The system acts as a data collection and storage layer, allowing each consumer to decide how the information should be presented or analyzed.

---

# Complete Data Flow

The general SolarisPKN-Stats flow is:

```text
1. registry.json
        │
        ▼
2. Project identification
        │
        ▼
3. Connector identification
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
        ├── Conventional API
        │
        └── GraphQL when available
        │
        ▼
7. Statistical data
        │
        ▼
8. stats.json
        │
        ▼
9. history/
```

---

# Automation

The system uses GitHub Actions to perform the initial deployment and required Worker updates.

The goal is to avoid continuously running a complete collection process through GitHub Actions.

Instead:

```text
GitHub Actions
      │
      └── deploys / updates
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

The Worker remains responsible for periodic tasks.

The connector configuration determines which APIs should be queried at each scheduled time.

---

# Features

## Collection

* Centralized project registry.
* Modular connector system.
* Multi-platform integration.
* Scheduled queries.
* Incremental updates.
* Independent schedules per connector.
* Support for conventional APIs.
* GraphQL support when available.

## Storage

* Statistics stored as JSON.
* Current data through `stats.json`.
* Historical data through `history/`.
* Independent project organization.
* Raw data preservation.

## Automation

* GitHub Actions.
* Cloudflare Workers.
* Scheduler.
* Automated deployment.
* Periodic data collection.

## Extensibility

* New projects through `registry.json`.
* New platforms through connectors.
* Independent project configuration.
* API-agnostic core architecture.

---

# Configuration

SolarisPKN-Stats requires credentials for the connectors enabled in `registry.json`.

Credentials must be stored as **Secrets** and must never be included directly in the source code.

There are two main configuration levels:

```text
GitHub Actions
      │
      └── Credentials used during deployment

Cloudflare Worker
      │
      └── Credentials used during data collection
```

---

# GitHub Actions Secrets

## `CF_API_TOKEN`

Cloudflare API token used by GitHub Actions to deploy and configure the Cloudflare Worker.

The token must have the permissions required for the Cloudflare resources used by the project.

Granting access to the required zones within the account is recommended to avoid having to modify the token whenever a new zone or project is added.

## `CF_ACCOUNT_ID`

Cloudflare account ID where the Worker will be deployed.

---

# Cloudflare Worker Secrets

The required Secrets depend on the connectors being used.

---

## Cloudflare

If the project uses Cloudflare statistics:

### `CF_API_TOKEN`

Cloudflare API token used to retrieve the required statistics.

It must have the necessary read permissions for the corresponding accounts and zones.

### `CF_ACCOUNT_ID`

Cloudflare account ID used for the queries.

---

## PageSpeed Insights

If the project uses PageSpeed Insights:

### `PAGESPEED_API_KEY`

API key used to query PageSpeed Insights.

---

## GitHub

If the project uses the GitHub connector:

### `GITHUB_TOKEN_READ`

Token used to retrieve repository statistics.

It must have the required read permissions for the repositories being analyzed.

Depending on the collected data, read access may be required for resources such as:

* Dependabot alerts.
* Actions.
* Code.
* Commit statuses.
* Issues.
* Metadata.
* Pull requests.
* Repository advisories.
* Security events.

It is recommended to limit the token to the repositories that actually need to be analyzed.

---

# Statistics Write Token

Regardless of whether GitHub is used as a statistics source, SolarisPKN-Stats requires an additional token to write the generated data to the statistics repository.

## `GITHUB_TOKEN_WRITE`

This token is used to create and update files generated by SolarisPKN-Stats.

It must have:

* **Read** access to repository metadata.
* **Read and Write** access to repository code.

This token allows the system to maintain:

```text
stats.json
history/
```

Separating:

```text
GITHUB_TOKEN_READ
```

from:

```text
GITHUB_TOKEN_WRITE
```

keeps the credentials used to retrieve GitHub information separate from those used to modify the statistics repository.

---

# Security

Tokens, API keys, and other credentials **must never be stored directly in the repository**.

All credentials should be configured through:

* GitHub Actions Secrets.
* Cloudflare Worker Secrets.

The **principle of least privilege** should be followed whenever possible.

In particular, GitHub read and write credentials should remain separate.

```text
GITHUB_TOKEN_READ
        │
        └── Statistics collection

GITHUB_TOKEN_WRITE
        │
        └── Statistics and history storage
```

---

# Compatibility and Extensibility

The SolarisPKN-Stats architecture allows new platforms to be integrated through connectors.

The core system does not need to know the internal details of each API.

For example:

```text
SolarisPKN-Stats
│
├── GitHub Connector
├── Cloudflare Connector
├── PageSpeed Connector
├── GitLab Connector
├── Bitbucket Connector
└── ...
```

Each connector is responsible for adapting its platform to the system.

This allows different projects to use different combinations of platforms.

---

# Use Cases

SolarisPKN-Stats can provide statistics to:

### Websites

Automatically display project statistics.

### Portfolios

Display repository activity and project growth.

### Dashboards

Build dashboards containing current and historical information.

### Analytics Tools

Process JSON files through scripts or external tools.

### Automation

Use statistics as input for other automated systems.

### Project Ecosystems

Centralize statistics from multiple projects and platforms.

---

# Standalone Usage

Although SolarisPKN-Stats was originally created for the SolarisPKN ecosystem, the system can be used independently.

A project only needs to:

1. Be defined in `registry.json`.
2. Use a compatible connector.
3. Have the required credentials configured.
4. Provide its URL when the project is a website.

An independent installation could therefore contain:

```text
registry.json
│
├── project-a
├── project-b
└── project-c
```

without depending on other SolarisPKN projects.

---

# Technology

Technologies currently used include:

* GitHub
* GitHub Actions
* Cloudflare Workers
* Cloudflare API
* GitHub API
* PageSpeed Insights API
* JSON
* GraphQL

GraphQL is used only as an optimized query method when supported by the corresponding platform.

The primary data storage and output format remains JSON.

---

# Repository

GitHub:

https://github.com/SolarisPKN/SolarisPKN-Stats

---

# Project Philosophy

SolarisPKN-Stats is built around three principles:

### Transparency

Statistical data is preserved in structured and reusable formats.

### Automation

Once the system is configured, statistics collection and updates are performed automatically.

### Efficiency

APIs are queried only when necessary, and when a platform provides more efficient mechanisms such as GraphQL, connectors can use them to reduce the number of requests.

The goal is not simply to create a statistics dashboard.

The goal is to build an **automated statistics data collection and storage layer** that can be consumed by different applications.

In simple terms:

> **Configure once, collect automatically, store transparently, and use the data wherever it is needed.**

---

# Roadmap

## Phase 1 — Core

* Project registry.
* Connector architecture.
* GitHub Actions.
* Cloudflare Worker deployment.
* Statistics collection.
* `stats.json` generation.

## Phase 2 — Automation

* Connector-based scheduler.
* Incremental updates.
* Statistics history.
* Query optimization.
* Additional connectors.

## Phase 3 — Integration

* Website integration.
* Dashboards.
* Visualization tools.
* Support for additional platforms.

## Phase 4 — Ecosystem

* Additional statistics providers.
* Advanced historical analysis.
* Metric aggregation.
* Automated reporting.
* Integrations with other projects.

---

# License

License information will be defined in a future version.
