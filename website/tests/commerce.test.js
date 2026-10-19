import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configured,salesReady,isValidOrigin,getPrice,verifyStripeSignature}
 from '../functions/_lib/stripe.js';
import {licenseKeyFor,licenseHash,isSubscriptionActive,
 normalizeStripeSubscription,subscriptionEventTarget,recordSubscriptionEvent,registerLicenseDevice}
 from '../functions/_lib/subscriptions.js';
import {onRequestPost as checkout} from '../functions/api/checkout.js';
import {onRequestPost as webhook} from '../functions/api/stripe-webhook.js';
import {onRequestPost as validateLicense} from '../functions/api/license/validate.js';
import {onRequestGet as storefront} from '../functions/api/storefront.js';
import {onRequestGet as orderStatus} from '../functions/api/order.js';

const END=Math.floor(Date.now()/1000)+30*86400;
const ID='sub_abcdefgh123456';
const priceData={active:true,type:'recurring',recurring:{interval:'month',interval_count:1,usage_type:'licensed'},
 unit_amount:990,currency:'brl'};
const subscription={
 id:ID,object:'subscription',status:'active',
 customer:'cus_abc12345',metadata:{product:'mediafinder-pro'},
 items:{data:[{price:{id:'price_TestAbc123'},current_period_end:END}]},
 cancel_at_period_end:false
};
const env={
 STRIPE_SECRET_KEY:'sk_test_fake_for_tests_only',
 STRIPE_PRICE_ID:'price_TestAbc123',
 STRIPE_WEBHOOK_SECRET:'whsec_fake_test_secret',
 LICENSE_SIGNING_SECRET:'very_long_test_only_server_secret_'.repeat(2),
 SITE_ORIGIN:'https://media-finder.pages.dev',
 EXTENSION_ID:'ilielfcimnndgfbkagilnbndifdmbjnh',
 SALES_ENABLED:'true',DELIVERY_READY:'true',LICENSE_VALIDATION_ENABLED:'true',
 LICENSE_RATE_LIMITER:{limit:async()=>({success:true})},
 DB:{prepare(sql){return{sql,bind(...params){return {sql,params,first:async()=>null,run:async()=>({meta:{changes:1}})};}}},batch:async items=>items}
};
function withFetch(mock,fn){
 const old=globalThis.fetch;
 globalThis.fetch=mock;
 return Promise.resolve().then(fn).finally(()=>{globalThis.fetch=old;});
}
function stripeMock(url,options){
 if(url.includes('/prices/'))return Promise.resolve(Response.json(priceData));
 if(url.includes('/checkout/sessions/')&&options?.method!=='POST')
  return Promise.resolve(Response.json({mode:'subscription',metadata:{product:'mediafinder-pro'},subscription:ID}));
 if(url.endsWith('/checkout/sessions'))
  return Promise.resolve(Response.json({id:'cs_test_ABC1234567890',mode:'subscription',
   url:'https://checkout.stripe.com/c/pay/test'}));
 if(url.includes('/subscriptions/'))return Promise.resolve(Response.json(subscription));
 throw new Error('Unexpected Stripe API URL: '+url);
}
const post=(url,body,origin=env.SITE_ORIGIN)=>new Request(env.SITE_ORIGIN+url,{
 method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'127.0.0.1'},
 body:JSON.stringify(body)
});
async function signature(raw,t,secret=env.STRIPE_WEBHOOK_SECRET){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,
  new TextEncoder().encode(t+'.'+raw)));
 return 't='+t+',v1='+[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
}
test('monthly recurring price is required, and one-time or annual prices are rejected',async()=>{
 await withFetch(stripeMock,async()=>{
  assert.deepEqual(await getPrice(env),{unitAmount:990,currency:'brl',interval:'month'});
 });
 await withFetch(async()=>Response.json({...priceData,recurring:{interval:'year',interval_count:1,usage_type:'licensed'}}),
  async()=>await assert.rejects(getPrice(env),/PRICE_INACTIVE/));
 await withFetch(async()=>Response.json({...priceData,type:'one_time',recurring:null}),
  async()=>await assert.rejects(getPrice(env),/PRICE_INACTIVE/));
});
test('storefront requires delivery readiness, license server and trusted Stripe configuration',async()=>{
 assert.equal(salesReady(env),true);
 assert.equal(configured(env),true);
 for(const field of ['DELIVERY_READY','SALES_ENABLED','STRIPE_WEBHOOK_SECRET',
   'LICENSE_SIGNING_SECRET','LICENSE_RATE_LIMITER','EXTENSION_ID','DB']){
  assert.equal(salesReady({...env,[field]:undefined}),false,field);
 }
 assert.equal(isValidOrigin('https://website.example'),true);
 assert.equal(isValidOrigin('http://website.example'),false);
 const payload=await (await storefront({env:{...env,DELIVERY_READY:'false'}})).json();
 assert.equal(payload.salesEnabled,false);
});
test('checkout forbids forged prices and requests monthly subscription only',async()=>{
 for(const [testEnv,origin,body,status] of [
  [{...env,DELIVERY_READY:'false'},env.SITE_ORIGIN,{plan:'pro'},503],
  [env,'https://evil.invalid',{plan:'pro'},403],
  [env,env.SITE_ORIGIN,{plan:'pro',price:1},400],
  [env,env.SITE_ORIGIN,{plan:'fake'},400]
 ]){
  const response=await checkout({request:post('/api/checkout',body,origin),env:testEnv});
  assert.equal(response.status,status);
 }
 const seen=[];
 await withFetch(async(url,options)=>{
  seen.push({url,options});
  return stripeMock(url,options);
 },async()=>{
  const response=await checkout({request:post('/api/checkout',{plan:'pro'}),env});
  assert.equal(response.status,200);
  assert.ok((await response.json()).url.startsWith('https://checkout.stripe.com/'));
 });
 const fields=new URLSearchParams(seen[1].options.body);
 assert.equal(fields.get('mode'),'subscription');
 assert.equal(fields.get('line_items[0][price]'),env.STRIPE_PRICE_ID);
 assert.equal(fields.get('subscription_data[metadata][product]'),'mediafinder-pro');
 assert.equal(fields.get('metadata[product]'),'mediafinder-pro');
});
test('license HMAC is unguessable from subscription ID and never stored in plain text',async()=>{
 const secret=env.LICENSE_SIGNING_SECRET;
 const token=await licenseKeyFor(ID,secret);
 assert.match(token,/^mfp1_[A-Za-z0-9_-]{43}$/);
 assert.equal(await licenseKeyFor(ID,secret),token);
 assert.notEqual(await licenseKeyFor(ID,secret,2),token);
 const digest=await licenseHash(token);
 assert.match(digest,/^[a-f0-9]{64}$/);
 assert.notEqual(digest,token);
 await assert.rejects(licenseHash('mfp1_invalid'),/INVALID_LICENSE/);
 assert.equal(isSubscriptionActive({status:'active',period_end:END,license_revoked:0}),true);
 assert.equal(isSubscriptionActive({status:'canceled',period_end:END,license_revoked:0}),false);
 assert.equal(isSubscriptionActive({status:'active',period_end:END,license_revoked:1}),false);
 assert.equal(isSubscriptionActive({status:'active',period_end:1,license_revoked:0}),false);
});
test('subscription webhooks support create/update/delete and require the correct price',()=>{
 const evt={id:'evt_abc123456',created:Date.now()/1000|0,
  type:'customer.subscription.updated',data:{object:subscription}};
 assert.equal(subscriptionEventTarget(evt).subscriptionId,ID);
 assert.equal(subscriptionEventTarget({...evt,type:'customer.subscription.deleted'}).subscriptionId,ID);
 assert.equal(subscriptionEventTarget({...evt,type:'invoice.paid',
  data:{object:{object:'invoice',parent:{subscription_details:{subscription:ID}}}}}).subscriptionId,ID);
 assert.equal(normalizeStripeSubscription(subscription,env.STRIPE_PRICE_ID).status,'active');
 assert.equal(normalizeStripeSubscription(subscription,'price_another'),null);
 assert.equal(normalizeStripeSubscription({...subscription,metadata:{product:'other'}},env.STRIPE_PRICE_ID),null);
});
test('signed webhooks sync authoritative current state, never trust forged event payload',async()=>{
 const event={id:'evt_abcdef012345',created:Math.floor(Date.now()/1000),
  type:'customer.subscription.deleted',livemode:false,
  data:{object:{...subscription,status:'canceled'}}};
 const raw=JSON.stringify(event);
 const head=await signature(raw,event.created);
 assert.equal(await verifyStripeSignature(raw,head,env.STRIPE_WEBHOOK_SECRET),true);
 assert.equal(await verifyStripeSignature(raw+' ',head,env.STRIPE_WEBHOOK_SECRET),false);
 const calls=[];
 const envWithDB={...env,DB:{prepare(sql){
  return{bind(...params){return {sql,params};}};
 },batch:async stmts=>{calls.push(...stmts);return stmts;}}};
 await withFetch(stripeMock,async()=>{
  const response=await webhook({request:new Request(env.SITE_ORIGIN+'/api/stripe-webhook',{
   method:'POST',headers:{'Stripe-Signature':head},body:raw
  }),env:envWithDB});
  assert.equal(response.status,200);
 });
 assert.equal(calls.length,2);
 assert.equal(calls[1].params[4],'active'); // even if stale event says canceled
 assert.match(calls[1].sql,/last_event_created/);
 assert.match(calls[1].sql,/ON CONFLICT/);
 assert.match(calls[1].sql,/license_hash/);
 const invalid=await webhook({request:new Request(env.SITE_ORIGIN+'/api/stripe-webhook',{
  method:'POST',headers:{'Stripe-Signature':head},body:raw+' '
 }),env});
 assert.equal(invalid.status,400);
});
test('license endpoint denies absent/revoked/expired credentials without trusting local client',async()=>{
 const license=await licenseKeyFor(ID,env.LICENSE_SIGNING_SECRET);
 const deviceId='f292343e-28d1-4ca8-b563-b22f391dd755';
 const wrong=await validateLicense({request:post('/api/license/validate',
  {key:'mfp1_invalid',deviceId}),env});
 assert.equal(wrong.status,401);
 const fakeEnv={...env,DB:{prepare(sql){
  return{bind(){return{first:async()=>({subscription_id:ID,customer_id:'cus_abc12345',
   status:'canceled',period_end:END,license_revoked:0})};}};
 }}};
 const denied=await validateLicense({request:post('/api/license/validate',
  {key:license,deviceId}),env:fakeEnv});
 assert.equal(denied.status,403);
 const blocked=await validateLicense({request:post('/api/license/validate',
  {key:license,deviceId}),env:{...env,LICENSE_RATE_LIMITER:{limit:async()=>({success:false})}}});
 assert.equal(blocked.status,429);
});
test('active subscription requires fresh Stripe state and enforces at most two devices',async()=>{
 const license=await licenseKeyFor(ID,env.LICENSE_SIGNING_SECRET);
 const knownRow={subscription_id:ID,customer_id:'cus_abc12345',status:'active',
  period_end:END,license_revoked:0};
 const queries=[];
 const goodDb={prepare(sql){return{bind(...params){queries.push({sql,params});
  return{first:async()=>knownRow,run:async()=>({meta:{changes:1}})};}}}};
 const testEnv={...env,DB:goodDb};
 await withFetch(stripeMock,async()=>{
  const response=await validateLicense({request:post('/api/license/validate',{
   key:license,deviceId:'f292343e-28d1-4ca8-b563-b22f391dd755'
  }),env:testEnv});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.active,true);
  assert.equal(body.refreshAfterSeconds,900);
 });
 assert.ok(queries.some(x=>x.sql.includes('COUNT(*) FROM subscription_devices')));
 assert.ok(queries.some(x=>x.params.includes(2)));
 const rejected=await registerLicenseDevice({prepare:()=>({bind:()=>({
  run:async()=>({meta:{changes:0}})
 })})},ID,'f292343e-28d1-4ca8-b563-b22f391dd755');
 assert.equal(rejected,false);
 await withFetch(async()=>Response.json({...subscription,status:'canceled'}),async()=>{
  const response=await validateLicense({request:post('/api/license/validate',{
   key:license,deviceId:'f292343e-28d1-4ca8-b563-b22f391dd755'
  }),env:testEnv});
  assert.equal(response.status,403);
 });
});
test('order status is tied to subscription status, not success URL',async()=>{
 await withFetch(stripeMock,async()=>{
  const req=new Request(env.SITE_ORIGIN+'/api/order?session_id=cs_test_ABC1234567890');
  const res=await orderStatus({request:req,env});
  assert.equal(res.status,200);
  assert.equal((await res.json()).status,'active');
 });
});
test('public files do not expose Stripe keys or licensing secret, checkout starts disabled',()=>{
 for(const name of ['index.html','app.js','styles.css','sucesso.html','order-status.js']){
  const src=readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
  assert.doesNotMatch(src,/sk_(test|live)_[A-Za-z0-9]+/);
  assert.doesNotMatch(src,/LICENSE_SIGNING_SECRET/);
 }
 const src=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(src,/id="checkoutButton"[^>]*disabled/);
});
