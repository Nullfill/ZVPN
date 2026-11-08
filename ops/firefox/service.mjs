import fs from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import tls from 'node:tls';
import {CLIENT_ID, REDIRECT, GUARDIAN, CATALOG, loginAttempt, callbackCode, seal, unseal,
  locations, quota, api, serviceError, TunnelPool} from './core.mjs';

const DIR='/var/lib/zvpn-panel/firefox', SOCKET='/run/zvpn-firefox/control.sock';
const key=await fs.readFile('/etc/zvpn/firefox.key');
if(key.length!==32)throw Error('INVALID_KEY');
let saved={country:'REC'},pending=null,proxy=null,refreshJob=null,oauthJob=null,catalogJob=null,catalog=[],catalogAt=0;
let writes=Promise.resolve();
let generation=0,lastError=null,lastCheck=null,active=new Set(),busy=false;
let tokenRetryAt=0,tokenFailure=null;
const pool=new TunnelPool();let endpoint=null;
try {saved=unseal(await fs.readFile(DIR+'/account.enc'),key);} catch(e) {if(e.code!=='ENOENT')throw Error('CREDENTIAL_STORE_INVALID');}
function persist(){
  const bytes=seal(saved,key),epoch=generation;
  const job=writes.then(async()=>{
    if(epoch!==generation)return;
    const p=DIR+'/account.enc.tmp';await fs.writeFile(p,bytes,{mode:0o600});await fs.rename(p,DIR+'/account.enc');
  });writes=job.catch(()=>{});return job;
}
function closeTunnels(){for(const s of active)s.destroy();active.clear();pool.close();endpoint=null;}
async function listLocations(){
  if(catalog.length && Date.now()-catalogAt<3600000)return catalog;
  if(catalogJob)return catalogJob;
  catalogJob=(async()=>{
    let url=CATALOG,records=[];
    for(let page=0;page<10;page++){
      const r=await api(url);if(r.status!==200)throw Error('CATALOG_UNAVAILABLE');
      records.push(...(r.data.data || []));
      const next=r.headers['next-page'];
      if(!next){const nextCatalog=locations(records);if(!nextCatalog.some(c=>c.available))throw Error('NO_AVAILABLE_LOCATIONS');catalog=nextCatalog;catalogAt=Date.now();return catalog;}
      const n=new URL(next,url);if(n.origin!==new URL(CATALOG).origin || n.pathname!==new URL(CATALOG).pathname)throw Error('CATALOG_INVALID');url=n.href;
    }throw Error('CATALOG_TOO_LARGE');
  })();try{return await catalogJob;}finally{catalogJob=null;}
}
async function oauthToken(){
  const epoch=generation;
  if(!saved.token?.access_token)throw Error('REAUTH_REQUIRED');
  if(saved.expires>Date.now()+120000)return saved.token.access_token;
  if(!saved.token.refresh_token)throw Error('REAUTH_REQUIRED');
  if(oauthJob)return oauthJob;
  oauthJob=(async()=>{
  const r=await api('https://oauth.accounts.firefox.com/v1/token',{method:'POST',body:{client_id:CLIENT_ID,grant_type:'refresh_token',refresh_token:saved.token.refresh_token}});
  if(r.status!==200 || !r.data.access_token)throw Error('REAUTH_REQUIRED');
  const expires=Number(r.data.expires_in);
  if(!Number.isFinite(expires)||expires<=0)throw Error('TOKEN_RESPONSE_INVALID');
  if(epoch!==generation)throw Error('ACCOUNT_CHANGED');
  saved.token={...saved.token,...r.data};saved.expires=Date.now()+expires*1000;await persist();return saved.token.access_token;
  })();try{return await oauthJob;}finally{oauthJob=null;}
}
async function proxyPass(){
  if(proxy && proxy.expires>Date.now()+120000)return proxy.token;
  if(refreshJob)return refreshJob;
  if(Date.now()<tokenRetryAt)throw Error(tokenFailure || 'TOKEN_RETRY_LATER');
  const epoch=generation;
  refreshJob=(async()=>{
    let token=await oauthToken();let r=await api(GUARDIAN+'/api/v1/fpn/token',{token});
    if(r.status===401 && saved.token?.refresh_token && epoch===generation){
      saved.expires=0;token=await oauthToken();r=await api(GUARDIAN+'/api/v1/fpn/token',{token});
    }
    if(epoch!==generation)throw Error('ACCOUNT_CHANGED');
    saved.quota=quota(r.headers);
    if(r.status!==200)throw Error(serviceError(r.status));
    const value=r.data.token;if(typeof value!=='string'||value.length>32768)throw Error('PROXYPASS_INVALID');
    let claim;try{claim=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));}catch{throw Error('PROXYPASS_INVALID');}
    // Claims schedule renewal only. The verified TLS proxy checks authorization/signature.
    if(!Number.isFinite(claim.exp)||!Number.isFinite(claim.nbf)||claim.exp<=claim.nbf)throw Error('PROXYPASS_INVALID');
    if(epoch!==generation)throw Error('ACCOUNT_CHANGED');
    proxy={token:value,expires:Date.now()+Math.min(claim.exp-claim.nbf,claim.exp-Date.now()/1000)*1000};
    if(proxy.expires<=Date.now()+10000){proxy=null;throw Error('PROXYPASS_EXPIRED');}
    tokenRetryAt=0;tokenFailure=null;await persist();return value;
  })();try{return await refreshJob;}catch(e){
    if(epoch===generation){tokenFailure=e.message;tokenRetryAt=Date.now()+30000;}
    throw e;
  }finally{refreshJob=null;}
}
async function selectedServer(){
  const all=await listLocations();
  const country=saved.country==='REC'?all.find(c=>c.available):all.find(c=>c.code===saved.country);
  if(!country?.servers.length)throw Error('REGION_UNAVAILABLE');
  if(endpoint?.country===country.code && country.servers.some(s=>s.hostname===endpoint.hostname&&s.port===endpoint.port))return endpoint;
  if(endpoint)pool.close();
  endpoint={country:country.code,...country.servers[Math.floor(Math.random()*country.servers.length)]};return endpoint;
}
async function tunnel(host,port){
  const epoch=generation;const token=await proxyPass();const server=await selectedServer();
  if(epoch!==generation)throw Error('ACCOUNT_CHANGED');
  let stream;
  try{stream=await pool.open(server,token,host,port);}catch(e){
    if(e.message!=='REAUTH_REQUIRED'||epoch!==generation)throw e;
    // The rejected CONNECT carried no destination bytes; refresh once, never replay application data.
    proxy=null;stream=await pool.open(server,await proxyPass(),host,port);
  }
  if(epoch!==generation){stream.destroy();throw Error('ACCOUNT_CHANGED');}
  active.add(stream);stream.once('close',()=>active.delete(stream));return {stream,server};
}
async function check(){
  let s;
  try {
    const usage=await api(GUARDIAN+'/api/v1/fpn/token',{method:'HEAD',token:await oauthToken()});
    if(usage.status!==200)throw Error(serviceError(usage.status));
    saved.quota=quota(usage.headers);await persist();
    const t=await tunnel('www.cloudflare.com',443);s=t.stream;
    const secured=tls.connect({socket:s,servername:'www.cloudflare.com',rejectUnauthorized:true});
    const result=await new Promise((resolve,reject)=>{
      let data='';secured.setTimeout(15000,()=>secured.destroy(Error('PROBE_TIMEOUT')));
      secured.on('error',()=>reject(Error('PROBE_FAILED')));
      secured.on('secureConnect',()=>secured.write('GET /cdn-cgi/trace HTTP/1.1\r\nHost: www.cloudflare.com\r\nConnection: close\r\n\r\n'));
      secured.on('data',b=>{data+=b.toString();if(data.length>65536)secured.destroy(Error('PROBE_TOO_LARGE'));});
      secured.on('end',()=>resolve(data));
    });
    const fields=Object.fromEntries(result.split(/\r?\n/).filter(l=>/^(ip|loc)=/.test(l)).map(l=>l.split('=')));
    if(!/^HTTP\/1\.[01] 200 /.test(result)||!net.isIP(fields.ip))throw Error('PROBE_FAILED');
    lastCheck={healthy:true,exitIp:fields.ip,egressCountry:/^[A-Z]{2}$/.test(fields.loc)?fields.loc:null,
      serverCountry:t.server.country,checkedAt:new Date().toISOString()};lastError=null;
  }catch(e){lastError=e.message;lastCheck={healthy:false,checkedAt:new Date().toISOString()};}
  finally{s?.destroy();}
  return status();
}
function status(){return {installed:true,linked:!!saved.token,experimental:true,tcp:true,udp:false,
  state:!saved.token?'REAUTH_REQUIRED':lastError || (lastCheck?.healthy?'CONNECTED':'READY'),
  country:saved.country,quota:saved.quota || {limit:null,remaining:null,reset:null,unlimited:null},
  ...lastCheck,healthy:!!lastCheck?.healthy && !lastError,error:lastError,activeConnections:active.size,refreshAvailable:!!saved.token?.refresh_token};}
