const price = document.getElementById('proPrice');
const buy = document.getElementById('checkoutButton');
const status = document.getElementById('checkoutStatus');
const year = document.getElementById('year');
if(year) year.textContent = String(new Date().getFullYear());

let salesReady = false;
async function initStorefront(){
  try {
    const response = await fetch('/api/storefront',{cache:'no-store',headers:{Accept:'application/json'}});
    if(!response.ok) throw new Error('Não foi possível consultar a disponibilidade comercial.');
    const data = await response.json();
    if(data.price && Number.isInteger(data.price.unitAmount)){
      price.textContent = new Intl.NumberFormat('pt-BR',{
        style:'currency',currency:data.price.currency.toUpperCase()
      }).format(data.price.unitAmount/100) + (data.price.interval==='month'?' / mês':'');
    }
    salesReady = data.salesEnabled === true;
    buy.disabled = !salesReady;
    buy.textContent = salesReady ? 'Adquirir licença Pro ↗' : 'Disponível em breve';
    status.textContent = salesReady ?
      'Assinatura mensal renovável. Leia as condições de cancelamento antes de comprar.' :
      'Checkout em preparação. Nenhuma cobrança está sendo realizada neste site.';
  }catch(error) {
    buy.disabled=true;
    buy.textContent='Venda indisponível';
    status.textContent=error.message;
  }
}
if(buy){
  buy.addEventListener('click',async()=>{
    if(!salesReady)return;
    buy.disabled=true;
    buy.textContent='Conectando à Stripe...';
    status.textContent='Aguarde um instante.';
    try{
      const response=await fetch('/api/checkout',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({plan:'pro'})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Não foi possível abrir o pagamento.');
      const target=new URL(result.url);
      if(target.protocol!=='https:'||target.hostname!=='checkout.stripe.com')
        throw new Error('O provedor retornou um endereço inesperado.');
      window.location.assign(target.href);
    }catch(error){
      status.textContent=error.message;
      buy.disabled=false;
      buy.textContent='Tentar novamente ↗';
    }
  });
}
initStorefront();
