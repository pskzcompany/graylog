import zlib from 'zlib';
import crypto from 'crypto';
import dgram from 'dgram';
import os from 'os';
import { promisify } from 'util';
import { GraylogGelfPayload, GraylogLevelEnum, GraylogGelfAdditionalField } from './definitions';
import { EventEmitter } from 'events';

const randomBytesAsync = promisify<number, Buffer>(crypto.randomBytes);
const deflateAsync = promisify<zlib.InputType, Buffer>(zlib.deflate);

export interface HostPort {
  host: string;
  port: number;
}

export interface GraylogConfig {
  /**
   * list of servers
   * for sending message will be used next server (like round-robin)
   */
  servers: HostPort[];

  /**
   * the name of this host
   * (optional, default: os.hostname())
   */
  hostname?: string;

  /**
   * the facility for these log messages
   * (optional, default: "Node.js")
   * you may override this value per message basis in `meta.facility`
   */
  facility?: string;

  /**
   * max UDP packet size, should never exceed the MTU of your system
   * (optional, default: 1400)
   */
  bufferSize?: number;

  /**
   * use compression for messages – 'optimal' | 'always' | 'never'
   * (optional, default: 'optimal)
   * `optimal` means that
   *  - if message fits UDP packet size it will be sended without compression
   *  - if message is big then will be used deflate before sending
   */
  deflate?: 'optimal' | 'always' | 'never';
}

export type AdditionalFields = {
  timestamp?: number | Date;
  full_message?: string;
  hostname?: string;
  level?: GraylogLevelEnum;
  facility?: string;
  [additionalParam: string]: GraylogGelfAdditionalField;
};

/**
 * Graylog instances emit errors. That means you really really should listen for them,
 * or accept uncaught exceptions (node throws if you don't listen for "error").
 */
export default class Graylog extends EventEmitter {
  config: GraylogConfig;
  servers: HostPort[];
  client: dgram.Socket | undefined;
  hostname: string;
  facility: string;
  deflate: NonNullable<GraylogConfig['deflate']>;

  // a bit less than a typical MTU of 1500 to be on the safe side
  _bufferSize = 1400;
  _unsentMessages = 0;
  _unsentChunks = 0;
  _callCount = 0;
  _destroyIfNeeded: undefined | Function = undefined;
  _onError?: (e: Error) => any;

  constructor(config: GraylogConfig) {
    super();

    this.config = config;
    this.servers = config.servers.map((s) => ({ ...s })); // deep copy
    this.hostname = config.hostname || os.hostname();
    this.facility = config.facility || 'Node.js';
    this.deflate = config.deflate || 'optimal';
    if (this.deflate !== 'optimal' && this.deflate !== 'always' && this.deflate !== 'never') {
      throw new Error(
        'deflate must be one of "optimal", "always", or "never". was "' + this.deflate + '"'
      );
    }
    if (config?.bufferSize && config.bufferSize > 0) this._bufferSize = config.bufferSize;
  }

  /**
   * Add callback which will be called if some error occurs when sending message
   *
   * @return remove listener function
   */
  onError(cb: (e: Error) => any): Function {
    this.addListener('err', cb);
    return () => this.removeListener('err', cb);
  }

  getServer() {
    return this.servers[this._callCount++ % this.servers.length];
  }

  getClient() {
    if (!this.client) {
      this.client = dgram.createSocket('udp4');
    }
    return this.client;
  }

  /**
   * Low level `log` command.
   *
   * @param msg - any value, for non-strings values will be used JSON.stringify
   * @param meta - object with additional fields
   * @param level - log level
   *      eg 3 - error, 4 - warning, 5 - notice, 6 - info, 7 - debug,
   *         0 - emerg, 1 - alert, 2 - crit
   * @param disablePromiseRejection - `false` by default
   *      - if set to `true` then returned promise
   *      will be wrapped to catch errors (and it will be safe
   *      to use this method without try..catch block)
   *      So even error occurs it will return resolve(false)
   *      - if set to `false` then promise will be rejected on client error
   */
  async _log(
    msg: any | Error,
    meta?: AdditionalFields,
    level?: GraylogLevelEnum,
    disablePromiseRejection = false
  ) {
    const payload = {
      version: '1.1',
      timestamp: meta?.timestamp || Date.now() / 1000,
      host: this.hostname,
      facility: this.facility,
      level: level || GraylogLevelEnum.INFO,
    } as GraylogGelfPayload;

    if (typeof msg === 'string') {
      payload.short_message = msg;
    } else if (msg instanceof Error) {
      payload.short_message = msg.message;

      if (msg.stack) {
        payload.full_message = msg.stack;

        // extract error file and line
        const firstline = msg.stack.split('\n')[0];
        const filepath = firstline.substr(firstline.indexOf('('), firstline.indexOf(')'));
        const fileinfo = filepath.split(':');
        payload._file = fileinfo[0];
        payload._line = fileinfo[1];
      }
    } else {
      payload.short_message = JSON.stringify(msg);
    }

    if (meta) {
      const { facility, full_message, level, hostname, timestamp, ...additionalParams } = meta;
      if (facility) payload.facility = facility;
      if (full_message) payload.full_message = full_message;
      if (level) payload.level = level;
      if (hostname) payload.hostname = hostname;
      if (timestamp) {
        payload.timestamp = timestamp instanceof Date ? timestamp.getTime() / 1000 : timestamp;
      }

      // Add underline for additional fields
      for (const field in additionalParams) {
        payload['_' + field] = additionalParams[field];
      }

      // According to spec: libraries SHOULD not allow to send id as additional field (_id).
      if (payload._id) {
        payload.__id = payload._id;
        delete payload._id;
      }
    }

    // Do not produce Unhandled Promise rejection
    // Just return `false` on sending error
    if (disablePromiseRejection) {
      return this.send(payload).then(
        (bytes) => bytes,
        (e) => {
          // DO NOT USE `error` key!
          // it has specific behavior in NodeJS
          // read https://nodejs.org/api/events.html#events_error_events
          this.emit('err', e);
          return false;
        }
      );
    } else {
      return this.send(payload);
    }
  }

