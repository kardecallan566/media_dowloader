const title=document.getElementById('orderTitle');
const message=document.getElementById('orderMessage');
const sessionId=new URLSearchParams(location.search).get('session_id')||'';
const masked=/^cs_(?:test_|live_)[A-Za-z0-9]{10,}$/.test(sessionId);
if(!masked){
  title.textContent='Não foi possível identificar o pagamento';
  message.textContent='Retorne ao site. Se houve uma cobrança, consulte o recibo enviado pela Stripe.';
}else{
  try{
    const response=await fetch('/api/order?session_id='+encodeURIComponent(sessionId),{
      cache:'no-store',headers:{Accept:'application/json'}
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||'Falha ao consultar a Stripe.');
    title.textContent=payload.status==='paid'?'Pagamento confirmado':
      payload.status==='expired'?'Sessão expirada':'Pagamento em processamento';
    message.textContent=payload.message||'A confirmação depende da Stripe.';
  }catch(error){
    title.textContent='Não foi possível verificar agora';
    message.textContent=error.message+' Guarde o recibo da Stripe e tente novamente mais tarde.';
  }finally{
    // The session identifier acts as a bearer token: remove it from visible browser history.
    history.replaceState(null,'','/sucesso.html');
  }
}