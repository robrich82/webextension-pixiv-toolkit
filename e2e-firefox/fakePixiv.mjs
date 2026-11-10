import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');
const HOSTS = ['www.pixiv.net', 'i.pximg.net'];
// 1x1 transparent PNG, served for every unmapped i.pximg.net request.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * A throwaway self-signed certificate. Firefox runs with acceptInsecureCerts,
 * so nothing has to trust it; it only has to exist.
 */
function makeCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-cert-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');

  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=pixiv e2e', '-addext', `subjectAltName=${HOSTS.map(host => `DNS:${host}`).join(',')}`,
    '-keyout', key, '-out', cert
  ], { stdio: 'ignore' });

  const pair = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  fs.rmSync(dir, { recursive: true, force: true });

  return pair;
}

/**
 * An HTTPS proxy standing in for pixiv, with the same rules as e2e/fixtures.js
 * mockPixiv(). Firefox sends every request through it: www.pixiv.net and
 * i.pximg.net are answered from test/fixtures, and any other host is refused,
 * so a run never reaches the network.
 *
 * @param {{ ajax: Record<string, string>, pximg?: Record<string, string|{ contentType: string, body: Buffer }> }} routes
 */
export async function startFakePixiv({ ajax, pximg = {} }) {
  const { key, cert } = makeCertificate();
  const requests = [];
  const refused = [];

  const respond = (res, status, contentType, body) => {
    res.writeHead(status, { 'content-type': contentType, 'content-length': body.length });
    res.end(body);
  };
  const fixture = name => fs.readFileSync(path.join(FIXTURES, name));

  const site = http.createServer((req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    requests.push(url.href);

    if (url.hostname === 'i.pximg.net') {
      const route = pximg[url.pathname];

      if (typeof route === 'string') {
        return respond(res, 200, route.endsWith('.zip') ? 'application/zip' : 'application/octet-stream', fixture(route));
      }

      return route ? respond(res, 200, route.contentType, route.body) : respond(res, 200, 'image/png', PIXEL);
    }

    if (ajax[url.pathname]) {
      return respond(res, 200, 'application/json', fixture(ajax[url.pathname]));
    }

    if (!url.pathname.startsWith('/ajax/')) {
      return respond(res, 200, 'text/html', Buffer.from('<!doctype html><html><head><title>pixiv</title></head><body></body></html>'));
    }

    respond(res, 404, 'application/json', Buffer.from('{"error":true,"body":[]}'));
  });

  const proxy = http.createServer((req, res) => {
    // Plain-http proxy requests: pixiv is https-only, so nothing here is ours.
    refused.push(req.url);
    respond(res, 403, 'text/plain', Buffer.from('refused'));
  });

  proxy.on('connect', (req, socket) => {
    const host = req.url.split(':')[0];

    // A tunnel resets when Firefox hangs up or exits; that isn't a failure.
    socket.on('error', () => socket.destroy());

    if (!HOSTS.includes(host)) {
      refused.push(host);
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }

    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
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
      proxy.closeAllConnections();
      site.closeAllConnections();
      proxy.close(() => resolve());
    })
  };
}
