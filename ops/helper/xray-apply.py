#!/usr/bin/env python3
"""Validate the fixed user-owned input; never accept executable/routing fields."""
import json,os,pathlib,pwd,subprocess,tempfile

def validate(data):
    from re import fullmatch
    assert set(data) == {'log','api','stats','policy','inbounds','outbounds','routing'}
    assert data['log'] == {'loglevel':'warning'}
    assert data['api'] == {'tag':'api','services':['StatsService']}
    assert data['stats'] == {}
    assert data['policy'] == {'levels': {'0': {'statsUserUplink': True, 'statsUserDownlink': True}}}
    assert data['outbounds'] == [{'tag':'direct','protocol':'freedom'}]
    assert data['routing'] == {'rules':[{'type':'field','inboundTag':['api-in'],'outboundTag':'api'}]}
    api,vless=data['inbounds']
    assert api == {'tag':'api-in','listen':'127.0.0.1','port':10086,'protocol':'dokodemo-door','settings':{'address':'127.0.0.1'}}
    assert set(vless) == {'tag','listen','port','protocol','settings','streamSettings'}
    assert (vless['tag'],vless['listen'],vless['port'],vless['protocol']) == ('zvpn-vless','127.0.0.1',10085,'vless')
    assert vless['streamSettings'] == {'network':'xhttp','security':'none','xhttpSettings':{'path':'/zvpn-xhttp/','mode':'auto'}}
    assert set(vless['settings']) == {'clients','decryption'} and vless['settings']['decryption'] == 'none'
    seen=set()
    for user in vless['settings']['clients']:
        assert set(user) == {'id','email','level'} and user['level'] == 0
        assert fullmatch('[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',user['id'])
        assert fullmatch('zvpn-[0-9a-f-]{36}',user['email']) and user['id'] not in seen
        seen.add(user['id'])
    return data

def test_config(binary, path):
    # Temporary filenames must not determine the parser used for trusted JSON.
    result=subprocess.run([binary,'run','-test','-format','json','-config',path],
                          capture_output=True,text=True)
    if result.returncode:
        raise RuntimeError('Xray configuration validation failed: '+
                           (result.stdout+result.stderr).strip())

def main():
    source=pathlib.Path('/opt/zvpn-panel/runtime/xray.json')
    fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd) as file:
        info=os.fstat(file.fileno())
        assert info.st_uid == pwd.getpwnam('zvpn').pw_uid and info.st_mode & 0o077 == 0
        assert info.st_size < 32*1024*1024
        data=validate(json.load(file))
    with tempfile.NamedTemporaryFile(mode='w',suffix='.json',dir='/usr/local/etc/xray',delete=False) as file:
        json.dump(data,file); temp=file.name
    try:
        test_config('/usr/local/bin/xray',temp)
        os.chown(temp,0,pwd.getpwnam('xray').pw_gid);os.chmod(temp,0o640)
        os.replace(temp,'/usr/local/etc/xray/config.json')
        subprocess.run(['systemctl','restart','xray'],check=True)
        subprocess.run(['systemctl','is-active','--quiet','xray'],check=True)
    finally:
        if os.path.exists(temp): os.unlink(temp)

if __name__ == '__main__': main()
