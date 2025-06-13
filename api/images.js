// api/images.js

// --- Simple in-memory rate limiter (per IP, per minute) ---
const rateLimit = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // Max requests per window per IP

function isRateLimited(ip) {
  const now = Date.now();
  if (!rateLimit[ip]) rateLimit[ip] = [];
  // Remove timestamps older than window
  rateLimit[ip] = rateLimit[ip].filter(ts => now - ts < RATE_LIMIT_WINDOW);
  if (rateLimit[ip].length >= RATE_LIMIT_MAX) return true;
  rateLimit[ip].push(now);
  return false;
}

// --- Simple in-memory response cache (per query) ---
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { value, ts: Date.now() });
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
    if (isRateLimited(ip)) {
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

    // If tags are required, uncomment the following:
    // if (!tags) return res.status(400).json({ error: 'At least one valid tag is required.' });

    // Caching: Use tags, page, and limit as cache key
    const cacheKey = `${tags}-${safePage}-${safeLimit}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json({ post: cached });
    }

    // Build Gelbooru API URL
    const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tags)}&pid=${safePage}&limit=${safeLimit}`;

    // Fetch from Gelbooru API
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const errText = contentType.includes('application/json')
        ? JSON.stringify(await response.json())
        : await response.text();
      console.error('Gelbooru error:', response.status, errText);
      return res.status(response.status).json({ error: `Gelbooru responded with status ${response.status}` });
    }

    // Parse JSON, handle errors
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('Failed to parse Gelbooru JSON:', parseError);
      return res.status(502).json({ error: 'Gelbooru returned invalid JSON.' });
    }

    // Defensive: Ensure .post is always an array
    const posts = Array.isArray(data?.post)
      ? data.post
      : (data?.post ? [data.post] : []);

    // Robust mapping, handle missing values gracefully
    const mapped = posts.map(p => ({
      id: p.id ?? null,
      tags: p.tags || '',
      preview_url: p.preview_url || '',
      file_url: p.file_url || p.sample_url || '',
      sample_url: p.sample_url || ''
    }));

    // Store in cache
    setCache(cacheKey, mapped);

    // Respond
    return res.status(200).json({ post: mapped });
  } catch (error) {
    console.error('Fetch failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
