// /api/images.js

export default async function handler(req, res) {
  try {
    // Only allow GET requests
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const rawTags = (req.query.tags || '').toString().trim();
    const tags = encodeURIComponent(rawTags.replace(/\s+/g, '+'));

    const page = parseInt(req.query.page) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 40, 70); // max 100 posts per request

    const gelbooruUrl = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${tags}&pid=${page}&limit=${limit}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000); // 100ms second timeout

    const response = await fetch(gelbooruUrl, { signal: controller.signal });

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch from Gelbooru: ${response.statusText}`,
        status: response.status
      });
    }

    const json = await response.json();

    // Normalize the response
    const posts = Array.isArray(json.post) ? json.post : [];

    const formatted = posts.map(post => ({
      id: post.id,
      tags: post.tags || '',
      preview_url: post.preview_url,
      file_url: post.file_url || post.sample_url || '',
      sample_url: post.sample_url || '',
      width: post.width,
      height: post.height,
      rating: post.rating,
      score: post.score,
      source: post.source || '',
    }));

    return res.status(200).json({ count: formatted.length, post: formatted });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request to Gelbooru timed out' });
    }

    console.error('[images.js] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
