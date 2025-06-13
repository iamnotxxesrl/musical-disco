// api/images.js
// A single, dependency-free backend script for fetching images.

// --- 1. Configuration & Constants ---

const FETCH_TIMEOUT = 8000; // 8 seconds, crucial for resilience
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 45;

// A modular source configuration makes the code clean and easy to extend.
const SOURCES = {
  gelbooru: {
    buildUrl: ({ tags, page, limit, sort }) => {
      const sortMap = {
        popular: 'sort:score:desc',
        date: 'sort:id:desc',
        random: 'sort:random',
      };
      const url = new URL('https://gelbooru.com/index.php');
      url.search = new URLSearchParams({
        page: 'dapi',
        s: 'post',
        q: 'index',
        json: 1,
        tags: `${tags} ${sortMap[sort] || sortMap.date}`,
        pid: page,
        limit,
      }).toString();
      return url.href;
    },
    mapper: (post) => ({
      id: post.id ?? null,
      tags: post.tags || '',
      preview_url: post.preview_url || '',
      file_url: post.file_url || '',
      sample_url: post.sample_url || '',
    }),
    getPosts: (data) => Array.isArray(data?.post) ? data.post : [],
  },
  danbooru: {
    buildUrl: ({ tags, page, limit, sort }) => {
      const sortMap = {
        popular: 'order:rank',
        date: 'order:id',
        random: 'order:random'
      };
      const url = new URL('https://danbooru.donmai.us/posts.json');
      url.search = new URLSearchParams({
        tags: `${tags} ${sortMap[sort] || sortMap.date}`,
        page: page + 1, // Danbooru pages are 1-based
        limit,
      }).toString();
      return url.href;
    },
    mapper: (post) => ({
      id: post.id ?? null,
      tags: post.tag_string || '',
      preview_url: post.preview_file_url || '',
      file_url: post.file_url || '',
      sample_url: post.large_file_url || '',
    }),
    getPosts: (data) => Array.isArray(data) ? data : [],
  },
};


// --- 2. In-Memory Services (Optimized for Serverless) ---
// NOTE: In a serverless environment, this state is NOT shared globally but is reused
// by "warm" function instances, making it effective for handling short-term bursts of traffic.

const cache = new Map();
function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}
function setInCache(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
}

const rateLimiter = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  let record = rateLimiter.get(ip);

  // If record is old or doesn't exist, create a new one
  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW_MS) {
    record = { count: 1, timestamp: now };
    rateLimiter.set(ip, record);
    return false;
  }

  // If record is still valid, increment and check against the limit
  record.count++;
  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  
  rateLimiter.set(ip, record);
  return false;
}


// --- 3. Utilities ---

function sanitizeTags(raw) {
  const allowed = /^[\w:-]+$/; // Allow letters, numbers, underscore, colon, dash
  return raw
    .split(' ')
    .map(t => t.trim().toLowerCase())
    .filter(t => t && allowed.test(t))
    .slice(0, 6) // Limit to 6 tags for API sanity
    .join(' ');
}

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}


// --- 4. Main Exported Handler ---

export default async function handler(req, res) {
  try {
    // Determine client IP for rate limiting, prioritizing common proxy headers
    const ip = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '';
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many requests. Please calm down.' });
    }

    // Validate and sanitize all inputs
    const sourceKey = req.query.source === 'danbooru' ? 'danbooru' : 'gelbooru';
    const sourceConfig = SOURCES[sourceKey];
    
    const page = parseInt(req.query.page, 10);
    const limit = parseInt(req.query.limit, 10);
    const sort = ['popular', 'date', 'random'].includes(req.query.sort) ? req.query.sort : 'date';

    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const tags = sanitizeTags(typeof req.query.tags === 'string' ? req.query.tags : '');

    // Check cache first
    const cacheKey = `images:${sourceKey}:${tags}:${sort}:${safePage}:${safeLimit}`;
    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      res.setHeader('X-Cache-Status', 'HIT');
      return res.status(200).json(cachedData);
    }
    res.setHeader('X-Cache-Status', 'MISS');

    // Fetch from the selected source API
    const apiUrl = sourceConfig.buildUrl({ tags, page: safePage, limit: safeLimit, sort });
    const response = await fetchWithTimeout(apiUrl);

    if (!response.ok) {
      console.error(`${sourceKey} API error:`, { status: response.status, url: apiUrl });
      return res.status(response.status).json({ error: `${sourceKey} API returned an error.` });
    }

    const data = await response.json();
    const posts = sourceConfig.getPosts(data);
    const mapped = posts.map(sourceConfig.mapper);
    
    const responseData = { post: mapped };
    setInCache(cacheKey, responseData);
    
    return res.status(200).json(responseData);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Upstream API request timed out:', error);
      return res.status(504).json({ error: 'The request to the image provider timed out.' });
    }
    console.error('Internal Server Error:', error);
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
}
