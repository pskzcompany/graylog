import Graylog from './';
import fs from 'fs';

// Provide `false` if you want to test on real server
const USE_SNAPSHOT_MOCKS = true;

const servers = [
  { host: '127.0.0.1', port: 12201 },
  // { host: '10.216.129.25', port: 5555 },
];
const client = new Graylog({
  servers,
  facility: 'Test logger / Node.JS Test Script',
});

let checkSnapshot = () => {};
if (USE_SNAPSHOT_MOCKS) {
  let socketSpyData = [] as any;
  checkSnapshot = () => {
    expect(socketSpyData).toMatchSnapshot();
    socketSpyData = [];
  };

  // Mock Socket.send method
  client.getClient().send = jest.fn((msg, offset, length, port, address, callback) => {
    socketSpyData.push({ msg: msg.toString(), offset, length, port, address });
    callback(null, length);
  }) as any;

  // Mock client data
  client._generateRandomId = async (n) => Buffer.from('1'.repeat(n));
  client.servers = [{ host: 'mock', port: 12201 }];
  client.hostname = 'mock-host';

  // Mock Date.now
  global.Date.now = jest.fn(() => new Date('2020-04-07T10:20:30Z').getTime());
}

describe('Graylog', () => {
  afterAll(async () => {
    await client.close();
  });

  it('Sending different parameters', async () => {
    await client.log('ParametersTest - Only short message');
    await client.log('ParametersTest - Short message and json', { cool: 'beans' });
    await client.log('ParametersTest - Short message and full message', {
      full_message: 'Full message',
    });
    await client.log('ParametersTest - Short Message with full message and json', {
      full_message: 'Full message',
      cool: 'beans',
    });

    checkSnapshot();
  });

  it('Sending three test as info, warning and error', async () => {
    await client.log('test level 6', { cool: 'beans', full_message: 'i get this1' });
    await client.warn('test level 4', { cool: 'beans', full_message: 'i get this2' });
    await client.error('test level 3', { cool: 'beans', full_message: 'i get this3' });
    await client.error('customTime', {
      cool: 'beans',
      full_message: 'i get this3',
      timestamp: new Date('2012-10-10 13:20:31.619Z'),
    });

    checkSnapshot();
  });

  it('Sending Sean Connery picture (as critical)', async () => {
    const data = fs.readFileSync('./data/sean.jpg');
    await client.critical('My Nice Sean Connery Picture', {
      full_message: data.toString(),
      name: 'James Bond',
    });

    checkSnapshot();
  });

  it('Sending data of different sizes (as critical)', async () => {
    for (let i = 4; i <= 128; i *= 2) {
      const file = './data/' + i + '.dat';
      const data = fs.readFileSync(file);
      await client.critical('Test with deflate ' + file, {
        full_message: data.toString(),
        datafile: i + '.dat',
      });
    }

    checkSnapshot();
  });

  it('Sending without deflate', async () => {
    client.deflate = 'never';
    for (let i = 4; i <= 64; i *= 2) {
      const file = './data/' + i + '.dat';
      const data = fs.readFileSync(file);
      await client.critical('Test without deflate ' + file, {
        full_message: data.toString(),
        datafile: i + '.dat',
      });
    }
    client.deflate = 'optimal';

    checkSnapshot();
  });

  it('Checking deflate assertion', () => {
    expect(() => {
      new Graylog({
        servers,
        facility: 'Test logger / Node.JS Test Script',
        deflate: 'not an option' as any,
      });
    }).toThrowError('deflate must be one of');
  });

  it('Checking `disablePromiseRejection` arg for `_log` operation', async () => {
    const tmpClient = new Graylog({
      servers,
    });
    tmpClient.getClient().send = () => {
      throw new Error('Connection error');
    };

    await expect(tmpClient._log('msg', {}, 3)).rejects.toThrowError('Connection error');
    await expect(tmpClient._log('msg', {}, 3, false)).rejects.toThrowError('Connection error');
    await expect(tmpClient._log('msg', {}, 3, true)).resolves.toBe(false);
  });

  it('Checking regular log methods which resolve with false on error', async () => {
    const tmpClient = new Graylog({
      servers,
    });
    tmpClient.getClient().send = () => {
      throw new Error('Connection error');
    };

    await expect(tmpClient.emergency('msg', {})).resolves.toBe(false);
    await expect(tmpClient.alert('msg', {})).resolves.toBe(false);
    await expect(tmpClient.critical('msg', {})).resolves.toBe(false);
    await expect(tmpClient.error('msg', {})).resolves.toBe(false);
    await expect(tmpClient.warning('msg', {})).resolves.toBe(false);
    await expect(tmpClient.warn('msg', {})).resolves.toBe(false);
    await expect(tmpClient.notice('msg', {})).resolves.toBe(false);
    await expect(tmpClient.info('msg', {})).resolves.toBe(false);
    await expect(tmpClient.log('msg', {})).resolves.toBe(false);
    await expect(tmpClient.debug('msg', {})).resolves.toBe(false);
  });

  it('Checking that log methods return request bytes on success', async () => {
    const requestLength = 130;
    await expect(client.emergency('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.alert('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.critical('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.error('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.warning('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.warn('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.notice('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.info('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.log('msg', {})).resolves.toBeGreaterThan(requestLength);
    await expect(client.debug('msg', {})).resolves.toBeGreaterThan(requestLength);
  });

  it('Checking `onError` param', async () => {
    let lastError;
    const tmpClient = new Graylog({
      servers,
      onError: (e) => {
        lastError = e;
      },
    });
    tmpClient.getClient().send = () => {
      throw new Error('Connection error');
    };

    expect(lastError).toBe(undefined);
    const res = await tmpClient.log('msg', {});
    expect(res).toBe(false);
    expect(lastError?.message).toBe('Connection error');
  });
});
