/**
 * Run this example and either enter ws://127.0.0.1:8080 at http://www.websocket.org/echo.html or point echoclient.js at it.
 */

const HTTP = require('http');
const WS13 = require('../lib/index.js'); // use require('websocket13') when installed from npm

let webserver = HTTP.createServer(function(req, res) {
	res.writeHead(403, {"Content-Type": "text/html"});
	res.end("<html><body><h1>Forbidden</h1>This server only accepts WebSocket connections.</body></html>");
});

webserver.listen(8080);

let server = new WS13.WebSocketServer({
	"protocols": ["foo", "bar"], // we can use these subprotocols
	"pingInterval": 15000 // we will sent pings to child sockets every 15 seconds
});

server.http(webserver); // use our webserver to accept connections

server.on('handshake', (handshakeData, reject, accept) => {
	console.log("Incoming handshake from " + handshakeData.remoteAddress + " at origin " + handshakeData.origin + "\n  " +
		"Path: " + handshakeData.path + "\n  " +
		"Auth: " + handshakeData.auth + "\n  " +
		"We will use subprotocol: " + handshakeData.selectedProtocol);

	if (handshakeData.path == "/notfound") {
		// We don't accept connections to this path. It doesn't exist.
		reject(404);
		return;
	}

	if (handshakeData.path == "/requiresauth" && handshakeData.auth != "aladdin:opensesame") {
		// This path needs authentication
		reject(401, null, {"WWW-Authenticate": "Basic realm=\"Please enter your username and password\""});
		return;
	}

	// We'll accept this request. Add a custom header for our application. Also override the ping timeout length.
	let websocket = accept({
		"headers": {"X-App-Header": "foobar"},
		"options": {"pingTimeout": 15000}
	});

	// accept() returns the new WebSocket object
	//websocket.send("Hi there! Welcome to our echo server!");
});

server.on('connection', (socket) => {
	// You can also get a new websocket from the `connection` event. It has a `handshakeData` property which is
	// identical to the handshakeData in the `handshake` event.
	console.log("Connection established from " + socket.handshakeData.remoteAddress + " to " + socket.handshakeData.path);

	socket.on('disconnected', (code, reason, initiatedByUs) => {
		console.log("Connection from " + socket.handshakeData.remoteAddress + " to " + socket.handshakeData.path + " closed with code " + code + " and reason " + reason);
	});

	socket.on('message', (type, data) => {
		// We got a message. Sent it back.
		socket.send(data);
	});

	socket.on('streamedMessage', (type, stream) => {
		// Create a new stream and pipe our input into it
		let out = socket.createMessageStream(type);
		stream.pipe(out);
	});

	socket.on('error', (err) => {
		console.log("Connection from " + socket.handshakeData.remoteAddress + " to " + socket.handshakeData.path + " closed: " + err.message);
	});

	socket.on('debug', (msg) => {
		//console.log(msg);
	});

	socket.on('latency', (time) => {
		console.log("Client from " + socket.handshakeData.remoteAddress + " has latency: " + time + " ms");
	});
});
