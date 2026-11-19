"""Pruebas de mTLS del broker; ejecución: docker compose --profile test run --rm tester."""
import os,ssl,socket,sys

def check_cert():
    ctx=ssl.create_default_context(cafile='/certs/ca.crt')
    ctx.minimum_version=ssl.TLSVersion.TLSv1_3
    ctx.load_cert_chain('/certs/backend.crt','/certs/backend.key')
    with socket.create_connection(('mosquitto',8883),timeout=5) as raw:
        with ctx.wrap_socket(raw,server_hostname='mosquitto') as client:
            assert client.version()=='TLSv1.3'
            print('PASS: TLSv1.3 con certificado de cliente; cifrado=',client.cipher()[0])

def check_missing_cert():
    ctx=ssl.create_default_context(cafile='/certs/ca.crt')
    ctx.minimum_version=ssl.TLSVersion.TLSv1_3
    try:
        with socket.create_connection(('mosquitto',8883),timeout=5) as raw:
            with ctx.wrap_socket(raw,server_hostname='mosquitto') as client:
                # TLS 1.3 puede reportar el rechazo en el primer paquete de datos
                client.sendall(b'\x10\x00')
                response=client.recv(5)
                if response: raise AssertionError('Cliente sin certificado recibió datos MQTT')
    except (ssl.SSLError,ConnectionResetError,BrokenPipeError,EOFError):
        print('PASS: cliente sin certificado rechazado')
        return
    raise AssertionError('No se confirmó rechazo sin certificado')

if __name__=='__main__':
    check_cert();check_missing_cert()
