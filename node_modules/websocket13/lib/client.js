const Crypto = require('crypto');
const HTTP = require('http');
const HTTPS = require('https');
const StdLib = require('@doctormckay/stdlib');
const URL = require('url');
const Util = require('util');

const WS13 = require('./index.js');
const WebSocketBase = require('./base.js');

const WEBSOCKET_VERSION = 13;

Util.inherits(WebSocket, WebSocketBase);
WS13.WebSocket = WebSocket;

function WebSocket(uri, options) {
	WebSocketBase.call(this);

	uri = URL.parse(uri);

	switch (uri.protocol.toLowerCase()) {
		case 'ws:':
			this.secure = false;
			break;

		case 'wss:':
			this.secure = true;
			break;

		default:
			throw new Error("Unknown protocol scheme " + uri.protocol);
	}

	options = options || {};
	for (let option in options) {
		if (options.hasOwnProperty(option)) {
			this.options[option] = options[option];
		}
	}

	this._connectOptions = options.connection || {};
	for (let element in uri) {
		if (uri.hasOwnProperty(element) && uri[element] !== null) {
			this._connectOptions[element] = uri[element];
		}
	}

	this._connectOptions.protocol = this.secure ? "https:" : "http:";

	this.hostname = uri.hostname;
	this.port = this._connectOptions.port = parseInt(uri.port || (this.secure ? 443 : 80), 10);
	this.path = uri.path || '/';

	// clone the headers object so we don't unexpectedly modify the object that was passed in
	this.headers = JSON.parse(JSON.stringify(this.options.headers || {}));
	// Lowercase all the header names so we don't conflict (but only if they aren't already lowercase)
	for (let i in this.headers) {
		if (this.headers.hasOwnProperty(i) && i.toLowerCase() != i) {
			this.headers[i.toLowerCase()] = this.headers[i];
			delete this.headers[i];
		}
	}

	this.headers.host = this.headers.host || uri.host;
	this.headers.upgrade = 'websocket';
	this.headers.connection = 'Upgrade';
	this.headers['sec-websocket-version'] = WEBSOCKET_VERSION;
	this.headers['user-agent'] = this.headers['user-agent'] || "node.js/" + process.versions.node + " (" + process.platform + " " + require('os').release() + " " + require('os').arch() + ") node-websocket13/" + require('../package.json').version;

	if (this.options.extensions) {
		this.extensions = this.options.extensions;
	}

	let extOffer = this.extensions.generateOffer();
	if (extOffer) {
		this.headers['sec-websocket-extensions'] = extOffer;
	}

	if (this.options.protocols) {
		this.options.protocols = this.options.protocols.map(protocol => protocol.trim().toLowerCase());
		this.headers['sec-websocket-protocol'] = this.options.protocols.join(', ');
	}

	if (this.options.cookies) {
		this.headers.cookie = Object.keys(this.options.cookies).map(name => name.trim() + '=' + encodeURIComponent(this.options.cookies[name])).join('; ');
	}

	this._type = 'client';

	this._connect();
}

WebSocket.prototype._generateNonce = function() {
	this._nonce = Crypto.randomBytes(16).toString('base64');
	this.headers['sec-websocket-key'] = this._nonce;
};

WebSocket.prototype._connect = function() {
	this._generateNonce();

	this.state = WS13.State.Connecting;

	if (this.options.handshakeBody) {
		this.headers['content-length'] = this.options.handshakeBody.length;
	}

	this._connectOptions.headers = this.headers;
	if (this.secure && this.headers.host && typeof this._connectOptions.servername == 'undefined') {
		this._connectOptions.servername = this.headers.host.split(':')[0];
	}

	if (this.options.httpProxy) {
		if (this._connectOptions.agent) {
			console.error('[websocket13] Warning: "agent" connection option specified; httpProxy option ignored');
		} else {
			this._connectOptions.agent = StdLib.HTTP.getProxyAgent(this.secure, this.options.httpProxy, this.options.proxyTimeout);
		}
	}

	let req = (this.secure ? HTTPS : HTTP).request(this._connectOptions, (res) => {
		let serverHttpVersion = res.httpVersion;
		let responseCode = res.statusCode;
		let responseText = res.statusMessage;

		let err = new Error();
		err.responseCode = responseCode;
		err.responseText = responseText;
		err.httpVersion = serverHttpVersion;
		err.headers = res.headers;

		err.body = '';

		res.on('data', chunk => {
			err.body += chunk;
		});

		res.on('end', () => {
			if (this.state != WS13.State.Connecting) {
				return; // we don't care at this point
			}

			if (responseCode != 101) {
				err.message = "Response code " + responseCode;
				this._closeError(err);
				return;
			}

			err.message = "Server not upgrading connection";
			this._closeError(err);
		});
	});

	req.on('upgrade', (res, socket, head) => {
		let serverHttpVersion = res.httpVersion;
		let responseCode = res.statusCode;
		let responseText = res.statusMessage;
		let headers = res.headers;

		let err = new Error();
		err.responseCode = responseCode;
		err.responseText = responseText;
		err.httpVersion = serverHttpVersion;
		err.headers = res.headers;

		if (!headers.upgrade || !headers.connection || !headers.upgrade.match(/websocket/i) || !headers.connection.match(/upgrade/i)) {
			err.message = "Invalid server upgrade response";
			this._closeError(err);
			return;
		}

		if (!headers['sec-websocket-accept']) {
			err.message = "Missing Sec-WebSocket-Accept response header";
			this._closeError(err);
			return;
		}

		let hash = Crypto.createHash('sha1').update(this._nonce + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest('base64');
		if (headers['sec-websocket-accept'] != hash) {
			err.message = "Mismatching Sec-WebSocket-Accept header";
			err.expected = hash;
			err.actual = headers['sec-websocket-accept'];
			this._closeError(err);
			return;
		}

		if (this.state == WS13.State.Closing) {
			// we wanted to abort this connection
			this.emit('debug', "Closing newly-established connection due to abort");
			socket.end();
			socket.destroy();
			return;
		}

		if (headers['sec-websocket-protocol']) {
			let protocol = headers['sec-websocket-protocol'].toLowerCase();
			if (this.options.protocols.indexOf(protocol) == -1) {
				err.message = "Server is using unsupported protocol " + protocol;
				this._closeError(err);
				return;
			}

			this.protocol = protocol;
		}

		try {
			this.extensions.activate(headers['sec-websocket-extensions']);
		} catch (ex) {
			err.message = ex.message;
			this._closeError(err);
			return;
		}

		this._socket = socket;
		this._prepSocketEvents();
		this._resetUserTimeout();

		// Everything is okay!
		this.state = WS13.State.Connected;
		this.emit('connected', {
			"headers": headers,
			"httpVersion": serverHttpVersion,
			"responseCode": responseCode,
			"responseText": responseText
		});

		if (head && head.length > 0) {
			this._handleData(head);
		}
	});

	req.on('error', (err) => {
		if (this.state != WS13.State.Connecting) {
			return;
		}

		err.state = this.state;
		this.emit('error', err);
	});

	req.end(this.options.handshakeBody);
};

WebSocket.prototype._sendFrame = function(frame) {
	frame.maskKey = Crypto.randomBytes(32).readUInt32BE(0);
	WebSocketBase.prototype._sendFrame.apply(this, arguments);
};
