const ByteBuffer = require('bytebuffer');
const Crypto = require('crypto');
const Events = require('events');
const Extensions = require('websocket-extensions');
const Util = require('util');

const StreamedIncomingMessage = require('./StreamedIncomingMessage.js');
const StreamedOutgoingMessage = require('./StreamedOutgoingMessage.js');
const WS13 = require('./index.js');

Util.inherits(WebSocketBase, Events.EventEmitter);
module.exports = WebSocketBase;

function WebSocketBase() {
	this.state = WS13.State.Closed;
	this.extensions = new Extensions();
	this.extensions.add(require('permessage-deflate'));
	this.protocol = null;

	this.options = {
		"pingInterval": 10000,
		"pingTimeout": 10000,
		"pingFailures": 3
	};

	this._data = {};
	this._outgoingFrames = []; // holds frame objects which we haven't sent yet
	this._dataBuffer = Buffer.alloc(0); // holds raw TCP data that we haven't processed yet
	this._incomingStream = null; // StreamedIncomingMessage object for the current message
	this._extensionProcessingOutgoingFrameId = 0;

	this.on('connected', () => {
		this._pingFailures = 0;
		this._queuePing();
	});
}

/**
 * Disconnect the websocket gracefully.
 * @param {number} [code=WS13.StatusCode.NormalClosure] - A value from the WS13.StatusCode enum to send to the other side
 * @param {string} [reason] - An optional reason string to send to the other side
 */
WebSocketBase.prototype.disconnect = function(code, reason) {
	if (this.state == WS13.State.Connecting && this._socket) {
		this._socket.end();
		this._socket.destroy();
		this.state = WS13.State.Closed;
	} else if (this.state == WS13.State.Connecting && !this._socket) {
		this.state = WS13.State.Closing;
	} else if (this.state == WS13.State.Connected) {
		code = code || WS13.StatusCode.NormalClosure;
		reason = reason || "";

		let buf = new ByteBuffer(2 + reason.length, ByteBuffer.BIG_ENDIAN);
		buf.writeUint16(code);
		buf.writeString(reason);

		this._sendControl(WS13.FrameType.Control.Close, buf.flip().toBuffer());
		this._outgoingFrames = []; // empty the queue; we can't send any more data now
		this.state = WS13.State.Closing;

		setTimeout(() => {
			if (this.state != WS13.State.Closed) {
				this._closeExtensions(() => {
					this._socket.end();
				});
			}
		}, 5000).unref();
	} else {
		throw new Error("Cannot disconnect a WebSocket that is not connected.");
	}
};

/**
 * Send some data in a single frame (not streamed).
 * @param {string|Buffer} data - The data to send. If a string, the data will be sent as UTF-8 text. If a Buffer, it will be sent as binary data.
 */
WebSocketBase.prototype.send = function(data) {
	let opcode = (typeof data === 'string' ? WS13.FrameType.Data.Text : WS13.FrameType.Data.Binary);
	if (ByteBuffer.isByteBuffer(data)) {
		data = data.toBuffer();
	} else if (typeof data === 'string') {
		data = Buffer.from(data, 'utf8');
	}

	this._sendFrame({
		"FIN": true,
		"RSV1": false,
		"RSV2": false,
		"RSV3": false,
		"opcode": opcode,
		"payload": data
	});
};

WebSocketBase.prototype.createMessageStream = function(type) {
	let frame = new StreamedOutgoingMessage(this, type);
	this._outgoingFrames.push(frame);
	return frame;
};

WebSocketBase.prototype.data = function(key, value) {
	let val = this._data[key];

	if (typeof value === 'undefined') {
		return val;
	}

	this._data[key] = value;
	return val;
};

WebSocketBase.prototype.getPeerCertificate = function(detailed) {
	return this._socket.getPeerCertificate ? this._socket.getPeerCertificate(detailed) : null;
};

WebSocketBase.prototype.getSecurityProtocol = function() {
	return this._socket.getProtocol ? this._socket.getProtocol() : null;
};