  /**
   * Manual sending GELF payload data.
   * If error occurs then promise will be rejected.
   * You need to wrap this method in try/catch
   * for avoiding Unhendleed Promise Rejection.
   *
   * @returns total send bytes via network
   */
  async send(payload: GraylogGelfPayload): Promise<number> {
    const data = Buffer.from(JSON.stringify(payload));
    if (
      this.deflate === 'never' ||
      (this.deflate === 'optimal' && data.length <= this._bufferSize)
    ) {
      return this._sendData(data);
    } else {
      const compressedData = await deflateAsync(data);
      return this._sendData(compressedData);
    }
  }

  async _sendData(buffer: Buffer): Promise<number> {
    let sendedBytes = 0;

    try {
      this._unsentMessages += 1;
      if (buffer.length <= this._bufferSize) {
        // If data fits one chunk, just send it
        sendedBytes = await this._sendChunk(buffer, this.getServer());
      } else {
        // It didn't fit one chunk, so prepare for a chunked stream
        sendedBytes = await this._sendChunkedStream(buffer);
      }
    } finally {
      this._unsentMessages -= 1;
    }
    // if all messags were sended and was asked client to destroy
    if (this._destroyIfNeeded) this._destroyIfNeeded();

    return sendedBytes;
  }

  /**
   * Send GELF chunks
   * @see http://docs.graylog.org/en/3.0/pages/gelf.html#chunking
   */
  async _sendChunkedStream(buffer: Buffer): Promise<number> {
    const bufferSize = this._bufferSize;
    const dataSize = bufferSize - 12; // the data part of the buffer is the buffer size - header size
    const chunkCount = Math.ceil(buffer.length / dataSize);

    if (chunkCount > 128) {
      throw new Error('Cannot log messages bigger than ' + dataSize * 128 + ' bytes');
    }

    // Generate a random id in buffer format
    const id = await this._generateRandomId(8);

    const server = this.getServer();
    const chunk = Buffer.alloc(bufferSize);

    // Prepare GELF header
    chunk[0] = 30; // Set up magic numbers (bytes 0 and 1)
    chunk[1] = 15;
    chunk[11] = chunkCount; // Set the total number of chunks (byte 11)
    id.copy(chunk, 2, 0, 8); // Set message id (bytes 2-9)

    let sendedBytes = 0;
    for (let chunkSequenceNumber = 0; chunkSequenceNumber < chunkCount; chunkSequenceNumber++) {
      // Set chunk sequence number (byte 10)
      chunk[10] = chunkSequenceNumber;
      // Copy data from full buffer into the chunk
      const start = chunkSequenceNumber * dataSize;
      const stop = Math.min((chunkSequenceNumber + 1) * dataSize, buffer.length);
      buffer.copy(chunk, 12, start, stop);
      // Send the chunk
      sendedBytes += await this._sendChunk(chunk.slice(0, stop - start + 12), server);
    }
    return sendedBytes;
  }

  async _generateRandomId(n: number): Promise<Buffer> {
    return randomBytesAsync(n);
  }

  async _sendChunk(chunk: Buffer, server: HostPort): Promise<number> {
    return new Promise((resolve, reject) => {
      const client = this.getClient();

      if (!client) {
        reject(new Error('Socket was already destroyed'));
        return;
      }

      this._unsentChunks += 1;
      client.send(chunk, 0, chunk.length, server.port, server.host, (err, bytes) => {
        this._unsentChunks -= 1;
        if (err) {
          reject(err);
        } else {
          resolve(bytes);
        }
      });
    });
  }

  /**
   * close connection with server
   * but before ensure that all messages already sended
   */
  async close() {
    return new Promise((resolve, reject) => {
      if (this._destroyIfNeeded) {
        process.nextTick(() => {
          reject(new Error('Close was already called once'));
        });
        return;
      }

      this._destroyIfNeeded = () => {
        if (this._unsentChunks === 0 && this._unsentMessages === 0) {
          this.destroy();
          resolve();
        }
      };

      process.nextTick(() => {
        if (this._destroyIfNeeded) this._destroyIfNeeded();
      });
    });
  }

  destroy() {
    if (this.client) {
      this.client.close();
      this.client.removeAllListeners();
      this.client = undefined;
      this._destroyIfNeeded = undefined;
    }
  }

  /** system is unusable @level 0 */
  async emergency(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.EMERG, true);
  }

  /** action must be taken immediately @level 1 */
  async alert(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.ALERT, true);
  }

  /** critical conditions @level 2 */
  async critical(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.CRIT, true);
  }

  /** error conditions @level 3 */
  async error(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.ERR, true);
  }

  /** warning conditions @level 4 */
  async warning(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.WARNING, true);
  }

  /** warning conditions @level 4 */
  async warn(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.WARNING, true);
  }

  /** normal, but significant, condition @level 5 */
  async notice(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.NOTICE, true);
  }

  /** informational message @level 6 */
  async info(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.INFO, true);
  }

  /** informational message @level 6 */
  async log(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.INFO, true);
  }

  /** debug level message @level 7 */
  async debug(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GraylogLevelEnum.DEBUG, true);
  }
}
