// Stripe subscription source of truth + license entitlement primitives.
// Local browser/Native Messaging code must never contain these secrets.
import {stripeApi} from './stripe.js';

const SUB_ID=/^sub_[A-Za-z0-9]{8,}$/;
const SESSION_ID=/^cs_(?:test_|live_)[A-Za-z0-9]{8,}$/;
const EVENT_ID=/^evt_[A-Za-z0-9]{6,}$/;
const STATUS=new Set(['incomplete','incomplete_expired','trialing','active','past_due',
 'canceled','unpaid','paused']);
const enc=new TextEncoder();
function hex(bytes){return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function toBase64Url(bytes){
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function licenseKeyFor(subscriptionId,secret,version=1){
 if(!SUB_ID.test(subscriptionId)||typeof secret!=='string'||secret.length<32||
    !Number.isSafeInteger(version)||version<1)throw new Error('LICENSE_SETUP_INVALID');
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,
  enc.encode('mediafinder-pro:v1:'+subscriptionId+':'+version)));
 return 'mfp1_'+toBase64Url(bytes);
}
export async function licenseHash(raw){
 if(typeof raw!=='string'||!/^mfp1_[A-Za-z0-9_-]{43}$/.test(raw))
  throw new Error('INVALID_LICENSE');
 return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(raw))));
}
export function isSubscriptionActive(row,now=Math.floor(Date.now()/1000)){
 return row?.status==='active' && Number.isSafeInteger(row?.period_end) &&
  row.period_end>now && row?.license_revoked!==1;
}
export function subscriptionEventTarget(event){
 if(!event||typeof event!=='object'||!EVENT_ID.test(event.id||''))return null;
 const obj=event.data?.object;
 let id=null,session=null,email=null;
 if(['customer.subscription.created','customer.subscription.updated',
  'customer.subscription.deleted','customer.subscription.paused',
  'customer.subscription.resumed'].includes(event.type)&&obj?.object==='subscription'){
   id=obj.id;
 }else if(event.type==='checkout.session.completed'&&obj?.object==='checkout.session'&&
   obj.mode==='subscription'&&obj.metadata?.product==='mediafinder-pro'&&
   SESSION_ID.test(obj.id||'')){
   id=obj.subscription;
   session=obj.id;
   email=obj.customer_details?.email||obj.customer_email||null;
 }else if(['invoice.paid','invoice.payment_failed'].includes(event.type)&&obj?.object==='invoice'){
   const parent=obj.parent?.subscription_details?.subscription;
   id=typeof parent==='string'?parent:parent?.id||obj.subscription;
 }else return null;
 if(!SUB_ID.test(id||''))return null;
 return {subscriptionId:id,sessionId:session,
  email:typeof email==='string'&&email.length<=254?email:null,
  eventId:event.id,eventCreated:Math.max(0,Math.trunc(Number(event.created)||0))};
}
export function normalizeStripeSubscription(sub,expectedPrice){
 if(!sub||sub.object!=='subscription'||!SUB_ID.test(sub.id||'')||
  !STATUS.has(sub.status)||sub.metadata?.product!=='mediafinder-pro')return null;
 const items=sub.items?.data;
 if(!Array.isArray(items)||items.length!==1||items[0]?.price?.id!==expectedPrice)
  return null;
 const end=items[0]?.current_period_end;
 if(!Number.isSafeInteger(end)||end<0)return null;
 const customer=typeof sub.customer==='string'?sub.customer:sub.customer?.id;
 if(typeof customer!=='string'||!/^cus_[A-Za-z0-9]+$/.test(customer))return null;
 return {subscriptionId:sub.id,customerId:customer,status:sub.status,
  periodEnd:end,cancelAtPeriodEnd:sub.cancel_at_period_end?1:0,
  priceId:expectedPrice};
}
export async function fetchSubscription(env,id){
 if(!SUB_ID.test(id||''))throw new Error('INVALID_SUBSCRIPTION');
 const raw=await stripeApi(env,'subscriptions/'+encodeURIComponent(id));
 const data=normalizeStripeSubscription(raw,env.STRIPE_PRICE_ID);
 if(!data)throw new Error('SUBSCRIPTION_NOT_OURS');
 return data;
}
export async function recordSubscriptionEvent(db,event,data,secret){
 if(!db||!event||!data)throw new Error('SUBSCRIPTION_DB_UNAVAILABLE');
 const token=await licenseKeyFor(data.subscriptionId,secret);
 const hash=await licenseHash(token);
 const email=event.email||null;
 // Single D1 atomic transaction; stale event timestamps cannot roll back newer states.
 // Never rewrite existing license_hash so a future rotation survives older webhooks.
 return db.batch([
  db.prepare('INSERT OR IGNORE INTO subscription_events (event_id,subscription_id) VALUES (?,?)')
   .bind(event.eventId,data.subscriptionId),
  db.prepare(`INSERT INTO subscriptions
   (subscription_id,customer_id,checkout_session_id,email,status,period_end,
    cancel_at_period_end,price_id,license_hash,last_event_created,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,unixepoch())
   ON CONFLICT(subscription_id) DO UPDATE SET
    customer_id=excluded.customer_id,
    checkout_session_id=COALESCE(subscriptions.checkout_session_id,excluded.checkout_session_id),
    email=COALESCE(subscriptions.email,excluded.email),
    status=CASE WHEN excluded.last_event_created>=subscriptions.last_event_created
                THEN excluded.status ELSE subscriptions.status END,
    period_end=CASE WHEN excluded.last_event_created>=subscriptions.last_event_created
                    THEN excluded.period_end ELSE subscriptions.period_end END,
    cancel_at_period_end=CASE WHEN excluded.last_event_created>=subscriptions.last_event_created
                         THEN excluded.cancel_at_period_end ELSE subscriptions.cancel_at_period_end END,
    last_event_created=MAX(subscriptions.last_event_created,excluded.last_event_created),
    updated_at=unixepoch()`)
   .bind(data.subscriptionId,data.customerId,event.sessionId,email,data.status,
    data.periodEnd,data.cancelAtPeriodEnd,data.priceId,hash,event.eventCreated)
 ]);
}
export async function deviceDigest(id){
 if(typeof id!=='string'||!/^[-a-f0-9]{36}$/i.test(id)||!/^[-a-f0-9]{36}$/.test(id.toLowerCase()))
  throw new Error('INVALID_DEVICE');
 return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(id.toLowerCase()))));
}
export async function registerLicenseDevice(db,subscriptionId,deviceId,{limit=2}={}){
 if(!SUB_ID.test(subscriptionId||'')||!Number.isInteger(limit)||limit<1||limit>5)
  throw new Error('LICENSE_DEVICE_ERROR');
 const deviceHash=await deviceDigest(deviceId);
 const sql=`INSERT INTO subscription_devices (subscription_id,device_hash,last_seen)
   SELECT ?,?,unixepoch()
   WHERE EXISTS (SELECT 1 FROM subscriptions WHERE subscription_id=? AND status='active'
     AND period_end>unixepoch() AND license_revoked=0)
   AND ((SELECT COUNT(*) FROM subscription_devices WHERE subscription_id=?) < ?
     OR EXISTS (SELECT 1 FROM subscription_devices WHERE subscription_id=? AND device_hash=?))
   ON CONFLICT(subscription_id,device_hash) DO UPDATE SET last_seen=unixepoch()`;
 const result=await db.prepare(sql).bind(subscriptionId,deviceHash,subscriptionId,
  subscriptionId,limit,subscriptionId,deviceHash).run();
 return Number(result?.meta?.changes||0)>0;
}
