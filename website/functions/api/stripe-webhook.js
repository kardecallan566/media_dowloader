import {reply,verifyStripeSignature} from '../_lib/stripe.js';
import {subscriptionEventTarget,fetchSubscription,recordSubscriptionEvent} from '../_lib/subscriptions.js';
export async function onRequestPost({request,env}){
 if(!env?.STRIPE_WEBHOOK_SECRET||!env?.STRIPE_SECRET_KEY||!env?.STRIPE_PRICE_ID||
    !env?.DB||typeof env?.LICENSE_SIGNING_SECRET!=='string'||
    env.LICENSE_SIGNING_SECRET.length<32)
  return reply({error:'Serviço indisponível.'},503);
 const size=Number(request.headers.get('Content-Length')||0);
 if(size>1024*1024)return reply({error:'Payload muito grande.'},413);
 let raw;
 try{raw=await request.text();}catch{return reply({error:'Payload inválido.'},400);}
 if(raw.length>1024*1024)return reply({error:'Payload muito grande.'},413);
 const verified=await verifyStripeSignature(raw,request.headers.get('Stripe-Signature'),
  env.STRIPE_WEBHOOK_SECRET);
 if(!verified)return reply({error:'Assinatura inválida.'},400);
 let event;
 try{event=JSON.parse(raw);}catch{return reply({error:'Payload inválido.'},400);}
 if(Boolean(event.livemode)!==env.STRIPE_SECRET_KEY.startsWith('sk_live_'))
  return reply({error:'Ambiente da Stripe incompatível.'},400);
 const target=subscriptionEventTarget(event);
 if(!target)return reply({received:true,processed:false});
 try{
  // Read current subscription status from Stripe, never trust event arrival order.
  const latest=await fetchSubscription(env,target.subscriptionId);
  await recordSubscriptionEvent(env.DB,target,latest,env.LICENSE_SIGNING_SECRET);
  return reply({received:true,processed:true});
 }catch{
  // Retry on 500: subscription data/webhook state must not silently disappear.
  return reply({error:'Não foi possível sincronizar assinatura.'},500);
 }
}
export async function onRequestGet(){return reply({error:'Método não permitido.'},405);}
