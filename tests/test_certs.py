"""Comprueba la generación local de certificados (sin conexión externa)."""
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
root=Path(__file__).parents[1]
certs=root/'certs'
assert all((certs/f).exists() for f in ['ca.crt','web.crt','backend.crt','gateway.crt','mosquitto.crt','plc.crt','commands-ed25519.pub'])
assert 'mosquitto' in x509.load_pem_x509_certificate((certs/'mosquitto.crt').read_bytes()).subject.rfc4514_string()
private=serialization.load_pem_private_key((certs/'commands-ed25519.key').read_bytes(),password=None)
public=serialization.load_pem_public_key((certs/'commands-ed25519.pub').read_bytes())
sig=private.sign(b'prueba')
public.verify(sig,b'prueba')
print('PASS: certificados y par de claves Ed25519 válidos')
