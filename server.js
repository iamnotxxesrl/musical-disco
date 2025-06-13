const express = require('express');
const fetch = require('node-fetch'); // npm install node-fetch@2
const app = express();
const PORT = 3000;

app.use(express.static('.')); // serve static files like index.html

app.get('/api/images', async (req, res) => {
  const tags = req.query.tags || '';
  const page = req.query.page || 0;

  // Example Gelbooru API call:
  const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(tags)}&pid=${page}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