WebSocketBase.prototype._prepSocketEvents = function() {
	this.remoteAddress = this._socket.remoteAddress;

	this._socket.on('data', (data) => {
		if ([WS13.State.Connected, WS13.State.Closing, WS13.State.ClosingError].indexOf(this.state) != -1) {
			this._handleData(data);
		}
	});

	this._socket.on('close', () => {
		if (this.state == WS13.State.ClosingError) {
			this.state = WS13.State.Closed;
			return;
		}

		if (this.state == WS13.State.Closed) {
			this.emit('debug', "Socket closed after successful websocket closure.");
			return;
		}

		let state = this.state;
		this.state = WS13.State.Closed;
		this.emit('disconnected', WS13.StatusCode.AbnormalTermination, "Socket closed", state == WS13.State.Closing);
		this._closeExtensions();
		this._cleanupTimers();
	});

	this._socket.on('error', (err) => {
		if (this.state == WS13.State.Closed) {
			// Ignore errors that come after the socket is closed (e.g. ECONNRESET when we respond to Close frames)
			return;
		}

		err.state = this.state;
		this.state = WS13.State.ClosingError;
		this._closeExtensions();
		this._cleanupTimers();
		this.emit('error', err);
	});
};

WebSocketBase.prototype.setTimeout = function(timeout, callback) {
	if (this._userTimeout) {
		clearTimeout(this._userTimeout);
	}

	delete this._userTimeout;
	delete this._userTimeoutMs;

	if (timeout == 0) {
		return this;
	}

	this._userTimeoutMs = timeout;
	this._resetUserTimeout();

	if (typeof callback === 'function') {
		this.once('timeout', callback);
	}
};

WebSocketBase.prototype._resetUserTimeout = function() {
	if (this._userTimeout) {
		clearTimeout(this._userTimeout);
		delete this._userTimeout;
	}

	if (this._userTimeoutMs) {
		this._userTimeout = setTimeout(() => {
			delete this._userTimeout;
			this.setTimeout(0); // don't keep triggering timeout
			this.emit('timeout');
		}, this._userTimeoutMs);
	}
};

WebSocketBase.prototype.sendPing = function(callback) {
	this._pingCallbacks = this._pingCallbacks || {};
	let pingData, pingNum;

	do {
		pingData = Crypto.randomBytes(4);
		pingNum = pingData.readUInt32BE(0);
	} while (this._pingCallbacks[pingNum]);

	this._pingCallbacks[pingNum] = callback || function() {};

	this._sendFrame({
		"FIN": true,
		"RSV1": false,
		"RSV2": false,
		"RSV3": false,
		"opcode": WS13.FrameType.Control.Ping,
		"payload": pingData
	}, true);
};

WebSocketBase.prototype._queuePing = function() {
	clearTimeout(this._pingTimer);
	clearTimeout(this._pingTimeout);

	if (this.state != WS13.State.Connected || !this.options.pingInterval || !this.options.pingTimeout || !this.options.pingFailures) {
		return;
	}

	this._pingTimer = setTimeout(() => {
		if (this.state != WS13.State.Connected) {
			return;
		}

		let time = Date.now();
		this.sendPing(() => {
			this.emit('latency', Date.now() - time);
			this._pingFailures = 0;
			this._queuePing();
		});

		this._pingTimeout = setTimeout(() => {
			if (this.state != WS13.State.Connected) {
				return;
			}

			this.emit('debug', "Ping timeout #" + (this._pingFailures + 1));

			if (++this._pingFailures >= this.options.pingFailures) {
				this._terminateError(WS13.StatusCode.PolicyViolation, "Ping timeout");
			} else {
				this._queuePing();
			}
		}, this.options.pingTimeout);
	}, this.options.pingInterval);
};

