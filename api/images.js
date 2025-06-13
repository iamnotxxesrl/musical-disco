import fetch from 'node-fetch';

export default async function handler(req, res) {
  const tags = (req.query.tags || '').split(' ').filter(Boolean).join('+');
  const page = Math.max(parseInt(req.query.page) || 0, 0);
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);

  const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${tags}&pid=${page}&limit=${limit}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Gelbooru ${response.status}`);
    const data = await response.json();
    const posts = Array.isArray(data.post) ? data.post : [];

    const mapped = posts.map(p => ({
      id: p.id,
      tags: p.tags,
      preview_url: p.preview_url,
      sample_url: p.sample_url,
      file_url: p.file_url || p.sample_url,
    }));

    res.status(200).json({ post: mapped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch Gelbooru data' });
  }
}
