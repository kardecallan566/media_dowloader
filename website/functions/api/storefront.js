import {reply,configured,salesReady,getPrice} from '../_lib/stripe.js';
export async function onRequestGet({env}){
 const ready=salesReady(env);
 if(!configured(env))return reply({salesEnabled:false,price:null});
 try{return reply({salesEnabled:ready,price:await getPrice(env)});}
 catch{return reply({salesEnabled:false,price:null});}
}