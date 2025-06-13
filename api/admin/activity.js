// /api/admin/activity.js

// In-memory tracking of activity (by IP address)
const activeUsers = new Map();

export default function handler(req, res) {
  // Only allow admin IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress || '';
  if (ip !== '190.80.34.73') return res.status(403).json({ error: "Forbidden" });

  // Clean up inactive users (10 min inactivity)
  const now = Date.now();
  for (const [user, ts] of activeUsers.entries()) {
    if (now - ts > 10 * 60 * 1000) { // 10 minutes
      activeUsers.delete(user);
    }
  }

  // Return all active users (last 10 min)
  res.status(200).json({
    count: activeUsers.size,
    users: Array.from(activeUsers.keys())
  });
}

// Middleware to track activity (by IP address)
// Place this in your main backend entry (e.g., api/images.js or your server.js)
export function trackUserActivity(req) {
  const userIp = req.headers['x-forwarded-for']?.split(',')[0] || req.connection?.remoteAddress || '';
  activeUsers.set(userIp, Date.now());
}
