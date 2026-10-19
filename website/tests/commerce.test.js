import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configured,isValidOrigin,salesReady,getPrice,verifyStripeSignature,
  stripeCheckoutEvent,recordCheckoutEvent} from '../functions/_lib/stripe.js';
import {onRequestPost as checkout} from '../functions/api/checkout.js';
import {onRequestPost as webhook} from '../functions/api/stripe-webhook.js';
import {onRequestGet as storefront} from '../functions/api/storefront.js';

const testEnv={
 STRIPE_SECRET_KEY:'sk_test_fake_for_tests_only',
 STRIPE_PRICE_ID:'price_TestAbc123',
 STRIPE_WEBHOOK_SECRET:'whsec_fake_test_secret',
 SITE_ORIGIN:'https://media-finder.pages.dev',
 SALES_ENABLED:'true',DELIVERY_READY:'true',
 DB:{prepare(sql){return{sql,bind(...params){this.params=params;return this;}}},batch:async stmts=>stmts}
};
function stripePrice(){return{active:true,type:'one_time',unit_amount:2990,currency:'brl'};}
function stripeSession(){return{
 id:'cs_test_ABC1234567890',mode:'payment',url:'https://checkout.stripe.com/c/pay/test'
};}
test('only explicitly production-ready settings can enable collecting real payments',()=>{
 assert.equal(salesReady(testEnv),true);
 for(const name of ['SALES_ENABLED','DELIVERY_READY','STRIPE_SECRET_KEY','STRIPE_PRICE_ID','STRIPE_WEBHOOK_SECRET','DB']){
  assert.equal(salesReady({...testEnv,[name]:undefined}),false,name);
 }
 assert.equal(isValidOrigin('https://my-product.com'),true);
 assert.equal(isValidOrigin('https://my-product.com/any'),false);
 assert.equal(isValidOrigin('https://user:pass@my-product.com'),false);
 assert.equal(isValidOrigin('http://my-product.com'),false);
 assert.equal(configured(testEnv),true);
});
test('disabled storefront never returns a working payment button',async()=>{
 const response=await storefront({env:{...testEnv,DELIVERY_READY:'false'}});
 const data=await response.json();
 assert.equal(data.salesEnabled,false);
});
test('Stripe configured storefront shows only active one-time price from server',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.stripe.com/v1/prices/price_TestAbc123');
  assert.ok(options.headers.Authorization.startsWith('Bearer sk_test_'));
  return Response.json(stripePrice());
 };
 try{
  const response=await storefront({env:testEnv});
  const data=await response.json();
  assert.deepEqual(data,{salesEnabled:true,price:{unitAmount:2990,currency:'brl'}});
 }finally{globalThis.fetch=old;}
});
test('checkout rejects wrong origin, user-supplied price, unready sales and wrong method body',async()=>{
 for(const {env,origin,body,status} of [
  {env:{...testEnv,SALES_ENABLED:'false'},origin:testEnv.SITE_ORIGIN,body:{plan:'pro'},status:503},
  {env:testEnv,origin:'https://evil.example',body:{plan:'pro'},status:403},
  {env:testEnv,origin:testEnv.SITE_ORIGIN,body:{plan:'pro',price:1},status:400},
  {env:testEnv,origin:testEnv.SITE_ORIGIN,body:{plan:'other'},status:400}
 ]){
  const request=new Request(testEnv.SITE_ORIGIN+'/api/checkout',{
   method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
   body:JSON.stringify(body)
  });
  const result=await checkout({request,env});
  assert.equal(result.status,status);
 }
});
test('checkout creates Stripe-hosted session with trusted price only',async()=>{
 const requests=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  requests.push({url,options});
  return Response.json(url.endsWith('/price_TestAbc123')?stripePrice():stripeSession());
 };
 try{
  const request=new Request(testEnv.SITE_ORIGIN+'/api/checkout',{
   method:'POST',headers:{Origin:testEnv.SITE_ORIGIN,'Content-Type':'application/json'},
   body:JSON.stringify({plan:'pro'})
  });
  const response=await checkout({request,env:testEnv});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.ok(body.url.startsWith('https://checkout.stripe.com/'));
  assert.equal(requests.length,2);
  const form=new URLSearchParams(requests[1].options.body);
  assert.equal(form.get('line_items[0][price]'),testEnv.STRIPE_PRICE_ID);
  assert.equal(form.get('line_items[0][quantity]'),'1');
  assert.equal(form.get('mode'),'payment');
  assert.equal(form.get('metadata[product]'),'mediafinder-pro');
  assert.ok(form.get('success_url').endsWith('{CHECKOUT_SESSION_ID}'));
  assert.equal(requests[1].options.headers.Authorization,'Bearer '+testEnv.STRIPE_SECRET_KEY);
 }finally{globalThis.fetch=original;}
});
async function signature(text,timestamp,secret=testEnv.STRIPE_WEBHOOK_SECRET){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const data=new TextEncoder().encode(timestamp+'.'+text);
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,data));
 return 't='+timestamp+',v1='+[...sig].map(x=>x.toString(16).padStart(2,'0')).join('');
}
test('webhook verifies raw HMAC, timestamp tolerance and prevents tampering',async()=>{
 const body='{"test":"value"}',now=Math.floor(Date.now()/1000);
 const valid=await signature(body,now);
 assert.equal(await verifyStripeSignature(body,valid,testEnv.STRIPE_WEBHOOK_SECRET,{now}),true);
 assert.equal(await verifyStripeSignature(body+' ',valid,testEnv.STRIPE_WEBHOOK_SECRET,{now}),false);
 assert.equal(await verifyStripeSignature(body,valid,testEnv.STRIPE_WEBHOOK_SECRET,{now:now+301}),false);
 assert.equal(await verifyStripeSignature(body,'t=123,v1='+'00'.repeat(32),testEnv.STRIPE_WEBHOOK_SECRET,{now}),false);
});
test('only paid trusted checkout sessions create an order; duplicates are idempotent in SQL',async()=>{
 const event={id:'evt_abc1234',type:'checkout.session.completed',created:1750000000,
  livemode:false,data:{object:{object:'checkout.session',id:'cs_test_ABC1234567890',
  mode:'payment',payment_status:'paid',metadata:{product:'mediafinder-pro'},
  customer_details:{email:'buyer@example.com'},amount_total:2990,currency:'brl'}}};
 const record=stripeCheckoutEvent(event);
 assert.equal(record.status,'paid');
 assert.equal(record.email,'buyer@example.com');
 assert.equal(stripeCheckoutEvent({...event,data:{object:{...event.data.object,metadata:{product:'other'}}}}),null);
 const statements=[];
 const env={...testEnv,DB:{prepare(sql){return{bind(...params){return{sql,params};}}},batch:async stmts=>{statements.push(...stmts);}}};
 const body=JSON.stringify(event),t=Math.floor(Date.now()/1000);
 const header=await signature(body,t);
 const request=new Request(testEnv.SITE_ORIGIN+'/api/stripe-webhook',{
  method:'POST',headers:{'Stripe-Signature':header,'Content-Type':'application/json'},
  body
 });
 const response=await webhook({request,env});
 assert.equal(response.status,200);
 assert.equal((await response.json()).processed,true);
 assert.equal(statements.length,2);
 assert.match(statements[0].sql,/INSERT OR IGNORE INTO stripe_events/);
 assert.match(statements[1].sql,/WHEN orders.payment_status='paid' THEN 'paid'/);
 assert.equal(statements[1].params[0],'cs_test_ABC1234567890');
 const badRequest=new Request(testEnv.SITE_ORIGIN+'/api/stripe-webhook',{
  method:'POST',headers:{'Stripe-Signature':header},body:body+' '}
 );
 const bad=await webhook({request:badRequest,env});
 assert.equal(bad.status,400);
});
test('static site never embeds Stripe secret keys and legal pages exist',()=>{
 for(const name of ['index.html','app.js','styles.css','sucesso.html','order-status.js']){
  const content=readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
  assert.doesNotMatch(content,/sk_(test|live)_[A-Za-z0-9]+/);
 }
 const homepage=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(homepage,/id="checkoutButton"[^>]*disabled/);
 assert.match(homepage,/id="proPrice"/);
 for(const name of ['privacidade.html','termos.html'])
  assert.ok(readFileSync(new URL('../public/'+name,import.meta.url),'utf8').length>300);
});