async function control(path,input){
  if(path==='/status')return status();
  if(path==='/locations')return {locations:(await listLocations()).map(({code,name,available})=>({code,name,available})).sort((a,b)=>a.name.localeCompare(b.name,'en'))};
  if(path==='/check')return await check();
  if(path==='/renew'){
    if(!saved.token?.refresh_token)throw Error('REAUTH_REQUIRED');
    if(refreshJob)await refreshJob.catch(()=>{});
    saved.expires=0;proxy=null;tokenRetryAt=0;return await check();
  }
  if(path==='/login/start'){
    if(saved.token)throw Error('DISCONNECT_ACCOUNT_FIRST');
    pending=loginAttempt(input.owner);return {url:pending.url,expiresAt:new Date(pending.expires).toISOString()};
  }
  if(path==='/login/complete'){
    if(saved.token)throw Error('DISCONNECT_ACCOUNT_FIRST');
    const code=callbackCode(pending,input.owner,input.callback);const attempt=pending;pending=null;
    const r=await api('https://oauth.accounts.firefox.com/v1/token',{method:'POST',body:{client_id:CLIENT_ID,grant_type:'authorization_code',code,code_verifier:attempt.verifier,redirect_uri:REDIRECT}});
    if(r.status!==200||!r.data.access_token||!Number.isFinite(Number(r.data.expires_in)))throw Error('LOGIN_EXCHANGE_FAILED');
    saved={...saved,token:r.data,expires:Date.now()+Number(r.data.expires_in)*1000};await persist();
    // This POST follows the explicit administrator account-connect action.
    const activated=await api(GUARDIAN+'/api/v1/fpn/activate',{method:'POST',token:saved.token.access_token});
    if(activated.status!==200 && activated.status!==201 && activated.status!==204){lastError=serviceError(activated.status);return status();}
    return await check();
  }
  if(path==='/country'){
    if(input.country!=='REC' && !(await listLocations()).some(c=>c.code===input.country && c.available))throw Error('REGION_UNAVAILABLE');
    generation++;proxy=null;lastCheck=null;lastError=null;tokenRetryAt=0;closeTunnels();saved.country=input.country;await persist();return status();
  }
  if(path==='/logout'){
    generation++;closeTunnels();proxy=null;pending=null;lastCheck=null;lastError=null;tokenRetryAt=0;saved={country:'REC'};
    await persist();return {...status(),serverRevocation:false};
  }
  if(path==='/reconnect'){generation++;closeTunnels();proxy=null;tokenRetryAt=0;return await check();}
  throw Error('INVALID_OPERATION');
}
// IPC is available only to the panel service group; it is never exposed over TCP.
await fs.rm(SOCKET,{force:true});
const controlServer=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.writeHead(405);res.end('{}');return;}
  try{
    let data='',size=0;for await(const b of req){size+=b.length;if(size>8192)throw Error('REQUEST_TOO_LARGE');data+=b;}
    if(req.url==='/status'){res.end(JSON.stringify(status()));return;}
    if(busy){res.writeHead(409);res.end(JSON.stringify({error:'BUSY'}));return;}
    busy=true;
    try{res.end(JSON.stringify(await control(req.url,JSON.parse(data||'{}'))));}finally{busy=false;}
  }catch(e){const error=/^[A-Z_0-9]+$/.test(e.message)?e.message:'PROVIDER_ERROR';res.writeHead(400);res.end(JSON.stringify({error}));}
});
controlServer.requestTimeout=30000;controlServer.headersTimeout=10000;
await new Promise(resolve=>controlServer.listen(SOCKET,resolve));await fs.chmod(SOCKET,0o660);

