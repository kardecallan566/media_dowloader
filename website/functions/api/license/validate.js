// License validation happens on the server. This does not make local JS tamper-proof.
import {reply} from '../../_lib/stripe.js';
import {licenseHash,isSubscriptionActive,fetchSubscription,registerLicenseDevice} from '../../_lib/subscriptions.js';

function permittedOrigin(request,env){
 const origin=request.headers.get('Origin');
 if(typeof origin!=='string')return false;
 if(origin===env.SITE_ORIGIN)return true;
 return /^[a-p]{32}$/.test(env.EXTENSION_ID||'')&&
  origin==='chrome-extension://'+env.EXTENSION_ID;
}
function withCors(response,request,env){
 if(!permittedOrigin(request,env))return response;
 const headers=new Headers(response.headers);
 headers.set('Access-Control-Allow-Origin',request.headers.get('Origin'));
 headers.set('Vary','Origin');
 headers.set('Access-Control-Allow-Headers','Content-Type');
 headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
 return new Response(response.body,{status:response.status,headers});
}
export async function onRequestOptions({request,env}){
 if(!permittedOrigin(request,env))return reply({error:'Origem não autorizada.'},403);
 return withCors(new Response(null,{status:204}),request,env);
}
export async function onRequestPost({request,env}){
 const respond=(body,status=200)=>withCors(reply(body,status),request,env);
 if(!permittedOrigin(request,env))return respond({active:false,error:'Origem não autorizada.'},403);
 if(env?.LICENSE_VALIDATION_ENABLED!=='true'||!env?.DB||
  typeof env?.LICENSE_SIGNING_SECRET!=='string'||env.LICENSE_SIGNING_SECRET.length<32||
  !env?.STRIPE_SECRET_KEY||!env?.STRIPE_PRICE_ID||!env?.LICENSE_RATE_LIMITER)
  return respond({active:false,error:'Validação indisponível.'},503);
 const remote=request.headers.get('CF-Connecting-IP')||'unknown';
 try{
  const result=await env.LICENSE_RATE_LIMITER.limit({key:remote});
  if(!result?.success)return respond({active:false,error:'Muitas tentativas.'},429);
 }catch{return respond({active:false,error:'Validação temporariamente indisponível.'},503);}
 if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))
  return respond({active:false,error:'Formato inválido.'},415);
 const len=Number(request.headers.get('Content-Length')||0);
 if(len>2048)return respond({active:false,error:'Requisição grande demais.'},413);
 let data;
 try{data=await request.json();}catch{return respond({active:false,error:'Requisição inválida.'},400);}
 if(!data||Object.keys(data).length!==2||typeof data.key!=='string'||
  typeof data.deviceId!=='string')return respond({active:false,error:'Credenciais inválidas.'},400);
 let hash;
 try{hash=await licenseHash(data.key);}
 catch{return respond({active:false,error:'Licença inválida.'},401);}
 if(!/^[0-9a-f-]{36}$/.test(data.deviceId.toLowerCase()))
  return respond({active:false,error:'Identificador de dispositivo inválido.'},400);
 try{
  const found=await env.DB.prepare(
   'SELECT subscription_id,customer_id,status,period_end,license_revoked FROM subscriptions WHERE license_hash=?'
  ).bind(hash).first();
  if(!found||!isSubscriptionActive(found))return respond({active:false},403);
  // Consult Stripe for the current state, so delayed webhooks cannot grant revoked access.
  const current=await fetchSubscription(env,found.subscription_id);
  if(current.customerId!==found.customer_id||
     current.status!=='active'||current.periodEnd<=Math.floor(Date.now()/1000))
    return respond({active:false},403);
  const registered=await registerLicenseDevice(env.DB,found.subscription_id,data.deviceId,{limit:2});
  if(!registered)return respond({active:false,error:'Limite de dispositivos atingido.'},409);
  // UI hint, not an offline-proof access token. Privileged APIs must re-check server-side.
  return respond({active:true,refreshAfterSeconds:900,
    renewsAt:current.periodEnd,cancelAtPeriodEnd:Boolean(current.cancelAtPeriodEnd)});
 }catch{return respond({active:false,error:'Não foi possível verificar a assinatura.'},503);}
}
export async function onRequestGet(){return reply({error:'Método não permitido.'},405);}
