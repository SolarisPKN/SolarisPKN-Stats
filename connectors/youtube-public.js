// One public YouTube channel summary per request. No OAuth or video search.
module.exports = {
  id: 'youtube-public',
  hours: [8, 20],
  externalRequests: 1,
  maxDailyCalls: 2,
  quotaUnitsPerCall: 1, // YouTube Data API channels.list
  async fetchData(projectId, task, env) {
    const handle = task.youtubeHandle;
    if (!/^@[A-Za-z0-9._-]{3,100}$/.test(handle || ''))
      throw new Error('youtubeHandle must be a public YouTube @handle');
    if (!env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY not configured');
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'statistics,snippet');
    url.searchParams.set('forHandle', handle);
    url.searchParams.set('key', env.YOUTUBE_API_KEY);
    const response = await fetch(url.toString(), { redirect: 'manual' });
    if (!response.ok) {
      const error = new Error('YouTube Data API HTTP ' + response.status);
      error.httpStatus = response.status;
      throw error;
    }
    const json = await response.json();
    const channel = Array.isArray(json.items) ? json.items[0] : null;
    if (!channel) throw new Error('YouTube public channel not found');
    const stats = channel.statistics || {};
    const count = value => /^\d+$/.test(String(value ?? '')) ? Number(value) : null;
    return {
      channelId: channel.id || null,
      channelTitle: channel.snippet?.title || null,
      views: count(stats.viewCount),
      subscribers: stats.hiddenSubscriberCount ? null : count(stats.subscriberCount),
      subscribersHidden: !!stats.hiddenSubscriberCount,
      videos: count(stats.videoCount),
      source: 'YouTube Data API channels.list'
    };
  }
};
