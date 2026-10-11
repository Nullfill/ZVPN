#!/usr/bin/env python3
"""Preserve the existing Certbot site while enabling XHTTP's TLS HTTP/2 endpoint."""
import pathlib,re

def configure(text):
    include='include /etc/nginx/zvpn-xray.inc;'
    if include not in text:
        text=re.sub(r'(^[ \t]*server_name[^;]+;)',r'\1\n    '+include,text,flags=re.M)
    # Supported by distribution Nginx 1.18+, including Windows-client panel installs.
    # Newer Nginx deprecates this spelling but continues accepting it.
    if not re.search(r'^\s*http2\s+on\s*;',text,re.M):
        def enable(match):
            line=match.group(0)
            return line if re.search(r'\bhttp2\b',line) else line[:-1]+' http2;'
        text=re.sub(r'^[ \t]*listen\s+[^;\n]*\bssl\b[^;\n]*;',enable,text,flags=re.M)
    return text

if __name__=='__main__':
    file=pathlib.Path('/etc/nginx/sites-available/zvpn-panel')
    file.write_text(configure(file.read_text()))
