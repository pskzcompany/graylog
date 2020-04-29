# @pskzcompany/graylog

[![npm](https://img.shields.io/npm/v/@pskzcompany/graylog.svg)](https://www.npmjs.com/package/@pskzcompany/graylog)
[![gitlab action](https://github.com/pskzcompany/graylog/workflows/test%20&%20build/badge.svg)](https://github.com/pskzcompany/graylog/actions)
[![Fully automated version management and package publishing](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

Node.js client library for [Graylog](https://www.graylog.org/).
This package was inspired by `graylog`. Completely rewritten
on TypeScript, ESNext with async/await. Also was simplified API –
`full_message` was moved to `meta` param, also was allowed
modification of any GELF field per message basis via `meta` param
(see code snippets below).

This package supports chunked [GELF](http://docs.graylog.org/en/3.0/pages/gelf.html#chunking)
format which works via UDP.

## Synopsis

### Available methods

```ts
class Graylog {
  /**
   * Create Graylog client instance.
   *
   * It accepts config object or a connection string.
   *
   * Simple connection string:
   * gelf://10.0.0.1:12201
   *
   * Full connection string with multiple servers & config options:
   * gelf://10.0.0.1:12201,10.0.0.2:12201?hostname=host&facility=Node.js&bufferSize=1400&deflate=optimal
   */
  constructor(opts: GraylogOptions | string);

  // The following methods return
  // - sended bytes via network
  // - or `false` if error occurs

  /** system is unusable @level 0 */
  emergency(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** action must be taken immediately @level 1 */
  alert(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** critical conditions @level 2 */
  critical(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** error conditions @level 3 */
  error(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** warning conditions @level 4 */
  warning(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** warning conditions @level 4 */
  warn(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** normal, but significant, condition @level 5 */
  notice(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** informational message @level 6 */
  info(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** informational message @level 6 */
  log(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;
  /** debug level message @level 7 */
  debug(msg: any | Error, meta?: AdditionalFields): Promise<number | false>;

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
  ): Promise<number | false>;

  /**
   * Manual sending GELF payload data.
   * If error occurs then promise will be rejected.
   * You need to wrap this method in try/catch
   * for avoiding Unhendleed Promise Rejection.
   *
   * @returns total send bytes via network
   */
  send(payload: GraylogGelfPayload): Promise<number>;

  /**
   * close connection with server
   * but before ensure that all messages already sended
   */
  close(): Promise<void>;

  /**
   * Add callback which will be called if some error occurs when sending message
   * @return remove listener function
   */
  onError(cb: (e: Error) => any): Function;
}
```

### Configuration via object

```ts
import Graylog from '@pskzcompany/graylog';
const logger = new Graylog({
  /**
   * list of servers
   * for sending message will be used next server (like round-robin)
   */
  servers: [
    { host: '127.0.0.1', port: 12201 },
    { host: '127.0.0.2', port: 12201 },
  ],

  /**
   * the name of this host
   * (optional, default: os.hostname())
   */
  hostname: 'server.name',

  /**
   * the facility for these log messages
   * (optional, default: "Node.js")
   * you may override this value per message basis in `meta.facility`
   */
  facility: 'Node.js',

  /**
   * max UDP packet size, should never exceed the MTU of your system
   * (optional, default: 1400)
   */
  bufferSize: 1350,

  /**
   * use compression for messages – 'optimal' | 'always' | 'never'
   * (optional, default: 'optimal)
   * `optimal` means that
   *  - if message fits UDP packet size it will be sended without compression
   *  - if message is big then will be used deflate before sending
   */
  deflate: 'always',
});
```

### Configuration via connection string

You may use connection string for Graylog configuration. It's useful for Docker/Kubernetes when you want provide all config options via just one ENV variable. Eg.

Simple URI:

```txt
GRAYLOG_URI=gelf://10.0.0.1:12201
```

Full URI with multiple servers and configuration options:

```txt
GRAYLOG_URI=gelf://10.0.0.1:12201,10.0.0.2:12201?hostname=host&facility=Node.js&bufferSize=1400&deflate=optimal
```

So then you may use the following code snippet:

```ts
import Graylog from '@pskzcompany/graylog';
const logger = new Graylog(process.env.GRAYLOG_URI);
```

### Code snippets

Short message:

```ts
logger.log("What we've got here is...failure to communicate");
```

Long message:

```ts
logger.log("What we've got here is...failure to communicate", {
  full_message:
    "Some men you just can't reach. So you get what we had here last week, which is the way he wants it... well, he gets it. I don't like it any more than you men.",
});
```

Short with additional data:

```ts
logger.log("What we've got here is...failure to communicate", { cool: 'beans' });
```

Long with additional data & overriding GELF's payload fields `full_message`, `facility`, `level`, `timestamp`, `hostname`:

```ts
logger.log("What we've got here is...failure to communicate", {
  full_message:
    "Some men you just can't reach. So you get what we had here last week, which is the way he wants it... well, he gets it. I don't like it any more than you men.",
  cool: 'beans',
  facility: 'app.js',
  level: 3,
  timestamp: new Date('2020-04-07T10:20:30Z'),
  hostname: 'custom-host',
});
```

Flush all log messages and close down:

```ts
logger.close().then(() => {
  console.log('All logs sended! Client disconnected!');
  process.exit();
});
```

## Installation

```bash
npm install @pskzcompany/graylog
```

## Graylog GELF payload spec

In this library is used GELF Payload Specification, Version 1.1 (11/2013) from <http://docs.graylog.org/en/3.0/pages/gelf.html#gelf-payload-specification>. Its TypeScript declaration can be found in [./src/definitions.ts](./src/definitions.ts).

Avaliable LOG LEVEL CODES:

```ts
export enum GraylogLevelEnum {
  /** system is unusable */
  EMERG = 0,
  /** action must be taken immediately */
  ALERT = 1,
  /** critical conditions */
  CRIT = 2,
  /** error conditions */
  ERR = 3,
  /** warning conditions */
  WARNING = 4,
  /** normal, but significant, condition */
  NOTICE = 5,
  /** informational message */
  INFO = 6,
  /** debug level message */
  DEBUG = 7,
}
```

## Graylog Configuration

This module will send its data as GELF packets to Graylog. In order to see your data in the correct format you need to create a GELF Input in your Graylog application.

You can do this by following these instructions:

1. Go to System -> Inputs

<div align="center">
    <img src="./imgs/graylog_config_1.png">
</div>

2. Select a GELF Input type. In this case we will be using GELF UDP as it doesn't need any additional configuration.

<div align="center">
    <img src="./imgs/graylog_config_2.png">
</div>

3. Select the Nodes that will read the new Input type.

<div align="center">
    <img src="./imgs/graylog_config_3.png">
</div>

4. Launch the new input!

<div align="center">
    <img src="./imgs/graylog_config_4.png">
</div>
