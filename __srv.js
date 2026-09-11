const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2] || process.cwd();
const port = parseInt(process.argv[3] || '8080', 10);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.webp': 'image/webp',
  '.css': 'text/css'
};
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const p = path.join(root, u);
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404: ' + u); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(port, '0.0.0.0', () => console.log('STATIC SERVER UP -> http://localhost:' + port + '  (root=' + root + ')'));
