const Events = require("events");
const ByteBuffer = require("bytebuffer");
const Protos = require("./Protos.js");

module.exports = class Coordinator extends Events {
	constructor(steamUser) {
		super();

		this.steamUser = steamUser;
		this.Protos = Protos([
			{
				name: "csgo",
				protos: __dirname + "/../protobufs/csgo"
			}
		]);

		steamUser.on("receivedFromGC", (appid, msgType, payload) => {
			if (appid !== 730) {
				return;
			}

			this.emit("receivedFromGC", msgType, payload);
		});

		let _handleMessage = this.steamUser._handleMessage;
		this.steamUser._handleMessage = (header, body) => {
			_handleMessage.call(this.steamUser, header, body);

			this.emit("receivedFromSteam", header, body);
		}
	}

	/**
	 * Send a message and get the response from it if needed
	 * @param {Number|undefined} appid AppID where to send the GC message to - Pass "undefined" for customized proto
	 * @param {Number} header The identifier of the message we are sending
	 * @param {Object} proto Header proto
	 * @param {Constructor|undefined} protobuf Constructor to create the buffer with settings. If "undefined" then "settings" HAS to be a buffer
	 * @param {Object} settings Settings to combine with the protobuf to construct the buffer
	 * @param {Number|undefined} responseHeader The response header to our request
	 * @param {Object|undefined} responseProtobuf Will automatically append ".decode()": Function which will be used to decode the protobuf. If "undefined" will not decode response and resolve with the raw buffer of the response
	 * @param {Number} timeout Max number of milliseconds before we give up on waiting for our response
	 * @returns {Promise} Promise which resolves in the object of our response, or undefined if "responseHeader" is undefined or rejects in a timeout error
	 */
	sendMessage(appid, header, proto, protobuf, settings, responseHeader, responseProtobuf, timeout = 30000) {
		return new Promise((resolve, reject) => {
			if (!appid) {
				let encoded = settings;
				if (protobuf) {
					let message = protobuf.create(settings);
					encoded = protobuf.encode(message);
				}

				this.steamUser._send({
					msg: header,
					proto: proto
				}, protobuf ? encoded.finish() : encoded);

				if (!responseHeader) {
					resolve();
					return;
				}

				let sendTimeout = setTimeout(() => {
					if (this.steamUser._handlerManager._handlers[responseHeader] && this.steamUser._handlerManager._handlers[responseHeader].length > 0) {
						this.steamUser._handlerManager._handlers[responseHeader].pop(); // We added our message last (I assume) so remove the last one

						if (this.steamUser._handlerManager._handlers[responseHeader].length <= 0) {
							delete this.steamUser._handlerManager._handlers[responseHeader];
						}
					}

					reject(new Error("Failed to send message: Timeout"));
				}, timeout);

				this.steamUser._handlerManager.add(responseHeader, (body) => {
					if (this.steamUser._handlerManager.hasHandler(responseHeader)) {
						if (this.steamUser._handlerManager._handlers[responseHeader] && this.steamUser._handlerManager._handlers[responseHeader].length > 0) {
							this.steamUser._handlerManager._handlers[responseHeader].pop(); // We added our message last (I assume) so remove the last one

							if (this.steamUser._handlerManager._handlers[responseHeader].length <= 0) {
								delete this.steamUser._handlerManager._handlers[responseHeader];
							}
						}
					}

					clearTimeout(sendTimeout);

					if (!responseProtobuf) {
						if (body instanceof Buffer || body instanceof ByteBuffer) {
							resolve(body);
							return;
						}

						resolve(body);
						return;
					}

					if (body instanceof Buffer || body instanceof ByteBuffer) {
						body = responseProtobuf.decode(body.toBuffer());
						body = responseProtobuf.toObject(body, { defaults: true });
					}

					resolve(body);
				});
				return;
			}

			let encoded = settings;
			if (protobuf) {
				let message = protobuf.create(settings);
				encoded = protobuf.encode(message);
			}
			this.steamUser.sendToGC(appid, header, proto, protobuf ? encoded.finish() : encoded);

			if (!responseHeader) {
				resolve();
				return;
			}

			let sendTimeout = setTimeout(() => {
				this.removeListener("receivedFromGC", sendMessageResponse);
				reject(new Error("Failed to send message: Timeout"));
			}, timeout);

			this.on("receivedFromGC", sendMessageResponse);
			function sendMessageResponse(msgType, payload) {
				if (msgType === responseHeader) {
					clearTimeout(sendTimeout);
					this.removeListener("receivedFromGC", sendMessageResponse);

					if (!responseProtobuf) {
						resolve(payload);
						return;
					}

					let msg = responseProtobuf.decode(payload);
					msg = responseProtobuf.toObject(msg, { defaults: true });
					resolve(msg);
				}
			}
		});
	}
}