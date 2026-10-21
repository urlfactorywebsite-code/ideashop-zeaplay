"""Owned full-stack TLS/browser checks; never changes host DNS, business data or live containers."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def docker(*args, input=None):
    result = subprocess.run(['docker', *args], input=input, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-image', required=True)
    parser.add_argument('--frontend-image', required=True)
    parser.add_argument('--presence-image', default='ideashop-zeaplay-v5-presence')
    parser.add_argument('--playwright-module', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    run = 'zea-domain-check-' + uuid4().hex[:12]
    containers = []
    with tempfile.TemporaryDirectory(prefix=run) as scratch:
        path = Path(scratch)
        try:
            docker('network', 'create', run)
            subnet = json.loads(docker('network', 'inspect', run))[0]['IPAM']['Config'][0]['Subnet']
            certificates = '''from datetime import datetime,timedelta,timezone
from pathlib import Path
import base64, hashlib
from cryptography import x509
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
p=Path('/checks'); now=datetime.now(timezone.utc)
ca_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
ca_name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Owned domain check CA')])
ca=x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()),critical=False).add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),critical=False).add_extension(x509.KeyUsage(digital_signature=True,key_encipherment=False,content_commitment=False,data_encipherment=False,key_agreement=False,key_cert_sign=True,crl_sign=True,encipher_only=False,decipher_only=False),critical=True).sign(ca_key,hashes.SHA256())
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
cert=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'ideashop.zeacrm.com')])).issuer_name(ca_name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('ideashop.zeacrm.com'),x509.DNSName('api.ideashop.zeacrm.com')]),critical=False).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()),critical=False).add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),critical=False).add_extension(x509.KeyUsage(digital_signature=True,key_encipherment=True,content_commitment=False,data_encipherment=False,key_agreement=False,key_cert_sign=False,crl_sign=False,encipher_only=False,decipher_only=False),critical=True).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False).sign(ca_key,hashes.SHA256())
(p/'ca.pem').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
(p/'server.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
(p/'server.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
print(base64.b64encode(hashlib.sha256(key.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).digest()).decode())
'''
            spki = docker('run', '--rm', '--network', 'none', '--mount', f'type=bind,source={path},target=/checks',
                          '--entrypoint', 'python', args.backend_image, '-c', certificates)
            for part, image, extra in [
                ('postgres', 'postgres:15-alpine', ['-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=zeaplay_rt3_test']),
                ('redis', 'redis:7-alpine', []),
            ]:
                name = run + '-' + part
                containers.append(name)
                docker('run', '-d', '--name', name, '--network', run, '--network-alias', part, *extra, image)
            for _ in range(100):
                ready = subprocess.run(['docker', 'exec', run + '-postgres', 'pg_isready', '-U', 'postgres'], capture_output=True)
                if ready.returncode == 0: break
                time.sleep(0.2)
            init = path / 'init.py'
            init.write_text('''from uuid import uuid4
from sqlalchemy import text
from app.main import app
from app.database import Base,engine,SessionLocal
from app.auth import hash_password
from app.models import User,RoleEnum,UserStatusEnum
with engine.begin() as c: c.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm'))
Base.metadata.create_all(engine)
with SessionLocal() as db:
    db.add(User(id=str(uuid4()),tenant_id=uuid4(),name='Domain test owner',email='live-domains@example.com',hashed_password=hash_password('Synthetic-domain-password!'),role=RoleEnum.OWNER,status=UserStatusEnum.ACTIVE))
    db.commit()
''', encoding='utf-8')
            env = {
                'VEE_ENVIRONMENT': 'production', 'VEE_BOOTSTRAP_SCHEMA': 'false',
                'VEE_DATABASE_URL': 'postgresql+psycopg://postgres@postgres/zeaplay_rt3_test',
                'VEE_REDIS_URL': 'redis://redis:6379/0', 'VEE_CACHE_REDIS_URL': 'redis://redis:6379/1',
                'VEE_JWT_SECRET_KEY': 'synthetic-domain-access-key-00000000000000',
                'VEE_JWT_REFRESH_SECRET_KEY': 'synthetic-domain-refresh-key-0000000000000',
                'VEE_CORS_ALLOW_ORIGINS': json.dumps(['https://ideashop.zeacrm.com','https://api.ideashop.zeacrm.com']),
                'VEE_WEBSOCKET_TRUSTED_ORIGINS': json.dumps(['https://ideashop.zeacrm.com']),
                'VEE_WEBSOCKET_REQUIRE_ORIGIN': 'true', 'VEE_WEBSOCKET_REQUIRE_TICKET': 'true',
                'VEE_BROWSER_SESSION_HTTP_ORIGINS': '[]', 'VEE_BCRYPT_ROUNDS': '4',
                'VEE_OAUTH_ISSUER': 'https://api.ideashop.zeacrm.com/api/oauth2',
                'VEE_OAUTH_UI_URL': 'https://ideashop.zeacrm.com/#/oauth/authorize',
                'VEE_PASSWORD_RESET_URL': 'https://ideashop.zeacrm.com/#/reset-password',
                'VEE_SMTP_DELIVERY_ENABLED': 'false', 'VEE_ENABLE_N8N_FORWARDING': 'false',
                'FORWARDED_ALLOW_IPS': subnet, 'VEE_MEDIA_ROOT': '/tmp/test-media',
            }
            backend = run + '-backend'
            containers.append(backend)
            command = ['run','-d','--name',backend,'--network',run,'--network-alias','backend',
                       '--mount',f'type=bind,source={init},target=/tmp/init.py,readonly']
            for key,value in env.items(): command += ['-e',key+'='+value]
            docker(*command,args.backend_image,'sh','-c','PYTHONPATH=/app python /tmp/init.py && exec uvicorn app.main:app --host 0.0.0.0 --port 6311')
            presence = run + '-presence'
            containers.append(presence)
            docker('run','-d','--name',presence,'--network',run,'--network-alias','presence',
                   '-e','NODE_ENV=production','-e','PRESENCE_PORT=6312','-e','PRESENCE_REDIS_URL=redis://redis:6379/2',
                   '-e','PRESENCE_JWT_SECRET='+env['VEE_JWT_SECRET_KEY'],
                   '-e','PRESENCE_CORS_ORIGINS=https://ideashop.zeacrm.com,https://api.ideashop.zeacrm.com',
                   '-e','PRESENCE_REQUIRE_ORIGIN=true','-e','PRESENCE_ALLOW_LOCALHOST_ORIGINS=false',args.presence_image)
            edge = run + '-edge'
            edge_conf = path / 'edge.conf'
            edge_conf.write_text('''map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server { listen 443 ssl; server_name ideashop.zeacrm.com api.ideashop.zeacrm.com;
ssl_certificate /checks/server.pem; ssl_certificate_key /checks/server.key; access_log off;
location / { proxy_pass http://gateway:80; proxy_http_version 1.1; proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto https; proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade; proxy_buffering off; } }
''', encoding='utf-8')
            # Reserve a concrete private edge IP, independent of container start timing.
            import ipaddress
            edge_ip = str(ipaddress.ip_network(subnet).network_address + 100)
            gateway = run + '-gateway'
            containers.append(gateway)
            docker('run','-d','--name',gateway,'--network',run,'--network-alias','gateway',
                   '-e','NGINX_TRUSTED_PROXY_CIDRS='+edge_ip+'/32',
                   '-e','API_URL=https://api.ideashop.zeacrm.com/api',
                   '-e','PRESENCE_URL=https://api.ideashop.zeacrm.com',
                   '-e','WS_URL=wss://api.ideashop.zeacrm.com/api',
                   '-e','TICKET_CHAT_WS_URL=wss://api.ideashop.zeacrm.com/api',args.frontend_image)
            containers.append(edge)
            docker('run','-d','--name',edge,'--network',run,'--network-alias','edge','--ip',edge_ip,
                   '--mount',f'type=bind,source={path},target=/checks,readonly',
                   '--mount',f'type=bind,source={edge_conf},target=/etc/nginx/conf.d/default.conf,readonly','nginx:alpine')
            proxy_script = path / 'connect.py'
            proxy_script.write_text('''from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import select,socket
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_CONNECT(self):
        if self.path not in {'ideashop.zeacrm.com:443','api.ideashop.zeacrm.com:443'}:
            self.send_error(403); return
        upstream=socket.create_connection(('edge',443),timeout=10)
        self.send_response(200); self.end_headers()
        try:
            while True:
                readable,_,_=select.select([self.connection,upstream],[],[],30)
                if not readable: break
                for source in readable:
                    data=source.recv(65536)
                    if not data: return
                    (upstream if source is self.connection else self.connection).sendall(data)
        finally: upstream.close()
ThreadingHTTPServer(('0.0.0.0',8899),Handler).serve_forever()
''', encoding='utf-8')
            proxy_name=run+'-proxy'; containers.append(proxy_name)
            docker('run','-d','--name',proxy_name,'--network',run,'-p','127.0.0.1::8899',
                   '--mount',f'type=bind,source={proxy_script},target=/tmp/connect.py,readonly',
                   '--entrypoint','python',args.backend_image,'/tmp/connect.py')
            mapping=json.loads(docker('inspect',proxy_name))[0]['NetworkSettings']['Ports']['8899/tcp'][0]
            proxy='http://127.0.0.1:'+mapping['HostPort']
            child_env={**os.environ,'NO_PROXY':'unmatchable.invalid','no_proxy':'unmatchable.invalid'}
            for _ in range(90):
                ready=subprocess.run(['docker','exec',backend,'python','-c',
                    'from urllib.request import urlopen; assert urlopen("http://127.0.0.1:6311/health").status==200'],capture_output=True)
                if ready.returncode==0: break
                time.sleep(0.3)
            checked=subprocess.run([os.sys.executable,str(ROOT/'ops/verify-live-domains.py'),'--ca-file',str(path/'ca.pem'),'--proxy',proxy,
                '--output',str(args.output/'tls-api.json')],env=child_env,capture_output=True,text=True)
            (args.output/'tls-api.txt').write_text(checked.stdout+checked.stderr,encoding='utf-8')
            if checked.returncode: raise RuntimeError('TLS API verification failed; see tls-api.json')
            browser_env={**os.environ,'ZEAPLAY_PLAYWRIGHT_MODULE':args.playwright_module,
                'ZEAPLAY_DOMAIN_TEST_PROXY':proxy,'ZEAPLAY_DOMAIN_TEST_SPKI':spki,
                'ZEAPLAY_DOMAIN_BROWSER_OUTPUT':str((args.output/'browser.json').resolve())}
            checked=subprocess.run(['node',str(ROOT/'ops/testing/live_domain_browser.mjs')],env=browser_env,capture_output=True,text=True,timeout=100)
            (args.output/'browser.txt').write_text(checked.stdout+checked.stderr,encoding='utf-8')
            if checked.returncode: raise RuntimeError('Browser verification failed; see browser.txt')
            print(json.dumps({'tls_api':'PASS','browser':'PASS','isolated_postgresql_major':15}))
        except Exception:
            for name in containers:
                logs=subprocess.run(['docker','logs',name],capture_output=True,text=True)
                (args.output/(name.rsplit('-',1)[-1]+'.failure.log')).write_text(logs.stdout+logs.stderr,encoding='utf-8')
            raise
        finally:
            for name in reversed(containers): subprocess.run(['docker','rm','-f','-v',name],capture_output=True)
            subprocess.run(['docker','network','rm',run],capture_output=True)


if __name__ == '__main__': main()
