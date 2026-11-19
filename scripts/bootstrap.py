"""Provisiona certificados y contraseñas locales. NO subir certs ni .env a git."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
import secrets, os
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, ed25519
from cryptography.hazmat.backends import default_backend

ROOT = Path(__file__).resolve().parents[1]
CERTS = ROOT / 'certs'
CERTS.mkdir(exist_ok=True)
if (CERTS / 'ca.key').exists():
    raise SystemExit('Certificados ya existentes: no se sobrescribirán; para regenerar siga la guía de rotación.')

def pem_private(key):
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())

def write_secret(name, data):
    p = CERTS / name
    p.write_bytes(data)
    # Cada servicio recibe solo su clave. UID 10001 para API/OT; Mosquitto usa 1883.
    uid = 1883 if name == 'mosquitto.key' else (10001 if name in ('backend.key', 'gateway.key', 'gateway-opcua.key', 'plc.key', 'commands-ed25519.key') else None)
    if uid is not None:
        try: os.chown(p, uid, -1)
        except PermissionError: print(f'ADVERTENCIA: no se pudo asignar UID al archivo {name}')
    os.chmod(p, 0o600)

def make_rsa():
    return rsa.generate_private_key(public_exponent=65537, key_size=3072)

now = datetime.now(timezone.utc)
ca_key = make_rsa()
ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'OT Lab CA (solo pruebas)')])
ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
      .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
      .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=365))
      .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
      .add_extension(x509.KeyUsage(digital_signature=True, key_encipherment=False, content_commitment=False,
                                   data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                   crl_sign=True, encipher_only=False, decipher_only=False),critical=True)
      .sign(ca_key, hashes.SHA256()))
write_secret('ca.key', pem_private(ca_key))
(CERTS / 'ca.crt').write_bytes(ca.public_bytes(serialization.Encoding.PEM))

def cert(name, cn, dns, server=False, client=False):
    key = make_rsa()
    subject=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    usages = ([ExtendedKeyUsageOID.SERVER_AUTH] if server else []) + ([ExtendedKeyUsageOID.CLIENT_AUTH] if client else [])
    alt=[x509.DNSName(d) for d in dns]
    if name == 'plc': alt.append(x509.UniformResourceIdentifier('urn:otlab:plc:server'))
    if name == 'gateway-opcua': alt.append(x509.UniformResourceIdentifier('urn:otlab:gateway:client'))
    if name == 'web':
        import ipaddress
        alt.append(x509.IPAddress(ipaddress.ip_address('127.0.0.1')))
    opcua = name in ('plc', 'gateway-opcua')
    c=(x509.CertificateBuilder().subject_name(subject).issuer_name(ca_name)
       .public_key(key.public_key()).serial_number(x509.random_serial_number())
       .not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=120))
       .add_extension(x509.SubjectAlternativeName(alt),critical=False)
       .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True)
       .add_extension(x509.KeyUsage(digital_signature=True,key_encipherment=True,content_commitment=opcua,
         data_encipherment=opcua,key_agreement=False,key_cert_sign=False,crl_sign=False,
         encipher_only=False,decipher_only=False),critical=True)
       .add_extension(x509.ExtendedKeyUsage(usages),critical=False)
       .sign(ca_key,hashes.SHA256()))
    write_secret(f'{name}.key',pem_private(key))
    (CERTS/f'{name}.crt').write_bytes(c.public_bytes(serialization.Encoding.PEM))

cert('mosquitto','mosquitto',['mosquitto'],server=True)
cert('backend','backend',['backend'],client=True)
cert('gateway','gateway-plc01',['gateway'],client=True)
cert('plc','plc-opcua',['plc'],server=True)
cert('gateway-opcua','gateway-opcua',['gateway'],client=True)
cert('web','localhost',['localhost'],server=True)

# Lista de certificados OPC UA de confianza. Solo se copian certificados públicos.
for folder,source in [('trusted-clients','gateway-opcua.crt'),('trusted-servers','plc.crt')]:
    dest=CERTS/folder
    dest.mkdir(exist_ok=True)
    obj=x509.load_pem_x509_certificate((CERTS/source).read_bytes())
    (dest/'peer.pem').write_bytes(obj.public_bytes(serialization.Encoding.PEM))
    (dest/'ca.pem').write_bytes((CERTS/'ca.crt').read_bytes())

signer = ed25519.Ed25519PrivateKey.generate()
write_secret('commands-ed25519.key',pem_private(signer))
(CERTS/'commands-ed25519.pub').write_bytes(signer.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo))

env=ROOT/'.env'
if not env.exists():
    env.write_text((ROOT/'.env.example').read_text(encoding='utf-8'),encoding='utf-8')
rows=[]
for line in env.read_text(encoding='utf-8').splitlines():
    if '=CAMBIAR_GENERADOR' in line:
        k,_=line.split('=',1)
        line=f'{k}={secrets.token_urlsafe(24)}'
    rows.append(line)
env.write_text('\n'.join(rows)+'\n',encoding='utf-8')
os.chmod(env,0o600)
print('Inicialización completa. Certificados generados y secretos colocados en .env')
print('Credenciales de laboratorio: consultar .env (no compartir).')
