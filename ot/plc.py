"""PLC didáctico OPC UA: expone solamente una salida booleana, no controla maquinaria real."""
import asyncio
import hmac
import logging
import os
from pathlib import Path
from asyncua.crypto.truststore import TrustStore
from asyncua.crypto.validator import CertificateValidator, CertificateValidatorOptions
from asyncua import Server, ua
from asyncua.server.user_managers import UserManager
from asyncua.crypto.permission_rules import User, UserRole

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s PLC %(message)s')

class LabUserManager(UserManager):
    def get_user(self, iserver, username=None, password=None, certificate=None):
        expected=os.environ['OPCUA_PASSWORD']
        if username == 'otgateway' and isinstance(password,str) and hmac.compare_digest(password,expected):
            return User(role=UserRole.Admin,name='otgateway')
        return None

async def main():
    server=Server(user_manager=LabUserManager())
    await server.init()
    server.set_server_name('PLC de laboratorio - OT Secure Bridge')
    server.set_endpoint('opc.tcp://plc:4840/otlab/server/')
    await server.set_application_uri('urn:otlab:plc:server')
    server.set_security_policy([ua.SecurityPolicyType.Basic256Sha256_SignAndEncrypt])
    server.set_security_IDs(['Username'])
    await server.load_certificate('/certs/plc.crt', format='PEM')
    await server.load_private_key('/certs/plc.key', format='PEM')
    trusted=TrustStore([Path('/certs/trusted-clients')],[])
    await trusted.load()
    server.set_certificate_validator(CertificateValidator(
        CertificateValidatorOptions.TRUSTED_VALIDATION | CertificateValidatorOptions.PEER_CLIENT,
        trust_store=trusted))
    ns=await server.register_namespace('urn:otlab:plc01')
    equipment=await server.nodes.objects.add_object(ns,'PLC01')
    actuator=await equipment.add_variable(ua.NodeId('ActuatorOn',ns),'ActuatorOn',False)
    await actuator.set_writable()
    logging.info('PLC OPC UA cifrado en puerto 4840; salida inicia APAGADA')
    async with server:
        while True:
            await asyncio.sleep(10)
            logging.info('Salida laboratorio: %s',await actuator.read_value())

if __name__=='__main__':
    asyncio.run(main())