WebSocketBase.prototype._handleData = function(data) {
	if (data && data.length > 0) {
		this._dataBuffer = Buffer.concat([this._dataBuffer, data]);
		this._queuePing(); // reset the ping timer
	}

	if (this._dataBuffer.length == 0) {
		return;
	}

	let buf = ByteBuffer.wrap(this._dataBuffer, ByteBuffer.BIG_ENDIAN);
	let frame = {};

	try {
		let byte = buf.readUint8();
		frame.FIN = !!(byte & (1 << 7));
		frame.RSV1 = !!(byte & (1 << 6));
		frame.RSV2 = !!(byte & (1 << 5));
		frame.RSV3 = !!(byte & (1 << 4));
		frame.opcode = byte & 0x0F;

		byte = buf.readUint8();
		let hasMask = !!(byte & (1 << 7));
		frame.payloadLength = byte & 0x7F;

		if (frame.payloadLength == 126) {
			frame.payloadLength = buf.readUint16();
		} else if (frame.payloadLength == 127) {
			frame.payloadLength = parseInt(buf.readUint64(), 10);
		}

		if (hasMask) {
			frame.maskKey = buf.readUint32();
		} else {
			frame.maskKey = null;
		}

		if (buf.remaining() < frame.payloadLength) {
			return; // We don't have the entire payload yet
		}

		frame.payload = buf.slice(buf.offset, buf.offset + frame.payloadLength).toBuffer();
		buf.skip(frame.payloadLength);
	} catch (ex) {
		// We don't have the full data yet. No worries.
		return;
	}

	// We have a full frame
	this._dataBuffer = buf.toBuffer();
	this._handleFrame(frame);

	this._handleData();
};