const clients=new Set();
function readBytes(socket,n){
  return new Promise((resolve,reject)=>{
    if(socket.destroyed){reject(Error('SOCKS_CLOSED'));return;}
    function read(){const b=socket.read(n);if(b){cleanup();resolve(b);}}
    function fail(){cleanup();reject(Error('SOCKS_CLOSED'));}
    function cleanup(){socket.off('readable',read);socket.off('close',fail);socket.off('error',fail);}
    socket.on('readable',read);socket.once('close',fail);socket.once('error',fail);read();
  });
}
let reservations=0;
const socks=net.createServer({allowHalfOpen:true},async socket=>{
  if(reservations>=64){socket.destroy();return;}reservations++;clients.add(socket);
  let handshakeDone=false,released=false;
  function release(){if(!released){released=true;reservations--;}}
  socket.on('error',()=>{});socket.once('close',()=>{clients.delete(socket);if(handshakeDone)release();});socket.setTimeout(15000,()=>socket.destroy());
  try{
    const greeting=await readBytes(socket,2);if(greeting[0]!==5||!greeting[1])throw Error('SOCKS_PROTOCOL');
    const methods=await readBytes(socket,greeting[1]);if(!methods.includes(0)){socket.end(Buffer.from([5,255]));return;}
    socket.write(Buffer.from([5,0]));const h=await readBytes(socket,4);
    if(h[0]!==5||h[1]!==1||h[2]!==0)throw Error('SOCKS_TCP_ONLY');
    let host;
    if(h[3]===3){const len=(await readBytes(socket,1))[0];if(!len)throw Error('SOCKS_PROTOCOL');host=(await readBytes(socket,len)).toString('ascii');}
    else if(h[3]===1)host=[...await readBytes(socket,4)].join('.');
    else if(h[3]===4){const v=await readBytes(socket,16);host=Array.from({length:8},(_,i)=>v.readUInt16BE(i*2).toString(16)).join(':');}
    else throw Error('SOCKS_PROTOCOL');
    const port=(await readBytes(socket,2)).readUInt16BE(0);const {stream}=await tunnel(host,port);
    if(socket.destroyed){stream.destroy();return;}
    socket.setTimeout(600000);socket.write(Buffer.from([5,0,0,1,0,0,0,0,0,0]));
    socket.pipe(stream).pipe(socket);socket.once('close',()=>stream.destroy());stream.once('close',()=>socket.destroy());
  }catch(e){lastError=/^[A-Z_0-9]+$/.test(e.message)?e.message:'TUNNEL_ERROR';socket.end(Buffer.from([5,1,0,1,0,0,0,0,0,0]));}
  finally{handshakeDone=true;if(socket.destroyed)release();}
});
socks.listen(40003,'127.0.0.1');
function shutdown(){generation++;closeTunnels();for(const s of clients)s.destroy();socks.close();controlServer.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
