const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = {
  '/': 'index.html',
  '/quietscore-offline.html': 'quietscore-offline.html',
  '/FIRST-LICENSE': 'FIRST-LICENSE',
};
http
  .createServer((request, response) => {
    const file = files[new URL(request.url, 'http://localhost').pathname];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain',
    );
    response.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(__dirname, '../dist', file)).pipe(response);
  })
  .listen(4174, '127.0.0.1');
