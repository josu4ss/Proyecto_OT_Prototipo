"""Puente OPC UA seguro <-> MQTT mTLS. Verifica firmas, tiempos y duplicados."""
import asyncio
import base64
from datetime import datetime,timezone
import json
import logging
import os
import sqlite3
import ssl
import time
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from asyncua import Client, ua
from verify import parse_verified
from asyncua.crypto import uacrypto
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256
from asyncua.crypto.truststore import TrustStore
from asyncua.crypto.validator import CertificateValidator, CertificateValidatorOptions
import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s GATEWAY %(message)s')
COMMAND='laboratorio/plc01/comando'
STATE='laboratorio/plc01/estado'
RESULT='laboratorio/plc01/resultado'
DB='/data/replay.sqlite'
MAX_COMMAND_BYTES=4096

conn=sqlite3.connect(DB)
conn.execute('CREATE TABLE IF NOT EXISTS executed(id TEXT PRIMARY KEY, processed_at TEXT NOT NULL)')
conn.commit()
public_key=serialization.load_pem_public_key(Path('/certs/commands-ed25519.pub').read_bytes())



def mqtt_client(queue,loop):
    c=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='gateway-plc01',protocol=mqtt.MQTTv5)
    ctx=ssl.create_default_context(cafile='/certs/ca.crt')
    ctx.minimum_version=ssl.TLSVersion.TLSv1_3
    ctx.load_cert_chain('/certs/gateway.crt','/certs/gateway.key')
    c.tls_set_context(ctx)
    def connected(client,userdata,flags,reason,properties):
        if reason==0:
            logging.info('MQTT conectado por mTLS');client.subscribe(COMMAND,qos=1)
        else: logging.error('MQTT conexión rechazada: %s',reason)
    def received(client,userdata,msg):
        loop.call_soon_threadsafe(queue.put_nowait,bytes(msg.payload))
    c.on_connect=connected
    c.on_message=received
    c.reconnect_delay_set(min_delay=1,max_delay=10)
    c.connect_async('mosquitto',8883,keepalive=30)
    c.loop_start()
    return c


def publish(client,topic,obj):
    data=json.dumps(obj,separators=(',',':')).encode()
    client.publish(topic,data,qos=1,retain=False)

async def run_gateway(client,queue):
    opc=Client('opc.tcp://plc:4840/otlab/server/',timeout=10)
    opc.application_uri='urn:otlab:gateway:client'
    trust=TrustStore([Path('/certs/trusted-servers')],[])
    await trust.load()
    opc.certificate_validator=CertificateValidator(
        CertificateValidatorOptions.TRUSTED_VALIDATION | CertificateValidatorOptions.PEER_SERVER,
        trust_store=trust)
    await opc.set_security(SecurityPolicyBasic256Sha256,
       certificate=uacrypto.CertProperties('/certs/gateway-opcua.crt', extension='PEM'),
       private_key=uacrypto.CertProperties('/certs/gateway-opcua.key', extension='PEM'),
       server_certificate=uacrypto.CertProperties('/certs/plc.crt', extension='PEM'),
       mode=ua.MessageSecurityMode.SignAndEncrypt)
    opc.set_user('otgateway')
    opc.set_password(os.environ['OPCUA_PASSWORD'])
    async with opc:
        ns=await opc.get_namespace_index('urn:otlab:plc01')
        output=opc.get_node(ua.NodeId('ActuatorOn',ns))
        logging.info('OPC UA SignAndEncrypt conectado; nodo ns=%s;s=ActuatorOn',ns)
        while True:
            try:
                raw=await asyncio.wait_for(queue.get(),timeout=2)
                command_id=None
                try:
                    o=parse_verified(raw,public_key,conn)
                    command_id=o['commandId']
                    await output.write_value(o['action']=='ON')
                    actual=bool(await output.read_value())
                    conn.execute('INSERT INTO executed(id,processed_at) VALUES (?,?)',(command_id,datetime.now(timezone.utc).isoformat()))
                    conn.commit()
                    publish(client,RESULT,{'commandId':command_id,'status':'APPLIED','outputOn':actual,'timestamp':datetime.now(timezone.utc).isoformat()})
                    logging.info('Comando autorizado %s -> %s',command_id,actual)
                except Exception as exc:
                    logging.warning('Comando rechazado: %s',exc)
                    # No enviar ID no verificado: evita atribución falsa de una orden manipulada.
                    publish(client,RESULT,{'commandId':command_id,'status':'REJECTED',
                       'reason':str(exc)[:100],'timestamp':datetime.now(timezone.utc).isoformat()})
            except asyncio.TimeoutError:
                pass
            state=bool(await output.read_value())
            publish(client,STATE,{'deviceId':'PLC-01','outputOn':state,'timestamp':datetime.now(timezone.utc).isoformat()})

async def main():
    loop=asyncio.get_running_loop()
    queue=asyncio.Queue(maxsize=100)
    client=mqtt_client(queue,loop)
    try:
        while True:
            try: await run_gateway(client,queue)
            except Exception as exc:
                logging.error('OPC UA desconectado/error: %s; reconexión en 3s',exc)
                await asyncio.sleep(3)
    finally: client.loop_stop()

if __name__=='__main__':
    asyncio.run(main())
