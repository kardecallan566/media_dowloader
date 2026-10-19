import {reply,salesReady,getPrice,stripeApi} from '../_lib/stripe.js';
export async function onRequestPost({request,env}){
 if(!salesReady(env))return reply({error:'Vendas indisponíveis no momento.'},503);
 if(request.headers.get('Origin')!==env.SITE_ORIGIN)
  return reply({error:'Origem não autorizada.'},403);
 if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
  return reply({error:'Formato de solicitação inválido.'},415);
 let body;
 try{body=await request.json();}catch{return reply({error:'Solicitação inválida.'},400);}
 if(!body||body.plan!=='pro'||Object.keys(body).some(key=>key!=='plan'))
  return reply({error:'Plano desconhecido.'},400);
 try{
  await getPrice(env);
  const fields=new URLSearchParams();
  fields.set('mode','payment');
  fields.set('line_items[0][price]',env.STRIPE_PRICE_ID);
  fields.set('line_items[0][quantity]','1');
  fields.set('metadata[product]','mediafinder-pro');
  fields.set('client_reference_id','mediafinder-pro-license');
  fields.set('locale','pt-BR');
  fields.set('success_url',env.SITE_ORIGIN+'/sucesso.html?session_id={CHECKOUT_SESSION_ID}');
  fields.set('cancel_url',env.SITE_ORIGIN+'/?checkout=cancelado#planos');
  const session=await stripeApi(env,'checkout/sessions',{method:'POST',body:fields});
  if(!session?.id||session.mode!=='payment'||!session?.url||
    new URL(session.url).hostname!=='checkout.stripe.com')
    throw new Error('INVALID_CHECKOUT');
  return reply({url:session.url});
 }catch{return reply({error:'Não foi possível iniciar o checkout. Tente novamente.'},502);}
}
export async function onRequestGet(){return reply({error:'Método não permitido.'},405);}