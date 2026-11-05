// Native Node HTTP/2 client; no browser profile extraction or third-party binary.
import http2 from 'node:http2';
import crypto from 'node:crypto';
import net from 'node:net';

export const CLIENT_ID = 'a2270f727f45f648'; // Public Mozilla Android client; unofficial integration.
export const REDIRECT = `https://accounts.firefox.com/oauth/success/${CLIENT_ID}`;
export const GUARDIAN = 'https://vpn.mozilla.org';
export const CATALOG = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/vpn-serverlist/records';
export function loginAttempt(owner) {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  const url = new URL('https://oauth.accounts.firefox.com/v1/authorization');
  url.search = new URLSearchParams({client_id: CLIENT_ID, scope: 'profile https://identity.mozilla.com/apps/vpn',
    response_type: 'code', access_type: 'offline', redirect_uri: REDIRECT, state,
    code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url')});
  return {owner, verifier, state, expires: Date.now()+600000, url: url.href};
}
export function callbackCode(attempt, owner, callback) {
  if (!attempt || attempt.owner !== owner || attempt.expires < Date.now()) throw Error('LOGIN_EXPIRED');
  let url; try { url = new URL(callback); } catch { throw Error('INVALID_CALLBACK'); }
  const expected = new URL(REDIRECT);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.searchParams.getAll('state').length !== 1
      || url.searchParams.get('state') !== attempt.state || url.searchParams.getAll('code').length !== 1
      || !url.searchParams.get('code') || url.searchParams.has('error')) throw Error('INVALID_CALLBACK');
  return url.searchParams.get('code');
}
export function seal(data, key) {
  const iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',key,iv);
  const bytes=Buffer.concat([c.update(JSON.stringify(data)),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),bytes]);
}
export function unseal(bytes,key) {
  const c=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([c.update(bytes.subarray(28)),c.final()]).toString());
}
export function locations(records) {
  if (!Array.isArray(records) || records.length > 1000) throw Error('CATALOG_INVALID');
  const result=[];
  for (const country of records) {
    if (!/^[A-Z]{2}$/.test(country.code) || country.locked !== false || !Array.isArray(country.cities)) continue;
    const servers=[];
    for (const city of country.cities) for (const s of city.servers || []) {
      if ((s.quarantined !== undefined && s.quarantined !== false) || !/^[a-z0-9-]+\.m[0-9]+\.fastly-masque\.net$/.test(s.hostname || '')
          || !Number.isInteger(s.port ?? 443) || (s.port ?? 443)<1 || (s.port ?? 443)>65535) continue;
      // Unknown transport declarations are never guessed.
      if (s.protocols && (!Array.isArray(s.protocols) || !s.protocols.every(p => p === 'https'))) continue;
      servers.push({hostname:s.hostname,port:s.port ?? 443});
    }
    if (servers.length) result.push({code:country.code,name:String(country.name || country.code).slice(0,100),servers});
  }
  const merged=new Map();
  for(const country of result){
    if(!merged.has(country.code))merged.set(country.code,{...country,servers:[]});
    const dest=merged.get(country.code).servers;
    for(const server of country.servers)if(!dest.some(s=>s.hostname===server.hostname&&s.port===server.port))dest.push(server);
  }
  return [...merged.values()];
}
export function quota(headers) {
  const integer=k=> /^\d+$/.test(String(headers[k] ?? '')) ? String(headers[k]) : null;
  const reset=headers['x-quota-reset'];
  return {limit:integer('x-quota-limit'),remaining:integer('x-quota-remaining'),
    reset:typeof reset==='string' && Number.isFinite(Date.parse(reset)) ? reset : null,
    unlimited:headers['x-quota-unlimited']==='true' ? true : headers['x-quota-unlimited']==='false' ? false : null};
}
export function serviceError(status, source='guardian') {
  if (status===401) return 'REAUTH_REQUIRED';
  if (status===429 && source==='guardian') return 'QUOTA_EXHAUSTED';
  if (status===451) return 'REGION_UNAVAILABLE';
  if (status===403) return 'ACCOUNT_NOT_ELIGIBLE';
  return 'PROVIDER_HTTP_'+status;
}
export function api(url, {method='GET', token, body}={}) {
  const u=new URL(url);
  if (u.protocol!=='https:') throw Error('HTTPS_REQUIRED');
  return new Promise((resolve,reject)=>{
    const session=http2.connect(u.origin);let stream,finished=false;
    const timer=setTimeout(()=>finish(Error('API_TIMEOUT')),15000);
    function finish(err,value) {if(finished)return;finished=true;clearTimeout(timer);stream?.close();session.destroy();err?reject(err):resolve(value);}
    session.on('error',()=>finish(Error('API_NETWORK_ERROR')));
    session.once('connect',()=>{
      const headers={':method':method,':path':u.pathname+u.search,'cache-control':'no-cache','content-type':'application/json'};
      if(token)headers.authorization='Bearer '+token;
      stream=session.request(headers);let response,data=[],size=0;
      stream.on('response',h=>response=h);
      stream.on('data',b=>{size+=b.length;if(size>4*1024*1024)finish(Error('API_RESPONSE_TOO_LARGE'));else data.push(b);});
      stream.on('error',()=>finish(Error('API_NETWORK_ERROR')));
      stream.on('end',()=>{try {
        if(!response)throw Error('API_RESPONSE_INVALID');
        const text=Buffer.concat(data).toString();
        finish(null,{status:Number(response[':status']),headers:response,data:text?JSON.parse(text):{}});
      } catch {finish(Error('API_RESPONSE_INVALID'));}});
      stream.end(body===undefined ? undefined : JSON.stringify(body));
    });
  });
}
export function authority(host,port) {
  if (!Number.isInteger(port) || port<1 || port>65535 || typeof host!=='string' || host.length>253
      || (!net.isIP(host) && !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host))) throw Error('INVALID_DESTINATION');
  return (net.isIP(host)===6?'['+host+']':host)+':'+port;
}
export function connectTunnel(server,token,host,port,options={}) {
  const target=authority(host,port);
  return new Promise((resolve,reject)=>{
    const session=http2.connect(`https://${server.hostname}:${server.port}`,options);
    let stream,ready=false;const timer=setTimeout(()=>fail(Error('CONNECT_TIMEOUT')),15000);
    function fail(e){clearTimeout(timer);if(!ready)reject(e);stream?.destroy();session.destroy();}
    session.on('error',()=>fail(Error('TUNNEL_NETWORK_ERROR')));
    session.on('goaway',()=>fail(Error('TUNNEL_GOAWAY')));
    session.once('connect',()=>{
      stream=session.request({':method':'CONNECT',':authority':target,'proxy-authorization':'Bearer '+token},{endStream:false});
      stream.on('error',()=>fail(Error('TUNNEL_STREAM_ERROR')));
      stream.once('response',headers=>{
        if(headers[':status']!==200)return fail(Error(serviceError(headers[':status'],'proxy')));
        ready=true;clearTimeout(timer);stream.setTimeout(600000,()=>stream.destroy());resolve(stream);
      });
      stream.once('close',()=>{clearTimeout(timer);if(!ready)reject(Error('TUNNEL_CLOSED'));session.destroy();});
    });
  });
}
