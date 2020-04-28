// Forked from https://github.com/Wizcorp/node-graylog2/blob/master/graylog.js

import zlib from 'zlib';
import crypto from 'crypto';
import dgram from 'dgram';
import os from 'os';
import { promisify } from 'util';
import { GelfPayloadSpec11, GelfLevelEnum, GelfAdditionalField } from './definitions';

const randomBytesAsync = promisify<number, Buffer>(crypto.randomBytes);
const deflateAsync = promisify<zlib.InputType, Buffer>(zlib.deflate);

export interface HostPort {
  host: string;
  port: number;
}

export interface GraylogConfig {
  servers: HostPort[];
  facility?: string;
  hostname?: string;
  bufferSize?: number;
  deflate?: 'optimal' | 'always' | 'never';
}

export type AdditionalFields = {
  timestamp?: number | Date;
  full_message?: string;
  level?: GelfLevelEnum;
  facility?: string;
  [additionalParam: string]: GelfAdditionalField;
};

/**
 * Graylog instances emit errors. That means you really really should listen for them,
 * or accept uncaught exceptions (node throws if you don't listen for "error").
 */
export default class Graylog {
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

  constructor(config: GraylogConfig) {
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

  getServer() {
    return this.servers[this._callCount++ % this.servers.length];
  }

  getClient() {
    if (!this.client) {
      this.client = dgram.createSocket('udp4');
    }
    return this.client;
  }

  async _log(msg: any | Error, meta?: AdditionalFields, level?: GelfLevelEnum) {
    const payload = {
      version: '1.1',
      timestamp: meta?.timestamp || Date.now() / 1000,
      host: this.hostname,
      facility: this.facility,
      level: level || GelfLevelEnum.INFO,
    } as GelfPayloadSpec11;

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
      const { facility, full_message, level, timestamp, ...additionalParams } = meta;
      if (facility) payload.facility = facility;
      if (full_message) payload.full_message = full_message;
      if (level) payload.level = level;
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

    return this.send(payload);
  }

  async send(payload: GelfPayloadSpec11) {
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

  async _sendData(buffer: Buffer) {
    try {
      this._unsentMessages += 1;
      if (buffer.length <= this._bufferSize) {
        // If data fits one chunk, just send it
        await this._sendChunk(buffer, this.getServer());
      } else {
        // It didn't fit one chunk, so prepare for a chunked stream
        await this._sendChunkedStream(buffer);
      }
    } finally {
      this._unsentMessages -= 1;
    }
    // if all messags were sended and was asked client to destroy
    if (this._destroyIfNeeded) this._destroyIfNeeded();
  }

  /**
   * Send GELF chunks
   * @see http://docs.graylog.org/en/3.0/pages/gelf.html#chunking
   */
  async _sendChunkedStream(buffer: Buffer) {
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

    for (let chunkSequenceNumber = 0; chunkSequenceNumber < chunkCount; chunkSequenceNumber++) {
      // Set chunk sequence number (byte 10)
      chunk[10] = chunkSequenceNumber;
      // Copy data from full buffer into the chunk
      const start = chunkSequenceNumber * dataSize;
      const stop = Math.min((chunkSequenceNumber + 1) * dataSize, buffer.length);
      buffer.copy(chunk, 12, start, stop);
      // Send the chunk
      await this._sendChunk(chunk.slice(0, stop - start + 12), server);
    }
  }

  async _generateRandomId(n: number) {
    return randomBytesAsync(n);
  }

  async _sendChunk(chunk: Buffer, server: HostPort) {
    return new Promise((resolve, reject) => {
      const client = this.getClient();

      if (!client) {
        reject(new Error('Socket was already destroyed'));
        return;
      }

      this._unsentChunks += 1;
      client.send(chunk, 0, chunk.length, server.port, server.host, (err) => {
        this._unsentChunks -= 1;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

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
    return this._log(msg, meta, GelfLevelEnum.EMERG);
  }

  /** action must be taken immediately @level 1 */
  async alert(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.ALERT);
  }

  /** critical conditions @level 2 */
  async critical(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.CRIT);
  }

  /** error conditions @level 3 */
  async error(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.ERR);
  }

  /** warning conditions @level 4 */
  async warning(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.WARNING);
  }

  /** warning conditions @level 4 */
  async warn(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.WARNING);
  }

  /** normal, but significant, condition @level 5 */
  async notice(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.NOTICE);
  }

  /** informational message @level 6 */
  async info(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.INFO);
  }

  /** informational message @level 6 */
  async log(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.INFO);
  }

  /** debug level message @level 7 */
  async debug(msg: any | Error, meta?: AdditionalFields) {
    return this._log(msg, meta, GelfLevelEnum.DEBUG);
  }
}
