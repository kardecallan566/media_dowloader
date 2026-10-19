import {reply,configured,stripeApi} from '../_lib/stripe.js';
export async function onRequestGet({request,env}){
 if(!configured(env))return reply({error:'Serviço indisponível.'},503);
 const url=new URL(request.url);
 const sessionId=url.searchParams.get('session_id')||'';
 if(!/^cs_(?:test_|live_)[A-Za-z0-9]{10,}$/.test(sessionId))
  return reply({error:'Identificador de pagamento inválido.'},400);
 try{
  const session=await stripeApi(env,'checkout/sessions/'+encodeURIComponent(sessionId));
  if(session.metadata?.product!=='mediafinder-pro'||session.mode!=='payment')
   return reply({error:'Pagamento não encontrado.'},404);
  const paid=session.payment_status==='paid';
  return reply({status:paid?'paid':session.status==='expired'?'expired':'pending',
   message:paid?'Pagamento confirmado pela Stripe. Consulte as instruções comerciais de entrega.':
    'Seu pagamento ainda não foi confirmado pela Stripe.'});
 }catch{return reply({error:'Não foi possível consultar o pagamento.'},502);}
}
