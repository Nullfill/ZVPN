import http from 'node:http';

export function firefoxControl(operation, data={}) {
  const allowed=new Set(['status','locations','check','renew','login/start','login/complete','country','logout','reconnect']);
  if(!allowed.has(operation))throw Error('INVALID_FIREFOX_OPERATION');
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:'/run/zvpn-firefox/control.sock',method:'POST',path:'/'+operation,
      headers:{'Content-Type':'application/json'}},res=>{
      let raw='',size=0;
      res.on('data',b=>{size+=b.length;if(size>131072)req.destroy(Error('FIREFOX_RESPONSE_TOO_LARGE'));else raw+=b;});
      res.on('end',()=>{try{
        const result=JSON.parse(raw);
        if(res.statusCode!==200){const e=Error(result.error||'FIREFOX_ERROR');e.code=e.message;reject(e);}else resolve(result);
      }catch{reject(Error('FIREFOX_RESPONSE_INVALID'));}});
      res.on('error',()=>reject(Error('FIREFOX_UNAVAILABLE')));
    });
    req.setTimeout(65000,()=>req.destroy(Error('FIREFOX_TIMEOUT')));
    req.on('error',e=>reject(Error(e.code==='ENOENT'||e.code==='ECONNREFUSED'?'FIREFOX_NOT_INSTALLED':e.message)));
    req.end(JSON.stringify(data));
  });
}
