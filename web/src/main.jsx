import React,{useState,useEffect,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

async function call(path,options={}){
  const r=await fetch('/api/'+path,{credentials:'include',cache:'no-store',...options,
    headers:{'Content-Type':'application/json',...(options.headers||{})}});
  let data={};try{data=await r.json()}catch{}
  if(!r.ok)throw new Error(data.message||`Error HTTP ${r.status}`);
  return data;
}
const fmt=(date)=>date?new Date(date).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'medium'}):'Sin registros';
function Icon({name,size=20}){
  const paths={shield:<><path d="m12 2 8 4v6c0 5-3.5 8.2-8 10-4.5-1.8-8-5-8-10V6l8-4Z"/><path d="m9 12 2 2 4-4"/></>,
  power:<><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></>,
  cpu:<><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/></>,
  lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  activity:<><path d="M2 12h4l3-8 6 16 3-8h4"/></>,
  log:<><path d="M3 4h18v16H3zM7 9h10M7 13h10M7 17h6"/></>,
  arrow:<><path d="M5 12h14m-6-6 6 6-6 6"/></>,
  logout:<><path d="M10 17l5-5-5-5m5 5H3m9-9h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></>};
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
function App(){
 const[user,setUser]=useState(null),[loading,setLoading]=useState(true),[email,setEmail]=useState('operador@laboratorio.local'),[password,setPassword]=useState(''),
 [error,setError]=useState(''),[busy,setBusy]=useState(false),[state,setState]=useState(null),[audit,setAudit]=useState([]),
 [tab,setTab]=useState('control'),[notice,setNotice]=useState(''),[clock,setClock]=useState(new Date());
 const reload=useCallback(async()=>{
    if(!user)return;
    try{const[s,a]=await Promise.all([call('plc/state'),call('audit')]);setState(s);setAudit(a)}catch(e){if(e.message.includes('Sesión'))setUser(null)}
 },[user]);
 useEffect(()=>{call('auth/me').then(u=>setUser(u)).catch(()=>{}).finally(()=>setLoading(false))},[]);
 useEffect(()=>{if(!user)return;reload();const id=setInterval(reload,2500);const c=setInterval(()=>setClock(new Date()),1000);
   return()=>{clearInterval(id);clearInterval(c)}},[user,reload]);
 const login=async(e)=>{e.preventDefault();setError('');setBusy(true);try{const u=await call('auth/login',{method:'POST',body:JSON.stringify({email,password})});setUser(u);setPassword('')}catch(e){setError(e.message)}finally{setBusy(false)}};
 const logout=async()=>{try{await call('auth/logout',{method:'POST',headers:{'X-CSRF-Token':user.csrf},body:'{}'})}catch{}setUser(null);setState(null)};
 const command=async(action)=>{
  if(!state?.online||!state.mqttConnected||busy||user?.role!=='operator')return;
  const verb=action==='ON'?'encender':'apagar';
  if(!confirm(`¿Deseas ${verb} la salida virtual del PLC-01?`))return;
  setBusy(true);setNotice('');
  try{const resp=await call('plc/command',{method:'POST',headers:{'X-CSRF-Token':user.csrf},body:JSON.stringify({action})});
   setNotice(`Orden ${resp.commandId.slice(0,8)} publicada. Pendiente de confirmación del PLC.`);await reload()
  }catch(e){setNotice('Error: '+e.message)}finally{setBusy(false)}
 };
 if(loading)return <div className="center"><div className="spinner"/> Preparando sesión segura...</div>;
 if(!user)return <div className="auth-layout"><div className="auth-info"><div className="brand"><div className="brand-icon"><Icon name="shield" size={26}/></div><span>OT<span className="accent">BRIDGE</span></span></div>
  <div className="auth-hero"><span className="eyebrow">LABORATORIO IT / OT</span><h1>Control industrial,<br/><em>acceso verificado.</em></h1><p>Prototipo de comunicación cifrada entre un sistema web y un PLC a través de MQTT con autenticación mutua.</p>
  <div className="auth-steps"><span>01 · Autenticación web</span><span>02 · MQTT + TLS 1.3</span><span>03 · OPC UA seguro</span></div></div>
  <div className="auth-foot">ENTORNO DE PRUEBAS · NO APTO PARA OPERACIÓN REAL</div></div>
  <div className="auth-form-side"><form className="auth-form" onSubmit={login}><div className="form-mark"><Icon name="lock" size={25}/></div><span className="eyebrow">ACCESO RESTRINGIDO</span><h2>Iniciar sesión</h2><p>Ingresa las credenciales del laboratorio generadas en el archivo .env.</p>
   <label>Correo institucional<input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="username" required/></label>
   <label>Contraseña<input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" required/></label>
   {error&&<div className="alert error">{error}</div>}<button className="btn primary full" disabled={busy}>{busy?'Verificando...':'Ingresar al panel'}<Icon name="arrow"/></button>
   <div className="form-tip"><Icon name="shield" size={16}/> HTTPS local · Cookie HttpOnly · Control por roles</div>
  </form></div></div>;
 const online=!!state?.online,active=!!state?.outputOn;
 return <div className="shell"><aside className="sidebar"><div className="brand small"><div className="brand-icon"><Icon name="shield" size={22}/></div><span>OT<span className="accent">BRIDGE</span></span></div>
    <div className="nav-label">OPERACIONES</div>
    <button className={'nav '+(tab==='control'?'selected':'')} onClick={()=>setTab('control')}><Icon name="power"/> Centro de control</button>
    <button className={'nav '+(tab==='scada'?'selected':'')} onClick={()=>setTab('scada')}><Icon name="activity"/> Supervisión SCADA</button>
    <button className={'nav '+(tab==='audit'?'selected':'')} onClick={()=>setTab('audit')}><Icon name="log"/> Auditoría</button>
    <div className="sidebar-bottom"><div className="security-stamp"><Icon name="lock" size={18}/><span>Canales protegidos<br/><small>TLS 1.3 / OPC UA</small></span></div><div className="user-box"><span className="avatar">{user.email[0].toUpperCase()}</span><span className="user-label"><strong>{user.email.split('@')[0]}</strong><small>{user.role==='operator'?'Operador autorizado':'Observador'}</small></span></div><button onClick={logout} className="nav"><Icon name="logout"/> Cerrar sesión</button></div>
  </aside><main className="main"><header className="topbar"><span>LABORATORIO / <b>{tab==='control'?'CENTRO DE CONTROL':tab==='scada'?'SUPERVISIÓN':'AUDITORÍA'}</b></span><div className="header-right"><span className={'status-pill '+(online?'live':'dead')}><i/>{online?'PLC ONLINE':'PLC OFFLINE'}</span><span className="datetime">{clock.toLocaleTimeString('es-EC',{hour12:false})}</span></div></header>
   <div className="content"><div className="pagehead"><div><div className="eyebrow">OT SECURE COMMUNICATIONS / DEMOSTRACIÓN</div><h1>{tab==='control'?'Centro de control':tab==='scada'?'Supervisión SCADA':'Registro de auditoría'}</h1><p>{tab==='control'?'Gestiona una salida digital simulada a través de un canal MQTT autenticado.':tab==='scada'?'Monitorización de solo lectura del dispositivo y de los servicios de comunicación.':'Trazabilidad de solicitudes, autorizaciones y resultados del PLC.'}</p></div><div className="mini-time">{clock.toLocaleDateString('es-EC',{dateStyle:'full'})}</div></div>
   {tab==='control'&&<><div className="stats"><div className="stat"><div className="stat-title"><Icon name="cpu"/> DISPOSITIVO</div><div className="stat-value">PLC-01</div><div className="stat-sub">OPC UA / Simulado</div></div><div className="stat"><div className="stat-title"><Icon name="activity"/> ESTADO DE LA SALIDA</div><div className={'stat-value '+(active?'green':'')}>{!online?'SIN CONEXIÓN':active?'ENCENDIDA':'APAGADA'}</div><div className="stat-sub">Actualizado: {fmt(state?.updatedAt)}</div></div><div className="stat"><div className="stat-title"><Icon name="shield"/> MENSAJERÍA MQTT</div><div className={'stat-value '+(state?.mqttConnected?'green':'')}>{state?.mqttConnected?'CONECTADO':'DESCONECTADO'}</div><div className="stat-sub">Mosquitto · mTLS · 8883</div></div></div>
   <div className="panels"><section className="panel control-panel"><div className="panel-head"><div><div className="eyebrow">SALIDA DIGITAL · Q0.0 (VIRTUAL)</div><h2>Control de actuador</h2></div><span className="neutral-tag">MODO LABORATORIO</span></div><div className="actuator"><div className={'actuator-ring '+(active&&online?'on':'')}><Icon name="power" size={45}/></div><div><strong>{online?(active?'Salida activada':'Salida desactivada'):'Sin telemetría reciente'}</strong><p>La interfaz solicita el cambio; el gateway confirma el estado real.</p></div></div><div className="actions"><button className="btn onbtn" onClick={()=>command('ON')} disabled={!online||!state?.mqttConnected||busy||user.role!=='operator'}><Icon name="power"/> ENCENDER</button><button className="btn offbtn" onClick={()=>command('OFF')} disabled={!online||!state?.mqttConnected||busy||user.role!=='operator'}><Icon name="power"/> APAGAR</button></div>{user.role!=='operator'&&<p className="muted">Tu cuenta tiene acceso de solo lectura.</p>}{notice&&<div className="alert info">{notice}</div>}</section>
   <section className="panel security-panel"><div className="panel-head"><div className="eyebrow">ARQUITECTURA</div><h2>Flujo verificado</h2></div><div className="flow-grid">{[['01','WEB','Sesión + CSRF'],['02','API','Autorización RBAC'],['03','MQTT','TLS 1.3 / mTLS'],['04','GATEWAY','Firma Ed25519'],['05','PLC','OPC UA cifrado']].map(([n,a,b])=><div className="flow-item" key={n}><span className="flow-index">{n}</span><div><b>{a}</b><small>{b}</small></div></div>)}</div></section></div>
   </>}
   {tab==='scada'&&<div className="panels"><section className="panel"><div className="panel-head"><div className="eyebrow">SCADA / TELEMETRÍA</div><h2>Panel de supervisión</h2></div><div className="scada-machine"><div className="scada-grid"><div className="plc-box"><Icon name="cpu" size={54}/><b>PLC-01</b><small>OPC UA · ns=2;s=ActuatorOn</small></div><div className="connector"><i/><i/><i/><span>CANAL CIFRADO</span></div><div className={'actuator-block '+(active&&online?'energized':'')}><div className="indicator"/><b>SALIDA Q0.0</b><span>{online?(active?'ACTIVA':'INACTIVA'):'SIN DATOS'}</span></div></div><div className="scada-strip"><span>Monitorización solo lectura</span><span>Último dato: {fmt(state?.updatedAt)}</span></div></div></section><section className="panel"><div className="panel-head"><div className="eyebrow">ESTADO DE SERVICIOS</div><h2>Salud de integración</h2></div><div className="health-list"><div><span>PLC y gateway</span><strong className={online?'green':''}>{online?'En línea':'Sin telemetría'}</strong></div><div><span>Broker MQTT</span><strong className={state?.mqttConnected?'green':''}>{state?.mqttConnected?'Conectado':'Desconectado'}</strong></div><div><span>Transporte</span><strong>TLS 1.3 + mTLS</strong></div><div><span>Simulación</span><strong>Salida digital virtual</strong></div></div><div className="alert info">El panel integrado está listo. FUXA se instala opcionalmente con el perfil Docker «scada» y requiere configurar su fuente de datos de solo lectura.</div></section></div>}
   {tab==='audit'&&<section className="panel"><div className="panel-head"><div><div className="eyebrow">ÚLTIMOS 40 EVENTOS</div><h2>Comandos y confirmaciones</h2></div><button className="btn secondary" onClick={reload}>Actualizar</button></div><div className="tablewrap"><table><thead><tr><th>Fecha</th><th>Solicitante</th><th>Comando</th><th>Resultado</th><th>ID</th></tr></thead><tbody>{audit.length?audit.map(x=><tr key={x.id}><td>{fmt(x.created_at)}</td><td>{x.email}</td><td><span className="method">{x.action==='ON'?'ENCENDER':'APAGAR'}</span></td><td><span className={'result '+x.status.toLowerCase()}>{x.status}</span></td><td className="mono">{x.id.slice(0,8)}</td></tr>):<tr><td colSpan="5" className="empty">No hay operaciones registradas.</td></tr>}</tbody></table></div></section>}
    <footer>PUENTE IT/OT · PROTOTIPO ACADÉMICO · NO CONECTAR A INFRAESTRUCTURA OPERATIVA</footer></div>
  </main></div>
}

createRoot(document.getElementById('root')).render(<App/>);
