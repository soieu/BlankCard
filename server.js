const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// MIME types
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ decks: [] }, null, 2), 'utf8');
}

const server = http.createServer((req, res) => {
  // API: GET /api/data
  if (req.method === 'GET' && req.url === '/api/data') {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
    return;
  }

  // API: POST /api/data
  if (req.method === 'POST' && req.url === '/api/data') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body); // validate
        fs.writeFileSync(DATA_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"Invalid JSON"}');
      }
    });
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Blank Card 서버 실행 중: http://localhost:${PORT}`);
});
