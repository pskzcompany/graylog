# @pskzcompany/node-graylog2

[![gitlab action](https://github.com/pskzcompany/node-graylog2/workflows/nodejs/badge.svg)](https://github.com/pskzcompany/node-graylog2/actions)
[![npm](https://img.shields.io/npm/v/@pskzcompany/node-graylog2.svg)](https://www.npmjs.com/package/@pskzcompany/node-graylog2)
[![Fully automated version management and package publishing](https://badges.greenkeeper.io/semantic-release/semantic-release.svg)](https://github.com/semantic-release/semantic-release)

Graylog2 client library for Node.js, based on node-graylog. This
has been heavily modified to the point where there is not much left
of the original; however, this library should still be compatible
with the old one, except for configuration and the GLOBAL function setup
(some optional arguments in logging calls are not supported; they will be
logged as additional data).

**New:** Chunked [GELF](https://github.com/Graylog2/graylog2-docs/wiki/GELF)
is now supported.

## Synopsis

### Available functions

- graylog.emergency
- graylog.alert
- graylog.critical
- graylog.error
- graylog.warning
- graylog.notice
- graylog.info
- graylog.debug

### Code snippets

```javascript
var graylog2 = require('graylog2');
var logger = new graylog2.graylog({
  servers: [
    { host: '127.0.0.1', port: 12201 },
    { host: '127.0.0.2', port: 12201 },
  ],
  hostname: 'server.name', // the name of this host
  // (optional, default: os.hostname())
  facility: 'Node.js', // the facility for these log messages
  // (optional, default: "Node.js")
  bufferSize: 1350, // max UDP packet size, should never exceed the
  // MTU of your system (optional, default: 1400)
});

logger.on('error', function (error) {
  console.error('Error while trying to write to graylog2:', error);
});
```

Short message:

```javascript
logger.log("What we've got here is...failure to communicate");
```

Long message:

```javascript
logger.log(
  "What we've got here is...failure to communicate",
  "Some men you just can't reach. So you get what we had here last week, which is the way he wants it... well, he gets it. I don't like it any more than you men."
);
```

Short with additional data:

```javascript
logger.log("What we've got here is...failure to communicate", { cool: 'beans' });
```

Long with additional data:

```javascript
logger.log(
  "What we've got here is...failure to communicate",
  "Some men you just can't reach. So you get what we had here last week, which is the way he wants it... well, he gets it. I don't like it any more than you men.",
  {
    cool: 'beans',
  }
);
```

Flush all log messages and close down:

```javascript
logger.close(function () {
  console.log('All done - cookie now?');
  process.exit();
});
```

## Example

See `test.js`.

## What is graylog2 after all?

It's a miracle. Get it at <http://www.graylog2.org/>

## Installation

```bash
npm install @pskzcompany/graylog2
```

## Graylog2 Configuration

This module will send its data as GELF packets to Graylog2. In order to see your data in the correct format you need to create a GELF Input in your Graylog2 application.

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
