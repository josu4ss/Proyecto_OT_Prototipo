# Registro de validación del prototipo

Fecha: 17 de noviembre de 2026.

## Comprobaciones completadas en el entorno de preparación

- Se interpretó correctamente `compose.yaml` como YAML y se verificó la presencia de servicios y redes.
- Se compilaron a bytecode, sin errores de sintaxis, los archivos Python del gateway, PLC, certificados y pruebas.
- Se ejecutó el generador local de CA, certificados para Mosquitto/backend/gateway/PLC/Nginx y clave Ed25519; finalizó correctamente.
- Los certificados Mosquitto, gateway y PLC se validaron contra la CA mediante `openssl verify`.
- Se revisó la extensión SAN del certificado Mosquitto (DNS) y PLC (DNS + URI OPC UA).
- Se validó la firma y verificación de un mensaje Ed25519.
- **5 pruebas unitarias del gateway: 5/5 aprobadas**: firma válida, firma alterada, comando expirado, comando no permitido y replay.
- Se realizó transpilación sintáctica de los archivos TypeScript (API NestJS) y JSX (interfaz React) sin errores de sintaxis.

## Limitaciones de la validación

No existe Docker en el entorno donde se preparó este repositorio, y no hay acceso desde él al registro npm/pip. Por ello **no se ha ejecutado el conjunto completo de contenedores**, no se ha probado un login HTTP real ni una escritura OPC UA de extremo a extremo. Tampoco se ha verificado aún la configuración opcional de FUXA, que no está autoenlazada.

Estas pruebas **deben repetirse en la computadora del usuario** después de `docker compose up -d --build`. Los pasos y comandos están en `README.md`. No se afirma que el prototipo tenga acreditación de seguridad industrial ni que esté listo para instalación en una red militar.

## Aspectos que verificar en Docker

1. Que Mosquitto lea correctamente su clave privada con permisos restrictivos.
2. Que el PLC OPC UA acepte la identidad `otgateway` bajo `SignAndEncrypt` y certificado confiable.
3. Que el gateway se suscriba a `laboratorio/plc01/comando` y publique `estado` y `resultado`.
4. Que el backend reciba telemetría y que la web marque el dispositivo como disponible.
5. Que las órdenes ON/OFF generen registros `APPLIED` y el indicador cambie.
6. Que la cuenta viewer reciba 403 en POST, y un cliente MQTT no autorizado sea rechazado.
7. Que TLS 1.3 realmente se negocie en el broker y que el tráfico capturado no exponga los mensajes.