WebSocketBase.prototype._handleFrame = function(frame) {
	// Flags: FIN, RSV1, RSV2, RSV3
	// Ints: opcode (4 bits), payloadLength (up to 64 bits), maskKey (32 bits)
	// Binary: payload

	let debugMsg = "Got frame " + frame.opcode.toString(16).toUpperCase() + ", " + (frame.FIN ? "FIN, " : "");
	for (let i = 1; i <= 3; i++) {
		if (frame['RSV' + i]) {
			debugMsg += "RSV" + i + ", ";
		}
	}

	debugMsg += (frame.maskKey ? "MASK, " : "") + "payload " + frame.payload.length + " bytes";

	this.emit('debug', debugMsg);

	if (this.state != WS13.State.Connected && !((this.state == WS13.State.ClosingError || this.state == WS13.State.Closing) && frame.opcode == WS13.FrameType.Control.Close)) {
		this.emit('debug', "Got frame " + frame.opcode.toString(16) + " while in state " + this.state);
		return;
	}

	// The RFC requires us to terminate the connection if we get an unmasked frame from a client or a masked frame from
	// a server. But in the real world, implementations are bad sometimes so for compatibility's sake, just log it.
	if ((this._type == 'server' && !frame.maskKey && frame.payload.length > 0) || (this._type == 'client' && frame.maskKey)) {
		this.emit('debug', `Protocol violation: Received ${frame.maskKey ? 'masked' : 'unmasked'} frame ` +
			`${frame.opcode.toString(16).toUpperCase()} of length ${frame.payload.length} from ${this._type == 'client' ? 'server' : 'client'}`);
	}

	// Unmask if applicable
	if (frame.maskKey !== null && frame.payload && frame.payload.length > 0) {
		frame.payload = maskOrUnmask(frame.payload, frame.maskKey);
	}

	// Check to make sure RSV bits are valid
	if (this.extensions && !this.extensions.validFrameRsv(getExtensionFrame(frame))) {
		this._terminateError(WS13.StatusCode.ProtocolError, "Unexpected reserved bit set");
		return;
	}

	let payload;

	// Is this a control frame? They need to be handled before anything else as they can be interjected between
	// fragmented message frames.
	if (frame.opcode & (1 << 3)) {
		// this is a control frame.

		if (!frame.FIN) {
			this._terminateError(WS13.StatusCode.ProtocolError, "Got a fragmented control frame " + frame.opcode.toString(16));
			return;
		}

		if (frame.payload.length > 125) {
			this._terminateError(WS13.StatusCode.ProtocolError, "Got a control frame " + frame.opcode.toString(16) + " with invalid payload length " + frame.payload.length);
			return;
		}

		// Run it through extensions
		this.extensions.processIncomingMessage(getExtensionMessage(frame), (err, msg) => {
			if (err) {
				this._terminateError(WS13.StatusCode.ProtocolError, err.message || err);
				return;
			}

			frame = fromExtensionMessage(msg);

			switch (frame.opcode) {
				case WS13.FrameType.Control.Close:
					let code = WS13.StatusCode.NoStatusCode;
					let reason = "";

					if (frame.payload && frame.payload.length >= 2) {
						code = frame.payload.readUInt16BE(0);

						if (frame.payload.length > 2) {
							reason = frame.payload.toString('utf8', 2);
						}
					}

					let state = this.state;

					if (state == WS13.State.Closing || state == WS13.State.ClosingError) {
						this._cleanupTimers();
						this._closeExtensions(() => {
							this._socket.end();
						});

						// We're all done here
					} else {
						if (code != WS13.StatusCode.NoStatusCode) {
							payload = new ByteBuffer(2 + reason.length, ByteBuffer.BIG_ENDIAN);
							payload.writeUint16(code);
							payload.writeString(reason || "");
						} else {
							payload = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN); // don't send anything back
						}

						this._sendControl(WS13.FrameType.Control.Close, payload.flip().toBuffer());
						this._cleanupTimers();
						this._closeExtensions(() => {
							this._socket.end();
						});
					}

					this.state = WS13.State.Closed;

					if (state != WS13.State.ClosingError) {
						this.emit('disconnected', code, reason, state == WS13.State.Closing);
					}

					break;

				case WS13.FrameType.Control.Ping:
					this._sendControl(WS13.FrameType.Control.Pong, frame.payload);
					break;

				case WS13.FrameType.Control.Pong:
					if (frame.payload && frame.payload.length == 4) {
						let num = frame.payload.readUInt32BE(0);
						if (this._pingCallbacks[num]) {
							this._pingCallbacks[num]();
							delete this._pingCallbacks[num];
						}
					}

					break;

				default:
					this._terminateError(WS13.StatusCode.UnacceptableDataType, "Unknown control frame type " + frame.opcode.toString(16).toUpperCase());
			}
		});

		return;
	}

	// Sanity checks
	if (!this._incomingStream && frame.opcode == WS13.FrameType.Continuation) {
		this._terminateError(WS13.StatusCode.ProtocolError, "Received continuation frame without initial frame.");
		return;
	} else if (this._incomingStream && frame.opcode != WS13.FrameType.Continuation) {
		this._terminateError(WS13.StatusCode.ProtocolError, "Received new message without finishing a fragmented one.");
		return;
	}

	// this is not a control frame.
	this._resetUserTimeout();

	// Is this the first frame of a fragmented message?
	if (!frame.FIN && !this._incomingStream) {
		this.emit('debug', "Got first frame of fragmented message.");

		let dispatch = this.listenerCount('streamedMessage') >= 1 && !frame.RSV1 && !frame.RSV2 && !frame.RSV3;
		this._incomingStream = new StreamedIncomingMessage(frame, dispatch);

		if (dispatch) {
			this.emit('streamedMessage', frame.opcode, this._incomingStream);
		}

		this._incomingStream.on('end', data => {
			if (!dispatch) {
				let frame = this._incomingStream.frameHeader;
				frame.payload = data;
				frame.payloadLength = frame.payload.length;

				this._dispatchDataFrame(frame);
			}
		});

		return;
	}

	if (frame.opcode == WS13.FrameType.Continuation) {
		this.emit('debug', "Got continuation frame");
		this._incomingStream._frame(frame);

		if (frame.FIN) {
			this._incomingStream = null;
		}

		return;
	}

	// We know that we have this entire frame now. Let's handle it.
	this._dispatchDataFrame(frame);
};

WebSocketBase.prototype._dispatchDataFrame = function(frame) {
	this.extensions.processIncomingMessage(getExtensionMessage(frame), (err, msg) => {
		if (err) {
			this._terminateError(WS13.StatusCode.ProtocolError, err.message || err);
			return;
		}

		frame = fromExtensionMessage(msg);

		switch (frame.opcode) {
			case WS13.FrameType.Data.Text:
				let utf8 = frame.payload.toString('utf8');

				// Check that the UTF-8 is valid
				if (Buffer.compare(Buffer.from(utf8, 'utf8'), frame.payload) !== 0) {
					// This is invalid. We must tear down the connection.
					this._terminateError(WS13.StatusCode.InconsistentData, "Received invalid UTF-8 data in a text frame.");
					return;
				}

				this.emit('message', WS13.FrameType.Data.Text, utf8);
				break;

			case WS13.FrameType.Data.Binary:
				this.emit('message', WS13.FrameType.Data.Binary, frame.payload);
				break;

			default:
				this._terminateError(WS13.StatusCode.UnacceptableDataType, "Unknown data frame type " + frame.opcode.toString(16).toUpperCase());
		}
	});
};

