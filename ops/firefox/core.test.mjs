import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http2 from 'node:http2';
import { execFileSync } from 'node:child_process';
import {once} from 'node:events';
import {loginAttempt,callbackCode,REDIRECT,seal,unseal,locations,quota,authority,connectTunnel} from './core.mjs';

test('PKCE callback binds administrator, redirect, state and lifetime',()=>{
  const a=loginAttempt('admin-a'),b=loginAttempt('admin-b');const u=new URL(a.url);
  assert.notEqual(a.verifier,b.verifier);assert.notEqual(a.state,b.state);
  assert.equal(u.searchParams.get('code_challenge'),crypto.createHash('sha256').update(a.verifier).digest('base64url'));
  const cb=REDIRECT+'?'+new URLSearchParams({code:'once-only-code',state:a.state});
  assert.equal(callbackCode(a,'admin-a',cb),'once-only-code');
  for(const [attempt,owner,url] of [[a,'admin-b',cb],[a,'admin-a',cb+'&state=x'],[b,'admin-a',cb],
    [{...a,expires:Date.now()-1},'admin-a',cb],[a,'admin-a',cb.replace('accounts.firefox.com','evil.example')],
    [a,'admin-a',cb+'&code=other'],[a,'admin-a','once-only-code']])assert.throws(()=>callbackCode(attempt,owner,url));
});
test('encrypted account needs matching key and detects modification',()=>{
  const key=crypto.randomBytes(32),data={token:{access_token:'private',refresh_token:'private-refresh'},country:'DE'};
  const bytes=seal(data,key);assert.equal(bytes.includes(Buffer.from('private')),false);
  assert.deepEqual(unseal(bytes,key),data);assert.throws(()=>unseal(bytes,crypto.randomBytes(32)));
  bytes[30]^=1;assert.throws(()=>unseal(bytes,key));
});
test('catalog exposes all countries but never selects quarantined or arbitrary proxy endpoints',()=>{
  const s={hostname:'fra12.m1.fastly-masque.net',port:2499};
  const record=servers=>({code:'DE',name:'Germany',locked:false,cities:[{servers}]});
  assert.equal(locations([record([s])])[0].servers[0].hostname,s.hostname);
  for(const change of [{hostname:'127.0.0.1'},{hostname:'example.com'},{port:0},{quarantined:true},{protocols:['http']},{protocols:'https'}])
    assert.deepEqual(locations([record([{...s,...change}])])[0].servers,[]);
  assert.equal(locations([{...record([s]),locked:true}])[0].available,true);
  assert.equal(locations([{...record([s]),locked:undefined}])[0].available,true);
  assert.equal(locations([record([{...s,quarantined:true}])])[0].available,false);
  assert.equal(locations([record([s]),record([s])]).length,1);
});
test('quota stays unknown without headers and byte counts retain precision',()=>{
  assert.deepEqual(quota({}),{limit:null,remaining:null,reset:null,unlimited:null});
  assert.equal(quota({'x-quota-remaining':'9007199254740993123'}).remaining,'9007199254740993123');
  assert.equal(quota({'x-quota-remaining':'-1','x-quota-reset':'bad'}).remaining,null);
  assert.equal(quota({'x-quota-unlimited':'false'}).unlimited,false);
  assert.equal(authority('::1',443),'[::1]:443');
  for(const h of ['site\r\nProxy-Authorization: x','a/b','example:443'])assert.throws(()=>authority(h,443));
});
test('TLS HTTP/2 CONNECT supports bidirectional flow and rejects denial without retry',
  {skip:process.platform==='win32'},async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'firefox-h2-test-'));let server;
    const sessions=new Set();
    try {
      const keyFile=path.join(dir,'key.pem'),certFile=path.join(dir,'cert.pem');
      execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
        '-addext','subjectAltName=DNS:localhost','-keyout',keyFile,'-out',certFile],{stdio:'ignore'});
      const cert=await fs.readFile(certFile);
      server=http2.createSecureServer({key:await fs.readFile(keyFile),cert});
      server.on('session',s=>{sessions.add(s);s.on('close',()=>sessions.delete(s));s.on('error',()=>{});});
      let requests=0;
      server.on('stream',(s,h)=>{
        requests++;s.on('error',()=>{});
        assert.equal(h[':method'],'CONNECT');assert.equal(h[':scheme'],undefined);assert.equal(h[':path'],undefined);
        assert.equal(h['proxy-authorization'],'Bearer unit-token');
        if(h[':authority']==='denied.example:443'){s.respond({':status':403});s.end();return;}
        assert.equal(h[':authority'],'destination.example:443');
        s.respond({':status':200});s.on('data',b=>s.write(b));s.on('end',()=>s.end());
      });
      server.listen(0,'127.0.0.1');await once(server,'listening');
      const target={hostname:'127.0.0.1',port:server.address().port};const opts={ca:cert,servername:'localhost'};
      const stream=await connectTunnel(target,'unit-token','destination.example',443,opts);
      const chunks=[];stream.on('data',b=>chunks.push(b));
      const ended=once(stream,'end');stream.end(Buffer.alloc(256*1024,65));await ended;
      assert.equal(Buffer.concat(chunks).length,256*1024);
      await assert.rejects(connectTunnel(target,'unit-token','denied.example',443,opts),/ACCOUNT_NOT_ELIGIBLE/);
      assert.equal(requests,2);
    }finally{
      for(const s of sessions)s.destroy();if(server)await new Promise(resolve=>server.close(resolve));
      await fs.rm(dir,{recursive:true,force:true});
    }
  });
