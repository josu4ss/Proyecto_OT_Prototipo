import 'reflect-metadata';
import { Module, Injectable, Controller, Get, Post, Body, Req, Res, HttpException,
 HttpStatus, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import * as mqtt from 'mqtt';
import * as bcrypt from 'bcryptjs';
import helmet from 'helmet';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { Request, Response } from 'express';

type DbUser = { id: string; email: string; password_hash: string; role: string };
type Session = { user_id: string; email: string; role: string; csrf: string };
const COOKIE='__Host-otlab';
const COMMAND_TOPIC='laboratorio/plc01/comando';
const RESULT_TOPIC='laboratorio/plc01/resultado';
const STATE_TOPIC='laboratorio/plc01/estado';
const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const fail = (status:number,msg:string):never => {throw new HttpException(msg,status)};
const iso=(d:Date)=>d.toISOString();
const isOriginOk=(req:Request)=>{
 const origin=req.headers.origin;
 if (!origin) return true; // CLI clients use session and CSRF token anyway
 return origin==='https://localhost:8443' || origin==='https://127.0.0.1:8443';
};

@Injectable()
class AppService implements OnModuleInit,OnModuleDestroy {
  pool!:Pool;
  mqttClient!: mqtt.MqttClient;
  private failAttempts=new Map<string,{count:number,until:number}>();
  private signingKey=crypto.createPrivateKey(fs.readFileSync('/certs/commands-ed25519.key'));

  async onModuleInit() {
    for(const k of ['DATABASE_URL','ADMIN_EMAIL','ADMIN_PASSWORD','VIEWER_EMAIL','VIEWER_PASSWORD']){
      if(!process.env[k]||process.env[k]==='CAMBIAR_GENERADOR') throw new Error('Falta configuración '+k);
    }
    this.pool=new Pool({connectionString:process.env.DATABASE_URL, max:10});
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users(id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id),
        csrf TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id),
        action TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reason TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS device_state(device_id TEXT PRIMARY KEY,output_on BOOLEAN NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL);
    `);
    for(const [email,password,role] of [
      [process.env.ADMIN_EMAIL!,process.env.ADMIN_PASSWORD!,'operator'],
      [process.env.VIEWER_EMAIL!,process.env.VIEWER_PASSWORD!,'viewer']
    ]) {
      if(password.length<14) throw new Error('Contraseñas iniciales insuficientes');
      const hash=await bcrypt.hash(password,12);
      await this.pool.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING',
        [crypto.randomUUID(),email,hash,role]);
    }
    this.mqttClient=mqtt.connect('mqtts://mosquitto:8883',{
      protocolVersion:5, clientId:'backend', clean:true,
      ca:fs.readFileSync('/certs/ca.crt'),cert:fs.readFileSync('/certs/backend.crt'),
      key:fs.readFileSync('/certs/backend.key'),rejectUnauthorized:true,
      reconnectPeriod:2000,connectTimeout:8000,
    });
    this.mqttClient.on('connect',()=>{
      console.log('MQTT mTLS conectado');
      this.mqttClient.subscribe([STATE_TOPIC,RESULT_TOPIC],{qos:1});
    });
    this.mqttClient.on('message',(topic,payload)=>{void this.ingest(topic,payload).catch(e=>console.error('Evento MQTT inválido:',e.message));});
    this.mqttClient.on('error',e=>console.error('MQTT:',e.message));
  }
  async onModuleDestroy(){ this.mqttClient?.end(true);await this.pool?.end(); }

  async ingest(topic:string,data:Buffer) {
    if(data.length>4096) return;
    const obj=JSON.parse(data.toString());
    if(topic===STATE_TOPIC && obj.deviceId==='PLC-01' && typeof obj.outputOn==='boolean') {
      const d=new Date(obj.timestamp);
      if(!Number.isFinite(d.getTime())||Math.abs(Date.now()-d.getTime())>30000) return;
      await this.pool.query(`INSERT INTO device_state(device_id,output_on,updated_at) VALUES('PLC-01',$1,$2)
         ON CONFLICT(device_id) DO UPDATE SET output_on=EXCLUDED.output_on,updated_at=EXCLUDED.updated_at`,[obj.outputOn,d]);
    }
    if(topic===RESULT_TOPIC && typeof obj.commandId==='string' &&
      ['APPLIED','REJECTED'].includes(obj.status)) {
      await this.pool.query(`UPDATE commands SET status=$1,reason=$2,resolved_at=NOW()
       WHERE id=$3 AND status='PENDING'`,[obj.status,String(obj.reason??'').slice(0,120),obj.commandId]);
    }
  }

  rateCheck(key:string){
    const now=Date.now(),e=this.failAttempts.get(key);
    if(e && e.until>now && e.count>=5) fail(429,'Demasiados intentos. Intenta en 15 minutos.');
  }
  rateFail(key:string){
    const now=Date.now(),e=this.failAttempts.get(key);
    if(!e||e.until<now) this.failAttempts.set(key,{count:1,until:now+15*60000});
    else {e.count++;this.failAttempts.set(key,e)}
  }
  async login(req:Request,res:Response,email:string,password:string){
    this.requireOrigin(req);
    if(typeof email!=='string'||typeof password!=='string'||email.length>200||password.length>500) fail(400,'Credenciales inválidas');
    const ip=req.ip??'unknown';this.rateCheck(ip);
    const rows=await this.pool.query<DbUser>('SELECT * FROM users WHERE email=$1',[email.trim().toLowerCase()]);
    const user=rows.rows[0];
    const valid=await bcrypt.compare(password,user?.password_hash??'$2b$12$qxzO0fxYaAoZ.RNg/pYwm.uA04VasvTrxgKkViE/5zptdq9O.qmB.');
    if(!user||!valid){this.rateFail(ip);fail(401,'Usuario o contraseña incorrectos');}
    this.failAttempts.delete(ip);
    const token=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url');
    await this.pool.query('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL\'8 hours\')',
      [sha(token),user.id,csrf]);
    res.cookie(COOKIE,token,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:8*3600*1000});
    return {email:user.email,role:user.role,csrf};
  }
  private extractToken(req:Request):string | null{
    const c=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
    return c?c.slice(COOKIE.length+1):null;
  }
  async session(req:Request,csrf=false):Promise<Session>{
    const token=this.extractToken(req);
    if (token === null) throw new HttpException('Sesión requerida', 401);
    const r=await this.pool.query<Session>(`SELECT s.user_id,u.email,u.role,s.csrf FROM sessions s
      INNER JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()`,[sha(token)]);
    const ses=r.rows[0];if(!ses) fail(401,'Sesión vencida');
    if(csrf){
      this.requireOrigin(req);
      const supplied=req.header('X-CSRF-Token')??'';
      const a=Buffer.from(supplied),b=Buffer.from(ses.csrf);
      if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) fail(403,'CSRF inválido');
    }
    return ses;
  }
  requireOrigin(req:Request){if(!isOriginOk(req)) fail(403,'Origen no autorizado')}
  async logout(req:Request,res:Response){
    await this.session(req,true);
    const token=this.extractToken(req)!;
    await this.pool.query('DELETE FROM sessions WHERE token_hash=$1',[sha(token)]);
    res.clearCookie(COOKIE,{httpOnly:true,secure:true,sameSite:'strict',path:'/'});
    return {ok:true};
  }
  async state(){
    const row=await this.pool.query('SELECT output_on,updated_at FROM device_state WHERE device_id=$1',['PLC-01']);
    const device=row.rows[0];
    return {deviceId:'PLC-01',outputOn:device?.output_on??false,
      online:!!device&&Date.now()-new Date(device.updated_at).getTime()<12000,
      updatedAt:device?.updated_at??null,mqttConnected:!!this.mqttClient?.connected};
  }
  async commands(req:Request,action:string){
    const ses=await this.session(req,true);
    if(ses.role!=='operator') fail(403,'No tienes permiso para controlar el PLC');
    if(!['ON','OFF'].includes(action)) fail(400,'Acción inválida');
    if(!this.mqttClient?.connected) fail(503,'Broker no conectado');
    const st=await this.state();if(!st.online) fail(503,'PLC desconectado: orden no enviada');
    const commandId=crypto.randomUUID();const now=new Date();
    const payload={commandId,deviceId:'PLC-01',action,
      issuedAt:iso(now),expiresAt:iso(new Date(now.getTime()+15000)),requestedBy:ses.user_id};
    const payloadB64=Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature=crypto.sign(null,Buffer.from(payloadB64,'ascii'),this.signingKey).toString('base64');
    const envelope=JSON.stringify({payloadB64,signature});
    await this.pool.query('INSERT INTO commands(id,user_id,action) VALUES($1,$2,$3)',[commandId,ses.user_id,action]);
    try{
      await new Promise<void>((resolve,reject)=>this.mqttClient.publish(COMMAND_TOPIC,envelope,
        {qos:1,retain:false,properties:{messageExpiryInterval:15}},e=>e?reject(e):resolve()));
    }catch(e){
      await this.pool.query('UPDATE commands SET status=$1,reason=$2 WHERE id=$3',['FAILED','MQTT publish failed',commandId]);
      fail(503,'No se pudo publicar la orden');
    }
    return {commandId,status:'PENDING',note:'Orden enviada al broker; falta confirmación del PLC'};
  }
  async audit(req:Request){
    await this.session(req);
    await this.pool.query("UPDATE commands SET status='TIMED_OUT',reason='Sin confirmación del gateway' WHERE status='PENDING' AND created_at<NOW()-INTERVAL '30 seconds'");
    const r=await this.pool.query(`SELECT c.id,c.action,c.status,c.reason,c.created_at,c.resolved_at,u.email
      FROM commands c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC LIMIT 40`);
    return r.rows;
  }
}

@Controller('api')
class ApiController{
  constructor(private readonly svc:AppService){}
  @Get('health') health(){return {ok:true,service:'otlab-api'};}
  @Post('auth/login') login(@Req() req:Request,@Res({passthrough:true}) res:Response,
    @Body() body:{email:string,password:string}){return this.svc.login(req,res,body?.email,body?.password);}
  @Get('auth/me') async me(@Req() req:Request){
    const s=await this.svc.session(req);return {email:s.email,role:s.role,csrf:s.csrf};
  }
  @Post('auth/logout') logout(@Req() req:Request,@Res({passthrough:true}) res:Response){return this.svc.logout(req,res);}
  @Get('plc/state') async state(@Req() req:Request){await this.svc.session(req);return this.svc.state();}
  @Post('plc/command') async control(@Req() req:Request,@Body() body:{action:string}){
    return this.svc.commands(req,body?.action);
  }
  @Get('audit') audit(@Req() req:Request){return this.svc.audit(req);}
}
@Module({controllers:[ApiController],providers:[AppService]}) class AppModule{}
async function bootstrap(){
  const app=await NestFactory.create(AppModule,{bodyParser:true});
  app.use(helmet());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT??3000),'0.0.0.0');
  console.log('API OT lista');
}
void bootstrap();
