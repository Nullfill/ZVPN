import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSas } from '../src/services/saParser.js';

test('parseSas accepts spaced strongSwan raw output and sums CHILD_SA bytes', () => {
  const raw = `list-sa event {
    ikev2-vpn-1 {
      uniqueid = 41
      remote-id = "alice@example.com"
      remote-host = 198.51.100.8
      remote-port = 4500
      established = 17
      remote-vips = [10.10.10.2]
      child-a { bytes-in = 100 bytes-out = 200 }
      child-b { bytes-in = 3 bytes-out = 7 }
    }
  }
list-sa event {
    ikev2-vpn-2 {
      uniqueid=42 remote-id=bob remote-host=203.0.113.9 remote-port=500
      established=400 remote-vips=[10.10.10.3]
      child { bytes-in=10 bytes-out=20 }
    }
  }`;

  assert.deepEqual(parseSas(raw), [
    {
      ikeId: '41',
      remoteId: 'alice@example.com',
      remoteHost: '198.51.100.8',
      remotePort: '4500',
      established: 17,
      virtualIp: '10.10.10.2',
      bytesIn: 103,
      bytesOut: 207,
      bytesTotal: 310,
    },
    {
      ikeId: '42',
      remoteId: 'bob',
      remoteHost: '203.0.113.9',
      remotePort: '500',
      established: 400,
      virtualIp: '10.10.10.3',
      bytesIn: 10,
      bytesOut: 20,
      bytesTotal: 30,
    },
  ]);
});

test('parseSas drops malformed sessions without numeric uniqueid or remote id', () => {
  assert.deepEqual(parseSas(`
list-sa event { uniqueid = nope remote-id = alice }
list-sa event { uniqueid = 1 }
`), []);
});

test('parseSas prefers remote-eap-id over remote-id when client sends LAN IP as IDi', () => {
  const raw = `list-sa event {
    ikev2-vpn {
      uniqueid = 30
      remote-id = 192.168.1.85
      remote-eap-id = "hamednew"
      remote-host = 5.121.228.87
      remote-port = 4500
      established = 2400
      remote-vips = [10.20.0.10]
      child { bytes-in = 1000 bytes-out = 2000 }
    }
  }`;
  const parsed = parseSas(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].remoteId, 'hamednew');
  assert.equal(parsed[0].ikeId, '30');
});
