"""Validación independiente del protocolo de transporte; reutilizable en pruebas."""
import base64
from datetime import datetime, timezone, timedelta
import json
from cryptography.exceptions import InvalidSignature

MAX_COMMAND_BYTES=4096

def parse_verified(raw, public_key, conn, now=None):
    if len(raw)>MAX_COMMAND_BYTES: raise ValueError('Payload demasiado grande')
    envelope=json.loads(raw)
    b64=envelope['payloadB64']
    signature=base64.b64decode(envelope['signature'],validate=True)
    if not isinstance(b64,str) or len(b64)>2000: raise ValueError('Payload inválido')
    try:
        public_key.verify(signature,b64.encode('ascii'))
    except InvalidSignature as exc: raise ValueError('Firma Ed25519 inválida') from exc
    obj=json.loads(base64.b64decode(b64,validate=True))
    if set(obj)!={'commandId','deviceId','action','issuedAt','expiresAt','requestedBy'}:
        raise ValueError('Estructura inesperada')
    if obj['deviceId']!='PLC-01' or obj['action'] not in ('ON','OFF'): raise ValueError('Acción/dispositivo no permitido')
    if not isinstance(obj['commandId'],str) or len(obj['commandId'])>64: raise ValueError('ID inválido')
    if not isinstance(obj['requestedBy'],str) or len(obj['requestedBy'])>100: raise ValueError('Usuario inválido')
    now=now or datetime.now(timezone.utc)
    issued=datetime.fromisoformat(obj['issuedAt'].replace('Z','+00:00'))
    expires=datetime.fromisoformat(obj['expiresAt'].replace('Z','+00:00'))
    if not (now-timedelta(seconds=20) <= issued <= now+timedelta(seconds=5)):
        raise ValueError('Marca de tiempo inválida')
    if not (now <= expires <= issued+timedelta(seconds=20)):
        raise ValueError('Comando vencido o TTL inválido')
    if conn.execute('SELECT 1 FROM executed WHERE id=?',(obj['commandId'],)).fetchone():
        raise ValueError('Comando repetido')
    return obj
