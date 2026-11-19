"""Ejercita el MISMO verificador de la pasarela: firma, vencimiento y replay."""
import base64, json, sqlite3, sys, unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from cryptography.hazmat.primitives import serialization
sys.path.insert(0, '/app' if Path('/app/verify.py').exists() else str(Path(__file__).resolve().parents[1]/'ot'))
from verify import parse_verified

ROOT=Path('/certs' if Path('/certs/commands-ed25519.key').exists() else Path(__file__).parents[1]/'certs')
private=serialization.load_pem_private_key((ROOT/'commands-ed25519.key').read_bytes(),password=None)
public=serialization.load_pem_public_key((ROOT/'commands-ed25519.pub').read_bytes())

def wire(payload):
    b64=base64.b64encode(json.dumps(payload,separators=(',',':')).encode()).decode('ascii')
    return json.dumps({'payloadB64':b64,'signature':base64.b64encode(private.sign(b64.encode('ascii'))).decode('ascii')}).encode()

def payload(**changes):
    now=datetime.now(timezone.utc)
    o={'commandId':'e5e9b7b4-6041-428c-8504-dfd2e4a1bffc','deviceId':'PLC-01','action':'ON',
       'issuedAt':now.isoformat(),'expiresAt':(now+timedelta(seconds=10)).isoformat(),
       'requestedBy':'lab-user'}
    o.update(changes)
    return o

class GatewaySecurity(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE executed(id TEXT PRIMARY KEY, processed_at TEXT NOT NULL)')
    def test_firma_valida(self):
        self.assertEqual(parse_verified(wire(payload()),public,self.db)['action'],'ON')
    def test_firma_alterada(self):
        obj=json.loads(wire(payload()))
        obj['payloadB64']=base64.b64encode(b'{"injected":true}').decode()
        with self.assertRaisesRegex(ValueError,'Firma'): parse_verified(json.dumps(obj).encode(),public,self.db)
    def test_vencimiento(self):
        with self.assertRaisesRegex(ValueError,'tiempo|vencido'):
            parse_verified(wire(payload(expiresAt=(datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat())),public,self.db)
    def test_accion_no_permitida(self):
        with self.assertRaisesRegex(ValueError,'Acción'):
            parse_verified(wire(payload(action='REBOOT')),public,self.db)
    def test_replay(self):
        raw=wire(payload())
        verified=parse_verified(raw,public,self.db)
        self.db.execute('INSERT INTO executed VALUES (?,?)',(verified['commandId'],'now'))
        with self.assertRaisesRegex(ValueError,'repetido'):parse_verified(raw,public,self.db)

if __name__=='__main__':unittest.main(verbosity=2)