WebSocketBase.prototype._sendFrame = function(frame, bypassQueue) {
	let self = this;
	let isControl = !!(frame.opcode & (1 << 3));

	if (this.state != WS13.State.Connected && !(this.state == WS13.State.Closing && isControl)) {
		throw new Error("Cannot send data while not connected (state " + this.state + ")");
	}

	if (typeof frame.FIN === 'undefined') {
		frame.FIN = true;
	}

	if (isControl) {
		if (frame.payload && frame.payload.length > 125) {
			throw new Error("Cannot send control frame " + frame.opcode.toString(16).toUpperCase() + " with " + frame.payload.length + " bytes of payload data. Payload must be 125 bytes or fewer.");
		}

		bypassQueue = true; // we can send control messages whenever
	}

	frame.payload = frame.payload || Buffer.alloc(0);
	let maskKey = frame.maskKey;
	let fin = frame.FIN;
	let queueId = null;

	if (isControl || !frame.FIN || frame.opcode == 0) {
		// https://github.com/faye/permessage-deflate-node/issues/6
		onExtensionsProcessed(frame);
	} else {
		if (!bypassQueue) {
			queueId = ++this._extensionProcessingOutgoingFrameId;
			this._outgoingFrames.push(queueId);

			// What is queueId? It's a placeholder. We want to retain the order guarantee, but we still need to pass this message
			// to extensions. Those might not call back in order. Consequently, we "reserve the message's place" in the outgoing
			// queue with a number. That array position will be replaced with the actual message when it's ready.

			if (queueId >= 4294967295) {
				// just for fun. this is unlikely to ever really happen. 4294967295 is max uint32 and is totally arbitrary, we can go up to 2^53
				this._extensionProcessingOutgoingFrameId = 0;
			}
		}

		this.extensions.processOutgoingMessage(getExtensionMessage(frame), (err, msg) => {
			if (err) {
				this._terminateError(WS13.StatusCode.ProtocolError, err.message || err);
				return;
			}

			frame = fromExtensionMessage(msg);
			frame.maskKey = maskKey;
			frame.FIN = fin;
			onExtensionsProcessed(frame);
		});
	}

	function onExtensionsProcessed(frame) {
		let debugMsg = (bypassQueue ? "Sending" : "Queueing") + " frame " + frame.opcode.toString(16).toUpperCase() + ", " + (frame.FIN ? "FIN, " : "");
		for (let i = 1; i <= 3; i++) {
			if (frame['RSV' + i]) {
				debugMsg += "RSV" + i + ", ";
			}
		}

		debugMsg += (frame.maskKey ? "MASK, " : "") + "payload " + frame.payload.length + " bytes";
		self.emit('debug', debugMsg);

		let size = 0;
		size += 1; // FIN, RSV1, RSV2, RSV3, opcode
		size += 1; // MASK, payload length

		if (frame.payload.length >= 126 && frame.payload.length <= 65535) {
			size += 2; // 16-bit payload length
		} else if (frame.payload.length > 65535) {
			size += 8; // 64-bit payload length
		}

		if (frame.maskKey) {
			size += 4;
		}

		size += frame.payload.length;

		let buf = new ByteBuffer(size, ByteBuffer.BIG_ENDIAN);
		let byte = 0;

		byte |= (frame.FIN ? 1 : 0) << 7;
		byte |= (frame.RSV1 ? 1 : 0) << 6;
		byte |= (frame.RSV2 ? 1 : 0) << 5;
		byte |= (frame.RSV3 ? 1 : 0) << 4;
		byte |= frame.opcode & 0x0F;
		buf.writeUint8(byte);

		byte = 0;
		byte |= (frame.maskKey ? 1 : 0) << 7;

		if (frame.payload.length <= 125) {
			byte |= frame.payload.length;
			buf.writeUint8(byte);
		} else if (frame.payload.length <= 65535) {
			byte |= 126;
			buf.writeUint8(byte);
			buf.writeUint16(frame.payload.length);
		} else {
			byte |= 127;
			buf.writeUint8(byte);
			buf.writeUint64(frame.payload.length);
		}

		if (frame.maskKey) {
			buf.writeUint32(frame.maskKey);
			buf.append(maskOrUnmask(frame.payload, frame.maskKey));
		} else {
			buf.append(frame.payload);
		}

		if (bypassQueue) {
			self._socket.write(buf.flip().toBuffer());
		} else if (queueId) {
			// This already has a placeholder in the queue
			let idx = self._outgoingFrames.indexOf(queueId);
			if (idx == -1) {
				self._outgoingFrames.push(buf.flip().toBuffer());
			} else {
				self._outgoingFrames[idx] = buf.flip().toBuffer();
			}
		} else {
			// No queue placeholder, just stick it in
			self._outgoingFrames.push(buf.flip().toBuffer());
		}

		self._processQueue();
	}
};

