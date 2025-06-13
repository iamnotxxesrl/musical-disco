import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const { tags = '', page = 0 } = req.query;
    const limit = 20; // how many images per page

    // Gelbooru API URL format:
    // https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=...&pid=...
    // pid = page index, zero-based

    const apiUrl = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tags)}&pid=${page}`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to fetch from Gelbooru' });
    }

    const data = await response.json();

    // data.post might be an array or a single object
    // Normalize it to array
    let posts = [];
    if (Array.isArray(data.post)) {
      posts = data.post;
    } else if (data.post) {
      posts = [data.post];
    }

    // Only return necessary fields to frontend for security and simplicity
    const filteredPosts = posts.map(post => ({
      id: post.id,
      preview_url: post.preview_url,
      file_url: post.file_url,
      sample_url: post.sample_url,
      tags: post.tags,
    }));

    res.status(200).json({ post: filteredPosts });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
