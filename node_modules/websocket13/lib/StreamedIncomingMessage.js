const Stream = require('stream');
const Util = require('util');

const WS13 = require('./index.js');

module.exports = StreamedIncomingMessage;

Util.inherits(StreamedIncomingMessage, Stream.Readable);

function StreamedIncomingMessage(frame, dispatch) {
	this.frameHeader = {};
	this._dispatched = dispatch; // did this frame get sent to the user? if false, they don't have an event listener for 'streamedMessage'
	this._reading = false;
	this._frames = [];

	Stream.Readable.call(this, {
		"encoding": this.frameHeader.opcode == WS13.FrameType.Data.Text ? "utf8" : null
	});

	for (let i in frame) {
		if (frame.hasOwnProperty(i) && i != 'payload' && i != 'payloadLength') {
			this.frameHeader[i] = frame[i];
		}
	}

	this._frame(frame);
}

StreamedIncomingMessage.prototype._read = function(size) {
	this._reading = true;
	this._dispatch();
};

StreamedIncomingMessage.prototype._frame = function(frame) {
	this._frames.push(frame);
	this._dispatch();
};

StreamedIncomingMessage.prototype._dispatch = function() {
	if (!this._dispatched && this._frames[this._frames.length - 1].FIN) {
		// We have all the data
		this.emit('end', Buffer.concat(this._frames.map(frame => frame.payload).filter(payload => !!payload)));
	}

	if (!this._reading) {
		return;
	}

	let frame, keepReading;

	while (this._frames.length > 0) {
		frame = this._frames.splice(0, 1)[0];
		keepReading = this.push(frame.payload);

		if (frame.FIN) {
			this.push(null);
		}

		if (!keepReading) {
			return;
		}
	}
};
