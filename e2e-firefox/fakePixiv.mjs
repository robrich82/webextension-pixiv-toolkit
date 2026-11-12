import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import fakePixivRoutes from '../e2e/fakePixivRoutes.js';

const { PIXIV_HOSTS: HOSTS, PIXEL, pixivResponse } = fakePixivRoutes;

// Re-exported for the tests' page bodies.
export { PIXEL };

/**
 * A throwaway self-signed certificate. Firefox runs with acceptInsecureCerts,
 * so nothing has to trust it; it only has to exist.
 */
function makeCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-cert-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');

  try {
    // stderr is kept so a missing or too-old openssl (`-addext` needs 1.1.1) says why.
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=pixiv e2e', '-addext', `subjectAltName=${HOSTS.map(host => `DNS:${host}`).join(',')}`,
      '-keyout', key, '-out', cert
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * An HTTPS proxy standing in for pixiv. Firefox sends every request through it:
 * www.pixiv.net and i.pximg.net are answered by e2e/fakePixivRoutes.js, the
 * routing the Chromium suite uses too, and any other host is refused, so a run
 * never reaches the network.
 *
 * @param {Parameters<typeof pixivResponse>[1]} routes
 */
export async function startFakePixiv(routes) {
  const { key, cert } = makeCertificate();
  const requests = [];
  const refused = [];
  // CONNECT sockets leave the proxy's own connection tracking, so close() ends them here.
  const tunnels = new Set();

  const respond = (res, status, contentType, body) => {
    body = Buffer.from(body);
    res.writeHead(status, { 'content-type': contentType, 'content-length': body.length });
    res.end(body);
  };

  const site = http.createServer((req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    requests.push(url.href);

    const response = pixivResponse(url, routes);

    if (!response) {
      refused.push(url.host);
      return respond(res, 403, 'text/plain', 'refused');
    }

    respond(res, response.status, response.contentType, response.body);
  });

  const proxy = http.createServer((req, res) => {
    // Plain-http proxy requests: pixiv is https-only, so nothing here is ours.
    refused.push(req.url);
    respond(res, 403, 'text/plain', 'refused');
  });

  proxy.on('connect', (req, socket, head) => {
    const host = req.url.split(':')[0];

    tunnels.add(socket);
    socket.once('close', () => tunnels.delete(socket));

    // A tunnel resets when Firefox hangs up or exits; that isn't a failure.
    socket.on('error', () => socket.destroy());

    if (!HOSTS.includes(host)) {
      refused.push(host);
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }

    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) {
      socket.unshift(head);
    }
    const tunnel = new tls.TLSSocket(socket, { isServer: true, key, cert, ALPNProtocols: ['http/1.1'] });
    tunnel.on('error', () => tunnel.destroy());
    site.emit('connection', tunnel);
  });

  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));

  return {
    port: proxy.address().port,
    requests,
    refused,
    close: () => new Promise(resolve => {
      tunnels.forEach(socket => socket.destroy());
      proxy.closeAllConnections();
      proxy.close(() => resolve());
    })
  };
}
