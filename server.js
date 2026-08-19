const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY;
const MIME = { '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

function send(res, code, message) { res.writeHead(code, {'Content-Type':'text/plain; charset=utf-8'}); res.end(message); }
function mediaHeaders(headers) {
  const result = {'Content-Type':headers['content-type'] || 'video/mp4', 'Accept-Ranges':'bytes'};
  if (headers['content-length']) result['Content-Length'] = headers['content-length'];
  if (headers['content-range']) result['Content-Range'] = headers['content-range'];
  return result;
}
function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.htm' : decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, 'Not found');
  res.writeHead(200, {'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'});
  fs.createReadStream(filePath).pipe(res);
}
function streamDriveVideo(req, res, id, resourceKey) {
  if (!DRIVE_API_KEY) return send(res, 500, 'GOOGLE_DRIVE_API_KEY is not configured on the server.');
  if (!/^[-_a-zA-Z0-9]{10,}$/.test(id)) return send(res, 400, 'Invalid Google Drive file ID.');
  const options = {
    hostname: 'www.googleapis.com',
    path: `/drive/v3/files/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(DRIVE_API_KEY)}${resourceKey ? `&resourceKey=${encodeURIComponent(resourceKey)}` : ''}`,
    headers: req.headers.range ? {Range:req.headers.range} : {}
  };
  https.get(options, driveRes => {
    if (driveRes.statusCode >= 400) {
      const chunks = [];
      driveRes.on('data', chunk => chunks.push(chunk));
      driveRes.on('end', () => {
        const detail = Buffer.concat(chunks).toString('utf8');
        console.error(`Google Drive stream failed for ${id}: HTTP ${driveRes.statusCode} ${detail}`);
        send(res, driveRes.statusCode, 'Google Drive rejected the stream request. Check Render logs for the detailed reason.');
      });
      return;
    }
    if (driveRes.statusCode >= 300 && driveRes.statusCode < 400 && driveRes.headers.location) {
      driveRes.resume();
      return https.get(driveRes.headers.location, redirected => {
        res.writeHead(redirected.statusCode, mediaHeaders(redirected.headers));
        redirected.pipe(res);
      });
    }
    res.writeHead(driveRes.statusCode, mediaHeaders(driveRes.headers));
    driveRes.pipe(res);
  }).on('error', () => send(res, 502, 'Unable to stream this Google Drive video.'));
}
http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/api\/video\/([-_a-zA-Z0-9]+)$/);
  if (match) return streamDriveVideo(req, res, match[1], url.searchParams.get('resourceKey'));
  serveStatic(req, res);
}).listen(PORT, () => console.log(`Salon site running on port ${PORT}`));
