// Twitch Helix live status using an application token. No user/follower/private data.
let cachedToken = null;
let cachedTokenUntil = 0;
module.exports = {
  id: 'twitch-public',
  hours: [3, 9, 15, 21], // baseline polling: 4 times/day, not live minute-by-minute
  externalRequests: 2, // OAuth token + Helix streams (worst-case)
  maxDailyCalls: 4,
  requiredSecrets: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'],
  async fetchData(projectId, task, env) {
    const login = task.twitchLogin;
    if (!/^[A-Za-z0-9_]{3,25}$/.test(login || ''))
      throw new Error('twitchLogin must be a public Twitch login');
    if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET)
      throw new Error('Twitch application credentials are not configured');
    let token = cachedTokenUntil > Date.now() + 60000 ? cachedToken : null;
    if (!token) {
      const credentials = new URLSearchParams({
        client_id: env.TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials'
      });
      const auth = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST', body: credentials, redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (!auth.ok) {
        const error = new Error('Twitch app authentication HTTP ' + auth.status);
        error.httpStatus = auth.status;
        throw error;
      }
      const body = await auth.json();
      if (!body.access_token || !Number.isFinite(Number(body.expires_in)))
        throw new Error('Invalid Twitch app token response');
      token = body.access_token;
      cachedToken = token;
      cachedTokenUntil = Date.now() + Math.min(86400, Number(body.expires_in)) * 1000;
    }
    const url = new URL('https://api.twitch.tv/helix/streams');
    url.searchParams.set('user_login', login);
    const response = await fetch(url.toString(), {
      redirect: 'manual',
      headers: {
        'Client-ID': env.TWITCH_CLIENT_ID,
        Authorization: 'Bearer ' + token
      }
    });
    if (!response.ok) {
      if (response.status === 401) { cachedToken = null; cachedTokenUntil = 0; }
      const error = new Error('Twitch Helix HTTP ' + response.status);
      error.httpStatus = response.status;
      throw error;
    }
    const json = await response.json();
    const stream = Array.isArray(json.data) ? json.data[0] : null;
    const remaining = response.headers?.get?.('Ratelimit-Remaining');
    return {
      login: login.toLowerCase(),
      live: !!stream && stream.type === 'live',
      viewers: stream ? Number(stream.viewer_count || 0) : 0,
      startedAt: stream?.started_at || null,
      gameName: stream?.game_name || null,
      // Token buckets reset each minute and vary by app.
      _rateLimit: remaining ? { remainingPoints: Number(remaining) } : null
    };
  }
};
