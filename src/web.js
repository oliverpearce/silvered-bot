// The bot's web servers.
//   Public dashboard: HTTPS on 443, and port 80 for certificate checks and redirects to HTTPS.
//   Otherwise: a plain status page on PORT.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const ACME_PATH = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/;

function readCertificate({ certFile, keyFile }) {
	try {
		return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
	} catch {
		return null;
	}
}

function listen(server, port, label, onReady) {
	server.on('error', e => {
		const hint = e.code === 'EACCES' ? ' The bot needs permission to use this port (see the hosting guide).' : '';
		console.error(`[web] couldn't start ${label} on port ${port}: ${e.message}.${hint}`);
	});
	server.listen(port, onReady);
}

function startPublicWeb(app, { publicUrl, tls }) {
	let secure = null;

	function startOrReloadHttps() {
		const certificate = readCertificate(tls);
		if (!certificate) {
			console.warn(`[web] No HTTPS certificate at ${tls.certFile} yet. The dashboard is waiting for it.`);
			return;
		}
		try {
			if (secure) {
				secure.setSecureContext(certificate);
				console.log('[web] Reloaded the HTTPS certificate.');
				return;
			}
			secure = https.createServer(certificate, app);
		} catch (e) {
			console.error('[web] The HTTPS certificate could not be loaded:', e.message);
			return;
		}
		listen(secure, tls.httpsPort, 'HTTPS', () => console.log(`Dashboard: ${publicUrl}/dashboard/ (log in with Discord)`));
	}

	const redirect = http.createServer((req, res) => {
		const pathname = (req.url ?? '/').split('?')[0];
		const challenge = ACME_PATH.exec(pathname);
		if (challenge && req.method === 'GET') {
			const file = path.join(tls.acmeDir, '.well-known', 'acme-challenge', challenge[1]);
			return fs.readFile(file, (err, body) => {
				res.writeHead(err ? 404 : 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
				res.end(err ? 'Not found' : body);
			});
		}
		if (!secure) {
			res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
			return res.end('Waiting for the HTTPS certificate.');
		}
		// Always redirect to our own address, never to whatever the Host header claims.
		res.writeHead(301, { Location: `${publicUrl}${req.url ?? '/'}`, 'Cache-Control': 'no-store' });
		res.end();
	});
	listen(redirect, tls.httpPort, 'the HTTP redirect');

	// Certbot's renewal hook sends SIGHUP, so new certificates load without restarting the bot.
	const onReload = () => startOrReloadHttps();
	process.on('SIGHUP', onReload);
	startOrReloadHttps();

	return {
		close() {
			process.off('SIGHUP', onReload);
			redirect.close();
			secure?.close();
		},
	};
}

function startWeb(app, { port, publicUrl = null, tls }) {
	if (publicUrl) return startPublicWeb(app, { publicUrl, tls });
	const server = http.createServer(app);
	listen(server, port, 'the status page', () => console.log(`Status page listening on port ${port} (/health)`));
	return { close: () => server.close() };
}

module.exports = { startWeb };
