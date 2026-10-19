import {reply,verifyStripeSignature,stripeCheckoutEvent,recordCheckoutEvent} from '../_lib/stripe.js';
export async function onRequestPost({request,env}){
 if(!env?.STRIPE_WEBHOOK_SECRET||!env?.DB)return reply({error:'Serviço indisponível.'},503);
 const contentLength=Number(request.headers.get('Content-Length')||0);
 if(contentLength>1024*1024)return reply({error:'Payload muito grande.'},413);
 let raw;
 try{raw=await request.text();}catch{return reply({error:'Payload inválido.'},400);}
 if(raw.length>1024*1024)return reply({error:'Payload muito grande.'},413);
 const verified=await verifyStripeSignature(raw,request.headers.get('Stripe-Signature'),env.STRIPE_WEBHOOK_SECRET);
 if(!verified)return reply({error:'Assinatura inválida.'},400);
 let event;
 try{event=JSON.parse(raw);}catch{return reply({error:'Payload inválido.'},400);}
 const data=stripeCheckoutEvent(event);
 if(!data)return reply({received:true,processed:false});
 if(Boolean(event.livemode)!==env.STRIPE_SECRET_KEY.startsWith('sk_live_'))
  return reply({error:'Ambiente da Stripe incompatível.'},400);
 try{
  await recordCheckoutEvent(env.DB,data);
  return reply({received:true,processed:true});
 }catch{return reply({error:'Falha temporária ao registrar pedido.'},500);}
}
export async function onRequestGet(){return reply({error:'Método não permitido.'},405);}