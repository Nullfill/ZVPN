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
    api,direct,relay=data['inbounds']
    assert api == {'tag':'api-in','listen':'127.0.0.1','port':10086,'protocol':'dokodemo-door','settings':{'address':'127.0.0.1'}}
    for vless,tag,port,path,prefix in [(direct,'zvpn-vless',10085,'/zvpn-xhttp/','zvpn-'),(relay,'zvpn-netlify',10090,'/zvpn-netlify/','zvpn-netlify-')]:
        assert set(vless) == {'tag','listen','port','protocol','settings','streamSettings'}
        assert (vless['tag'],vless['listen'],vless['port'],vless['protocol']) == (tag,'127.0.0.1',port,'vless')
        assert vless['streamSettings'] == {'network':'xhttp','security':'none','xhttpSettings':{'path':path,'mode':'auto'}}
        assert set(vless['settings']) == {'clients','decryption'} and vless['settings']['decryption'] == 'none'
        seen=set()
        for user in vless['settings']['clients']:
            assert set(user) == {'id','email','level'} and user['level'] == 0
            assert fullmatch('[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',user['id'])
            assert fullmatch(prefix+'[0-9a-f-]{36}',user['email']) and user['id'] not in seen
            seen.add(user['id'])
    assert [(u['id'],u['email'].removeprefix('zvpn-')) for u in direct['settings']['clients']] == [(u['id'],u['email'].removeprefix('zvpn-netlify-')) for u in relay['settings']['clients']]
    return data

def test_config(binary, path):
    # New cores may dispatch by filename extension even with -format=json.
    # Use a private .json copy, including for extensionless backup/temp files.
    with tempfile.TemporaryDirectory(prefix='zvpn-xray-check-') as directory:
        probe=pathlib.Path(directory)/'config.json'
        probe.write_bytes(pathlib.Path(path).read_bytes())
        result=subprocess.run([binary,'run','-test','-format','json','-config',str(probe)],
                              capture_output=True,text=True,timeout=20)
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
    # Routing extensions come from a separately validated root-owned policy.
    from warp_policy import main_xray, read_policy
    data=main_xray(data, read_policy())
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
