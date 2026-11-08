'use strict';
// Conservative application budgets, NOT provider advertised ceilings.
// Must be kept smaller than published provider quotas and other app usage.
const DAILY_CAPS = Object.freeze({
  github: 120,             // GraphQL calls for registered public repos
  'github-actions': 60,    // REST calls shared with GitHub API
  cloudflare: 24,          // zone-level GraphQL requests
  'cloudflare-workers': 8, // account-level GraphQL samples
  pagespeed: 8,           // Lighthouse can be slow and expensive
  'http-health': 48,
  'youtube-public': 10,   // YouTube Data API quota units, not raw HTTP count
  'twitch-public': 16,    // Helix collection attempts
  'r2-public-health': 12
});
const MAX_EXTERNAL_PER_CRON = 39; // Cloudflare Workers Free: 50 incl. redirects

function validateConnectorPolicies(connectors) {
  for (const [id, c] of Object.entries(connectors)) {
    if (!Object.hasOwn(DAILY_CAPS, id))
      throw new Error('Unreviewed connector policy: ' + id);
    const hours = c.hours;
    if (!Array.isArray(hours) || !hours.length ||
        hours.some(h => !Number.isInteger(h) || h < 0 || h > 23) ||
        new Set(hours).size !== hours.length)
      throw new Error('Invalid hours for connector ' + id);
    if (!Number.isInteger(c.maxDailyCalls) || hours.length > c.maxDailyCalls ||
        c.maxDailyCalls > 24)
      throw new Error('maxDailyCalls exceeded for ' + id);
    if (!Number.isInteger(c.externalRequests) || c.externalRequests < 1 ||
        c.externalRequests > 5)
      throw new Error('Invalid worst-case externalRequests for ' + id);
    const sorted = [...hours].sort((a, b) => a - b);
    const requiredGap = Math.floor(24 / hours.length);
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[(i + 1) % sorted.length];
      const gap = (next - sorted[i] + 24) % 24 || 24;
      if (gap < requiredGap)
        throw new Error('Polls too close for ' + id + ': ' + gap + 'h');
    }
  }
}

function analyzePlan(plan, projects, connectors) {
  const byConnector = {};
  const byHour = {};
  for (let hour = 0; hour < 24; hour++) {
    const hourPlan = plan[hour] || {};
    // worst case: stats read + write plus connector calls;
    // one daily snapshot may use stats GET, history GET and PUT.
    let external = projects.filter((_, idx) => idx % 24 === hour).length * 3;
    for (const [platform, tasks] of Object.entries(hourPlan)) {
      const connector = connectors[platform];
      if (!connector) throw new Error('Unknown connector ' + platform);
      external += tasks.length * (connector.externalRequests + 2);
      const units = connector.quotaUnitsPerCall || 1;
      byConnector[platform] = (byConnector[platform] || 0) + tasks.length * units;
    }
    byHour[hour] = external;
    if (external > MAX_EXTERNAL_PER_CRON)
      throw new Error('Hour ' + hour + ': ' + external +
        ' estimated external requests exceeds safe budget ' + MAX_EXTERNAL_PER_CRON);
  }
  for (const [platform, units] of Object.entries(byConnector)) {
    const cap = DAILY_CAPS[platform];
    if (units > cap)
      throw new Error('Daily budget exceeded for ' + platform + ': ' + units + '/' + cap);
  }
  return { byHour, byConnector, caps: DAILY_CAPS, maxExternalPerCron: MAX_EXTERNAL_PER_CRON };
}

module.exports = { DAILY_CAPS, MAX_EXTERNAL_PER_CRON, validateConnectorPolicies, analyzePlan };
