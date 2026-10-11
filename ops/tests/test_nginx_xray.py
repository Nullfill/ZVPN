import importlib.util,pathlib,unittest

spec=importlib.util.spec_from_file_location('nginx',pathlib.Path(__file__).resolve().parents[1]/'configure-xray-nginx.py')
nginx=importlib.util.module_from_spec(spec);spec.loader.exec_module(nginx)

class NginxXrayTests(unittest.TestCase):
    def test_existing_ssl_certificates_and_panel_routes_are_preserved(self):
        source='server {\n server_name vpn.example.com;\n listen 443 ssl;\n listen [::]:443 ssl ipv6only=on;\n ssl_certificate /etc/letsencrypt/live/vpn.example.com/fullchain.pem;\n location / { proxy_pass http://127.0.0.1:3300; }\n}\n'
        result=nginx.configure(source)
        self.assertIn('listen 443 ssl http2;',result)
        self.assertIn('listen [::]:443 ssl ipv6only=on http2;',result)
        self.assertIn('/etc/letsencrypt/live/vpn.example.com/fullchain.pem;',result)
        self.assertIn('location / { proxy_pass http://127.0.0.1:3300; }',result)
        self.assertEqual(nginx.configure(result),result)

    def test_certbot_tls_block_added_later_gets_http2(self):
        first=nginx.configure('server {\n server_name vpn.example.com;\n listen 80;\n}\n')
        final=nginx.configure(first.replace('listen 80;','listen 443 ssl;'))
        self.assertIn('listen 443 ssl http2;',final)

if __name__=='__main__':unittest.main()
