import {reply,configured,stripeApi} from '../_lib/stripe.js';
import {fetchSubscription} from '../_lib/subscriptions.js';
export async function onRequestGet({request,env}){
 if(!configured(env))return reply({error:'Serviço indisponível.'},503);
 const url=new URL(request.url);
 const sessionId=url.searchParams.get('session_id')||'';
 if(!/^cs_(?:test_|live_)[A-Za-z0-9]{10,}$/.test(sessionId))
  return reply({error:'Identificador de pagamento inválido.'},400);
 try{
  const session=await stripeApi(env,'checkout/sessions/'+encodeURIComponent(sessionId));
  if(session.metadata?.product!=='mediafinder-pro'||session.mode!=='subscription'||
    typeof session.subscription!=='string')return reply({error:'Assinatura não encontrada.'},404);
  const sub=await fetchSubscription(env,session.subscription);
  const active=sub.status==='active'&&sub.periodEnd>Math.floor(Date.now()/1000);
  return reply({status:active?'active':'pending',cancelAtPeriodEnd:Boolean(sub.cancelAtPeriodEnd),
   message:active?'Assinatura confirmada pela Stripe. A entrega da licença será liberada no lançamento.':
    'A assinatura ainda não está ativa. Confirme o pagamento ou aguarde o processamento.'});
 }catch{return reply({error:'Não foi possível consultar a assinatura.'},502);}
}
