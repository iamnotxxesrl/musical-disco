const express = require('express');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

app.get('/api/images', async (req, res) => {
  try {
    const tags = (req.query.tags || '').split(' ').filter(Boolean).join('+');
    const page = parseInt(req.query.page) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    // Build Gelbooru API URL
    const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&tags=${tags}&pid=${page}&limit=${limit}&json=1`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Gelbooru API error ${response.status}`);

    const data = await response.json();

    // Normalize response to match frontend expectations
    // Gelbooru returns { post: [...] } or empty object if no posts
    const posts = Array.isArray(data.post) ? data.post : [];

    // Map to safer, uniform keys
    const mappedPosts = posts.map(p => ({
      id: p.id,
      tags: p.tags,
      preview_url: p.preview_url,
      file_url: p.file_url || p.sample_url,
      sample_url: p.sample_url,
    }));

    res.json({ post: mappedPosts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch from Gelbooru API' });
  }
});

app.listen(port, () => {
  console.log(`Gelbooru proxy API listening at http://localhost:${port}`);
});
