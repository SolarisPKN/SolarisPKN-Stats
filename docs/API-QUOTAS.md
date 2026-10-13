# Free API budgets and quota-aware connectors — October 2026

Distinguish **provider limits** from **our deliberately smaller budgets**. Only public repositories, websites and channel aggregates are eligible for publication; private learning, personal devices and client data are excluded.

| Connector | Poll cadence | Calls/source/day | Worst-case external calls/run | Runtime secrets |
| --- | --- | --- | --- | --- |
| `github` | 6h | 4 | 1 | `GITHUB_TOKEN_READ` |
| `github-actions` | 12h | 2 | 1 | `GITHUB_TOKEN_READ` |
| `cloudflare` | 6h | 4 | 1 | `CF_API_TOKEN` |
| `pagespeed` | 24h | 1 | 1 | `PAGESPEED_API_KEY` |
| `http-health` | 6h | 4 | 1 | None |
| `youtube-public` | 12h | 2 | 1 (1 quota unit) | `YOUTUBE_API_KEY` |
| `twitch-public` | 6h | 4 | Up to 2 | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` |
| `cloudflare-workers` | 12h | 2 | 1 | `CF_WORKERS_ANALYTICS_TOKEN`, `CF_ACCOUNT_ID` |
| `r2-public-health` | 12h | 2 | 1 | None |

Per-project UTC spreading preserves these intervals. `quota-policy.js` rejects unsafe schedules and caps external requests at **39 estimated subrequests per hourly invocation** vs the Workers Free ceiling of **50**. Budgets account for connector calls plus reading/writing Stats.json and daily snapshots.

Actual upstream limits (subject to account / API policies):
- Workers Free: 100,000 requests/day, 50 external subrequests/invocation.
- Cloudflare GraphQL Analytics: default ~300 queries/5-minute period, plus dataset- and plan-dependent restrictions.
- R2 Standard Free: 10 GB-month storage, 1M Class A and 10M Class B operations/month.
- YouTube Data API: default 10,000 general quota units/day; `channels.list` costs 1. Public summaries need no channel owner OAuth.
- Twitch Helix: token bucket rate limits; inspect `Ratelimit-Limit`, `Ratelimit-Remaining` and `Ratelimit-Reset` headers rather than assuming a fixed amount.
- Google Search Console Search Analytics: 1,200 requests/minute/site plus load quotas (not implemented yet).
- GA4 Data API: Standard property up to 200,000 Core tokens/day (not implemented yet).
- Arduino Cloud Free: 2 Things, 5 variables/Thing, 1 day storage history, API access 10 req/second according to the current official plans table (deliberately not connected to this public repository).
- YouTube Analytics owner reports: OAuth permissions required; not enabled without explicit channel-owner authorization.

**Activation:** Set secret values only on the Cloudflare Worker runtime. Missing optional secrets cause their collectors to skip without API calls. GitHub never receives these values through the public registry. Twitch uses app credentials and never requests viewer account credentials. R2 is an allowlisted HEAD request to the public Transport `current.json` endpoint, without reading the object body. Workers Analytics records are explicitly **sampled**, not exhaustive totals.

On HTTP 429 there is no immediate retry; remaining tasks for that connector stop until the next scheduled cron. Historical Stats.json remains intact.

A minute-by-minute livestream tracker is a different service: it should run only while streaming rather than producing dozens of public Git commits.

Provider documentation: https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/analytics/graphql-api/limits/ , https://developers.cloudflare.com/r2/pricing/ , https://developers.google.com/youtube/v3/determine_quota_cost , https://dev.twitch.tv/docs/api/guide , https://developers.google.com/webmaster-tools/limits , https://developers.google.com/analytics/devguides/reporting/data/v1/quotas , https://cloud.arduino.cc/plans/ , https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/ .

**Offline validation:** `STATS_BUILD_ONLY=true node compile-worker.js`, `node --test tests/*.test.cjs`. CI does not deploy and does not fetch production credentials.
