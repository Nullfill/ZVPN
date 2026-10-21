import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelay } from '../netlify/edge-functions/relay.js';

const request = (path, init) => new Request('https://test.netlify.app' + path, init);
test('only XHTTP session paths are forwarded; admin paths and encoded traversal never reach origin', async () => {
  let calls = 0;
  const relay = createRelay('https://origin.example', async () => { calls++; return new Response('ok'); });
  for (const path of ['/api/settings', '/', '/zvpn-xhttp/../api/settings',
    '/zvpn-xhttp/%2e%2e%2fapi/settings', '/zvpn-xhttp/session/%2e%2e%2fapi', '/zvpn-xhttp//api']) {
    assert.equal((await relay(request(path))).status, 404, path);
  }
  assert.equal(calls, 0);
  assert.equal((await relay(request('/zvpn-xhttp/session-123/0?x_padding=abc'))).status, 200);
  assert.equal(calls, 1);
});
test('POST bytes and XHTTP headers stream through; cookies and proxy credentials do not', async () => {
  const relay = createRelay('https://origin.example', async (url, init) => {
    assert.equal(url.href, 'https://origin.example/zvpn-xhttp/session/123?x_padding=abc');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.get('x-padding'), 'abcd');
    for (const h of ['host', 'cookie', 'authorization', 'proxy-authorization', 'x-nf-test', 'x-private']) {
      assert.equal(init.headers.has(h), false, h);
    }
    assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), new Uint8Array([0, 255, 1]));
    return new Response(new Uint8Array([9, 0, 255]), { headers: { 'set-cookie': 'secret=1', 'cache-control': 'public' } });
  });
  const output = await relay(request('/zvpn-xhttp/session/123?x_padding=abc', {
    method: 'POST', body: new Uint8Array([0, 255, 1]), headers: {
      host: 'evil.example', cookie: 'session=secret', authorization: 'Bearer secret',
      'proxy-authorization': 'secret', 'x-nf-test': '1', 'x-padding': 'abcd',
      connection: 'x-private', 'x-private': 'secret',
    },
  }));
  assert.equal(output.headers.has('set-cookie'), false);
  assert.equal(output.headers.get('cache-control'), 'no-store');
  assert.deepEqual(new Uint8Array(await output.arrayBuffer()), new Uint8Array([9, 0, 255]));
});
test('missing configuration, failures and redirects cannot expose an upstream URL', async () => {
  for (const target of ['', 'http://origin.example', 'https://user:pass@origin.example', 'https://origin.example/api']) {
    assert.equal((await createRelay(target)(request('/zvpn-xhttp/session'))).status, 503);
  }
  const redirect = createRelay('https://origin.example', async () => new Response(null, {
    status: 302, headers: { location: 'https://origin.example/admin' },
  }));
  const output = await redirect(request('/zvpn-xhttp/session'));
  assert.equal(output.status, 502);
  assert.equal(output.headers.has('location'), false);
  const failed = createRelay('https://origin.example', async () => { throw Error('private origin information'); });
  assert.equal(await (await failed(request('/zvpn-xhttp/session'))).text(), 'Relay unavailable');
});

test('download response is returned before the complete body arrives', async () => {
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; c.enqueue(new Uint8Array([1])); } });
  const incoming = request('/zvpn-xhttp/session');
  const relay = createRelay('https://origin.example', async (_url, init) => {
    assert.equal(init.signal, incoming.signal);
    return new Response(stream);
  });
  const result = await relay(incoming);
  const reader = result.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1]));
  controller.enqueue(new Uint8Array([2]));
  controller.close();
  assert.deepEqual((await reader.read()).value, new Uint8Array([2]));
  assert.equal((await reader.read()).done, true);
});
