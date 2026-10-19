// Cloudflare Pages Functions: Stripe helpers. Keep secret keys server-side.
const jsonHeaders={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, private, max-age=0',
  'X-Content-Type-Options':'nosniff'
};
export function reply(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:jsonHeaders});
}
export function configured(env){
  return Boolean(env?.STRIPE_SECRET_KEY && env?.STRIPE_PRICE_ID &&
    env?.STRIPE_WEBHOOK_SECRET && env?.DB && isValidOrigin(env?.SITE_ORIGIN));
}
export function isValidOrigin(value){
  if(typeof value!=='string')return false;
  try{
    const url=new URL(value);
    return (url.protocol==='https:' || (url.protocol==='http:'&&url.hostname==='localhost')) &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname==='/' &&
      value===url.origin;
  }catch{return false;}
}
export function salesReady(env){
  // No real payments until license delivery/activation and policies are ready.
  return env?.SALES_ENABLED==='true' && env?.DELIVERY_READY==='true' && configured(env);
}
export async function stripeApi(env,path,{method='GET',body=null,fetcher=fetch}={}){
  if(!env?.STRIPE_SECRET_KEY)throw new Error('STRIPE_NOT_CONFIGURED');
  const options={
    method,
    headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,
      Accept:'application/json'},
    signal:AbortSignal.timeout(12000)
  };
  if(body){
    options.headers['Content-Type']='application/x-www-form-urlencoded';
    options.body=body.toString();
  }
  const response=await fetcher('https://api.stripe.com/v1/'+path,options);
  if(!response.ok)throw new Error('STRIPE_API_ERROR');
  return response.json();
}
export async function getPrice(env,fetcher=fetch){
  if(!/^price_[A-Za-z0-9]+$/.test(env?.STRIPE_PRICE_ID||''))throw new Error('PRICE_ID_INVALID');
  const price=await stripeApi(env,'prices/'+encodeURIComponent(env.STRIPE_PRICE_ID),{fetcher});
  if(!price.active||price.type!=='one_time'||price.recurring||!Number.isInteger(price.unit_amount)||
    price.unit_amount<100||!(/^[a-z]{3}$/.test(price.currency||'')))throw new Error('PRICE_INACTIVE');
  return {unitAmount:price.unit_amount,currency:price.currency};
}
function hexToBytes(input){
  if(!/^[a-fA-F0-9]{64}$/.test(input))return null;
  const bytes=new Uint8Array(32);
  for(let i=0;i<32;i++)bytes[i]=parseInt(input.slice(2*i,2*i+2),16);
  return bytes;
}
export async function verifyStripeSignature(raw,header,secret,{now=Math.floor(Date.now()/1000),tolerance=300}={}){
  if(typeof raw!=='string'||typeof header!=='string'||typeof secret!=='string'||
    !secret.startsWith('whsec_'))return false;
  const fields=header.split(',').map(x=>x.trim().split('='));
  const timestamp=fields.find(([key])=>key==='t')?.[1];
  const candidates=fields.filter(([key])=>key==='v1').map(([,sig])=>sig);
  if(!/^\d{10,}$/.test(timestamp||'')||candidates.length===0)return false;
  const seconds=Number(timestamp);
  if(!Number.isSafeInteger(seconds)||Math.abs(now-seconds)>tolerance)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signed=new TextEncoder().encode(timestamp+'.'+raw);
  for(const candidate of candidates){
    const bytes=hexToBytes(candidate||'');
    if(bytes&&await crypto.subtle.verify('HMAC',key,bytes,signed))return true;
  }
  return false;
}
export function stripeCheckoutEvent(event){
  if(!event || typeof event!=='object' ||
    typeof event.id!=='string'||!/^evt_[A-Za-z0-9]+$/.test(event.id))return null;
  const type=event.type;
  const session=event.data?.object;
  const allowed=['checkout.session.completed','checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed','checkout.session.expired'];
  if(!allowed.includes(type)||!session||session.object!=='checkout.session'||
    session.mode!=='payment'||session.metadata?.product!=='mediafinder-pro'||
    typeof session.id!=='string'||!/^cs_(?:test_|live_)[A-Za-z0-9]+$/.test(session.id))return null;
  let status='pending';
  if(type==='checkout.session.async_payment_succeeded'||
    (type==='checkout.session.completed'&&session.payment_status==='paid'))status='paid';
  if(type==='checkout.session.async_payment_failed')status='failed';
  if(type==='checkout.session.expired')status='expired';
  const email=session.customer_details?.email||session.customer_email||null;
  return {
    eventId:event.id,sessionId:session.id,created:Number(event.created)||0,
    status,
    email:typeof email==='string'?email.slice(0,254):null,
    paymentIntent:typeof session.payment_intent==='string'?session.payment_intent:null,
    amount:Number.isSafeInteger(session.amount_total)?session.amount_total:null,
    currency:typeof session.currency==='string'?session.currency:null
  };
}
export async function recordCheckoutEvent(db,data){
  // D1 batch is transactional. The event ID is unique; repeating webhooks does not
  // mint multiple entitlements. A successful payment must not be overwritten by
  // a late pending/failed event.
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO stripe_events (event_id,session_id) VALUES (?,?)')
      .bind(data.eventId,data.sessionId),
    db.prepare(`INSERT INTO orders
      (session_id,payment_intent,email,amount_total,currency,payment_status,updated_at)
      VALUES (?,?,?,?,?,?,unixepoch())
      ON CONFLICT(session_id) DO UPDATE SET
      payment_intent=COALESCE(excluded.payment_intent,orders.payment_intent),
      email=COALESCE(excluded.email,orders.email),
      amount_total=COALESCE(excluded.amount_total,orders.amount_total),
      currency=COALESCE(excluded.currency,orders.currency),
      payment_status=CASE WHEN orders.payment_status='paid' THEN 'paid'
                           ELSE excluded.payment_status END,
      updated_at=unixepoch()`)
      .bind(data.sessionId,data.paymentIntent,data.email,
        data.amount,data.currency,data.status)
  ]);
}