WebSocketBase.prototype._processQueue = function() {
	let frames = this._outgoingFrames.slice(0);

	while (frames.length > 0) {
		if (typeof frames[0] === 'number') {
			// This is a placeholder, so we're done
			break;
		}

		if (frames[0] instanceof StreamedOutgoingMessage) {
			if (!frames[0].started) {
				this.emit('debug', "Starting StreamedOutgoingMessage");
				frames[0]._start();
			}

			if (frames[0].finished) {
				frames.splice(0, 1);
				continue;
			}

			break;
		}

		this._socket.write(frames.splice(0, 1)[0]);
	}

	this._outgoingFrames = frames;
};

WebSocketBase.prototype._sendControl = function(opcode, payload) {
	if (this.state == WS13.State.Closed || !this._socket) {
		return;
	}

	this._sendFrame({
		"opcode": opcode,
		"payload": payload,
		"payloadLength": payload.length,
		"FIN": true,
		"RSV1": false,
		"RSV2": false,
		"RSV3": false
	});
};

WebSocketBase.prototype._closeError = function(err) {
	err.state = this.state;
	this.state = WS13.State.Closed;
	this._closeExtensions();
	this._cleanupTimers();

	if (this._socket) {
		this._socket.end();
		this._socket.destroy();
	}

	this.emit('error', err);
};

WebSocketBase.prototype._terminateError = function(code, message) {
	let err = new Error(message);
	err.state = this.state;
	err.code = code;
	this.disconnect(code, message);
	this.state = WS13.State.ClosingError;
	this.emit('error', err);
};

WebSocketBase.prototype._cleanupTimers = function() {
	clearTimeout(this._pingTimeout);
	clearTimeout(this._pingTimer);
};

WebSocketBase.prototype._closeExtensions = function(callback) {
	callback = callback || function() { };

	try {
		this.extensions.close(callback);
	} catch (ex) {
		callback();
	}
};

// Util
function maskOrUnmask(data, maskKey) {
	let key = Buffer.alloc(4);
	key.writeUInt32BE(maskKey);

	for (let i = 0; i < data.length; i++) {
		data[i] ^= key[i % 4];
	}

	return data;
}

function getExtensionFrame(frame) {
	return {
		"final": frame.FIN,
		"rsv1": frame.RSV1,
		"rsv2": frame.RSV2,
		"rsv3": frame.RSV3,
		"opcode": frame.opcode,
		"masked": !!frame.maskKey,
		"maskingKey": frame.maskKey,
		"payload": frame.payload
	};
}

function getExtensionMessage(frame) {
	return {
		"rsv1": frame.RSV1,
		"rsv2": frame.RSV2,
		"rsv3": frame.RSV3,
		"opcode": frame.opcode,
		"data": frame.payload
	};
}

function fromExtensionMessage(msg) {
	return {
		"FIN": true,
		"RSV1": msg.rsv1,
		"RSV2": msg.rsv2,
		"RSV3": msg.rsv3,
		"opcode": msg.opcode,
		"payload": msg.data
	};
}
