const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('OK'); return; }
  if (req.url === '/v1/models') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock/claude-sonnet-4-6', owned_by: 'mock' }] }));
    return;
  }
  res.writeHead(404); res.end();
}).listen(20128, () => process.stderr.write('mock-router up\n'));
