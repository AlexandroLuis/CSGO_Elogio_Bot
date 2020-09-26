const Crypto = require('crypto');
const Extensions = require('websocket-extensions');
const URL = require('url');

const HTTPStatusCodes = require('../resources/HTTPStatusCodes.json');
const WebSocketBase = require('./base.js');
const WS13 = require('./index.js');

const HTTP_VERSION = 1.1;
const WEBSOCKET_VERSION = 13;

WS13.WebSocketServer = WebSocketServer;
require('util').inherits(WebSocketServer, require('events').EventEmitter);

function WebSocketServer(options) {
	this.options = {
		pingInterval: 10000,
		pingTimeout: 10000,
		pingFailures: 3,
		permessageDeflate: true
	};

	options = options || {};
	for (let i in options) {
		if (options.hasOwnProperty(i)) {
			this.options[i] = options[i];
		}
	}

	this.protocols = this.options.protocols || [];
}

WebSocketServer.prototype.http = function(server) {
	server.on('upgrade', (req, socket, head) => {
		if (!req.headers.upgrade || req.headers.upgrade.toLowerCase() != "websocket") {
			bail("Invalid upgrade type. Supported: websocket");
			return;
		}

		if (!req.headers.connection || req.headers.connection.toLowerCase().split(',').map(item => item.trim()).indexOf("upgrade") == -1) {
			bail("Invalid upgrade request.");
			return;
		}

		let httpV = req.httpVersion.split('.');
		if (httpV[0] < 1 || httpV[1] < 1) {
			bail("Invalid HTTP version for websocket upgrade.");
			return;
		}

		if (req.method.toUpperCase() != 'GET') {
			bail("Bad HTTP method. Required: GET");
			return;
		}

		if (!req.headers['sec-websocket-key'] || Buffer.from(req.headers['sec-websocket-key'], 'base64').length != 16) {
			bail("Missing or invalid Sec-WebSocket-Key.");
			return;
		}

		if (req.headers['sec-websocket-version'] != WEBSOCKET_VERSION) {
			bail("Sec-WebSocket-Version must be " + WEBSOCKET_VERSION + ".");
			return;
		}

		if (!socket.remoteAddress) {
			bail("Unable to determine IP address.");
			return;
		}

		let selectedProtocol = null;
		let protocols = [];
		if (req.headers['sec-websocket-protocol']) {
			protocols = req.headers['sec-websocket-protocol'].split(',').map(protocol => protocol.trim());
			// Do any of these match?

			for (let i = 0; i < protocols.length; i++) {
				if (this.protocols.indexOf(protocols[i]) != -1) {
					selectedProtocol = protocols[i];
					break;
				}
			}
		}

		let uri = URL.parse(req.url, true);

		let extensions = new Extensions();
		if (this.options.permessageDeflate) {
			extensions.add(require('permessage-deflate'));
		}
		let selectedExtensions = extensions.generateResponse(req.headers['sec-websocket-extensions']);

		let handshakeData = {
			"path": uri.pathname,
			"query": uri.query,
			"headers": req.headers,
			"httpVersion": req.httpVersion,
			"origin": req.headers.origin || null,
			"extensions": req.headers['sec-websocket-extensions'],
			"extensionsHandler": extensions,
			"selectedExtensions": selectedExtensions,
			"protocols": protocols || [],
			"selectedProtocol": selectedProtocol || null,
			"auth": null,
			"cookies": {},
			"remoteAddress": socket.remoteAddress.replace(/^::ffff:/, ''),
			"socket": socket
		};

		// Does it have HTTP authorization?
		if (req.headers.authorization) {
			let match = req.headers.authorization.match(/basic ((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4}))/i);
			if (match) {
				handshakeData.auth = Buffer.from(match[1], 'base64').toString('utf8');
			}
		}

		// Does it have cookies?
		if (req.headers.cookie) {
			req.headers.cookie.split(';').map(cookie => cookie.trim().split('=')).forEach(cookie => {
				handshakeData.cookies[cookie[0].trim()] = decodeURIComponent(cookie.slice(1).join('=').trim());
			});
		}

		// Everything looks okay so far, make sure we'd like to accept this.
		this.emit('handshake', handshakeData, (statusCode, body, headers) => {
			// REJECT
			req.statusCode = statusCode || 403;
			headers = headers || {};
			socket.end(buildResponse(statusCode || 403, headers, body));
		}, (response) => {
			// ACCEPT
			response = response || {};
			let headers = response.headers || {};

			let options = {
				"pingInterval": this.options.pingInterval,
				"pingTimeout": this.options.pingTimeout,
				"pingFailures": this.options.pingFailures,
				"extensions": extensions
			};

			headers.Upgrade = "websocket";
			headers.Connection = "Upgrade";
			headers['Sec-WebSocket-Accept'] = Crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest('base64');

			// Check if the accept method overrode our selected subprotocol
			if (typeof response.protocol !== 'undefined') {
				handshakeData.selectedProtocol = response.protocol || null;
			}

			if (response.extensions) {
				options.extensions = extensions = response.extensions;
				selectedExtensions = extensions.generateResponse(req.headers['sec-websocket-extensions']);
			}

			if (selectedExtensions) {
				headers['Sec-WebSocket-Extensions'] = selectedExtensions;
			}

			if (handshakeData.selectedProtocol) {
				headers['Sec-WebSocket-Protocol'] = handshakeData.selectedProtocol;
			}

			socket.write(buildResponse(101, headers));

			response.options = response.options || {};
			for (let i in response.options) {
				if (response.options.hasOwnProperty(i)) {
					options[i] = response.options[i];
				}
			}

			let websocket = new WebSocket(socket, options, handshakeData, head);
			this.emit('connection', websocket);
			return websocket;
		});

		function bail(err) {
			if (server.listenerCount('upgrade') != 1) {
				// Something else could pick this up
				return;
			}

			socket.end(buildResponse(400, null, err));
		}
	});
};

function buildResponse(code, headers, body) {
	let response = "HTTP/" + HTTP_VERSION + " " + code + " " + (HTTPStatusCodes[code] || "Unknown Response") + "\r\n";

	headers = headers || {};
	headers.Server = "node-websocket13/" + require('../package.json').version;
	headers.Date = new Date().toUTCString();

	if (typeof body === 'object') {
		body = JSON.stringify(body);
		headers['Content-Type'] = 'application/json';
	}

	if (body) {
		headers['Content-Length'] = Buffer.byteLength(body);
	} else if (code != 204 && code != 101) {
		headers['Content-Length'] = 0;
	}

	for (let i in headers) {
		if (headers.hasOwnProperty(i)) {
			response += i + ": " + headers[i] + "\r\n";
		}
	}

	response += "\r\n" + (typeof body !== 'undefined' ? body : '');
	return response;
}

// Server-spawned WebSocket object
require('util').inherits(WebSocket, WebSocketBase);

function WebSocket(socket, options, handshakeData, head) {
	WebSocketBase.call(this);

	options = options || {};
	for (let i in options) {
		if (options.hasOwnProperty(i)) {
			this.options[i] = options[i];
		}
	}

	this.state = WS13.State.Connected;
	this.handshakeData = handshakeData;
	this.extensions = options.extensions;
	this.protocol = handshakeData.selectedProtocol || null;

	this._socket = socket;
	this._type = 'server';

	this._prepSocketEvents();
	if (head && head.length > 0) {
		this._dataBuffer = head; // don't call _handleData just yet, as there are no event listeners bound
	}

	this.emit('connected'); // perform connect tasks
}
