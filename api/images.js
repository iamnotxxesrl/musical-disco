// api/images.js

import Redis from 'ioredis';
import fetch from 'node-fetch';
import { Agent } from 'https';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const httpAgent = new Agent({ keepAlive: true });

const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 30; // Max requests per window per IP
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SEC) || 60; // Cache TTL in seconds

// --- Redis Rate Limiter ---
async function isRateLimited(ip) {
  const key = `ratelimit:${ip}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.pexpire(key, RATE_LIMIT_WINDOW);
  }
  return current > RATE_LIMIT_MAX;
}

// --- Redis Cache ---
async function getCache(key) {
  const data = await redis.get(`cache:${key}`);
  return data ? JSON.parse(data) : null;
}
async function setCache(key, value) {
  await redis.set(`cache:${key}`, JSON.stringify(value), 'EX', CACHE_TTL);
}

// --- Tag sanitization: only safe characters, limit tag count ---
function sanitizeTags(raw) {
  // Only allow alphanumeric, underscore, colon, dash (safe for Gelbooru)
  const allowed = /^[\w:-]+$/;
  return raw
    .split(' ')
    .map(tag => tag.trim())
    .filter(tag => tag && allowed.test(tag))
    .slice(0, 6) // Limit to 6 tags
    .join('+');
}

// --- Main handler ---
export default async function handler(req, res) {
  try {
    // Rate limiting
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.connection?.remoteAddress ||
      '';
    if (await isRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Input validation: page and limit
    const page = parseInt(req.query.page, 10);
    const limit = parseInt(req.query.limit, 10);
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;

    // Tag sanitization
    const rawTags = typeof req.query.tags === 'string' ? req.query.tags : '';
    const tags = sanitizeTags(rawTags);

    // Source selection (default: gelbooru)
    const source = req.query.source === 'danbooru' ? 'danbooru' : 'gelbooru';

    // Cache key should include source
    const cacheKey = `${source}-${tags}-${safePage}-${safeLimit}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      // Optionally add pagination metadata here if needed
      return res.status(200).json({ post: cached });
    }

    // Build API URL
    let url;
    if (source === 'danbooru') {
      // Danbooru: pages are 1-based, not 0-based
      url = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(tags)}&page=${safePage + 1}&limit=${safeLimit}`;
    } else {
      // Gelbooru
      url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tags)}&pid=${safePage}&limit=${safeLimit}`;
    }

    // Fetch from API with keep-alive agent
    const response = await fetch(url, { agent: httpAgent });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const errText = contentType.includes('application/json')
        ? JSON.stringify(await response.json())
        : await response.text();
      console.error(`${source} error:`, response.status, errText);
      return res.status(response.status).json({ error: `${source} responded with status ${response.status}` });
    }

    // Parse JSON, handle errors
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error(`Failed to parse ${source} JSON:`, parseError);
      return res.status(502).json({ error: `${source} returned invalid JSON.` });
    }

    // Data mapping
    let posts, mapped;
    if (source === 'danbooru') {
      posts = Array.isArray(data) ? data : [];
      mapped = posts.map(p => ({
        id: p.id ?? null,
        tags: p.tag_string || '',
        preview_url: p.preview_file_url ? `https://danbooru.donmai.us${p.preview_file_url}` : '',
        file_url: p.file_url ? `https://danbooru.donmai.us${p.file_url}` : '',
        sample_url: p.large_file_url ? `https://danbooru.donmai.us${p.large_file_url}` : ''
      }));
    } else {
      posts = Array.isArray(data?.post)
        ? data.post
        : (data?.post ? [data.post] : []);
      mapped = posts.map(p => ({
        id: p.id ?? null,
        tags: p.tags || '',
        preview_url: p.preview_url || '',
        file_url: p.file_url || p.sample_url || '',
        sample_url: p.sample_url || ''
      }));
    }

    // Store in cache
    await setCache(cacheKey, mapped);

    // Respond
    return res.status(200).json({ post: mapped });

  } catch (error) {
    console.error('Fetch failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
