export default async function handler(req, res) {
  const tags = (req.query.tags || '').split(' ').filter(Boolean).join('+');
  const page = Number(req.query.page) || 0;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tags)}&pid=${page}&limit=${limit}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Gelbooru error:', response.status);
      return res.status(500).json({ error: 'Gelbooru responded with status ' + response.status });
    }
    const data = await response.json();
    const posts = Array.isArray(data.post) ? data.post : [];
    const mapped = posts.map(p => ({
      id: p.id,
      tags: p.tags,
      preview_url: p.preview_url,
      file_url: p.file_url || p.sample_url,
      sample_url: p.sample_url
    }));
    return res.status(200).json({ post: mapped });
  } catch (error) {
    console.error('Fetch failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
