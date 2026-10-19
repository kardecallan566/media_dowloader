# Site oficial · Media Finder Pro

## Assinatura mensal e licenciamento

O site comercial do Media Finder Pro está preparado para **Stripe Billing com cobrança recorrente mensal**, não mais pagamento único. O código da extensão e do assistente local permanece funcional sem alterações nesta etapa; nenhum bloqueio de assinatura foi ativado no cliente.

**Implementado:** validação de um Price ID mensal ativo; Stripe Checkout `mode=subscription`; webhook com assinatura HMAC, eventos `customer.subscription.*` e `invoice.*`; consulta atualizada do status da Stripe; tabelas Cloudflare D1 de assinaturas, eventos e dispositivos; chave de licença derivada por HMAC no servidor e armazenada apenas como hash; endpoint `POST /api/license/validate` que permite até **dois dispositivos** por assinatura ativa, verifica o estado atual na Stripe e exige rate limiting.

**Ainda pendente:** entrega segura da chave ao assinante, cadastro/login do cliente, ativação de licença no produto, portal autenticado de cancelamento/gerenciamento da Stripe, direitos e termos comerciais definitivos e distribuição comercial. **As vendas continuam desativadas.** Consulte [SECURITY.md](./SECURITY.md) para os limites de proteção e as condições para ativar as cobranças.

### Publicar no Cloudflare Pages

1. Crie um projeto Pages integrado ao GitHub `kardecallan566/media_dowloader`, com **Root directory `website`**, saída estática `public` e Pages Functions em `functions`.
2. Crie e vincule uma base D1 ao binding exato `DB`. Execute, nesta ordem, `migrations/0001_orders.sql` (caso não exista) e `migrations/0002_subscriptions.sql`. Não utilize D1 de outros projetos.
3. Defina o endereço verdadeiro da implantação na variável `SITE_ORIGIN` (ex.: `https://seu-site.pages.dev`, sem barra final).
4. Configure os segredos `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e `LICENSE_SIGNING_SECRET` **somente** em Secrets do Cloudflare; jamais envie segredos ao Git ou à interface pública da extensão.
5. Configure `STRIPE_PRICE_ID` com o ID de um **preço mensal recorrente** na Stripe. Opcionalmente, use primeiro apenas o modo Test da Stripe.
6. Configure `EXTENSION_ID` com o ID definitivo da extensão e o binding `LICENSE_RATE_LIMITER` (Rate Limiting do Cloudflare).
7. **Mantenha `SALES_ENABLED=false`, `DELIVERY_READY=false` e `LICENSE_VALIDATION_ENABLED=false`** até que o cliente possa obter, usar, restaurar e cancelar sua assinatura.

### Eventos do webhook Stripe

URL `https://SEU_SITE/api/stripe-webhook`. Ative:
`checkout.session.completed`,
`customer.subscription.created`,
`customer.subscription.updated`,
`customer.subscription.deleted`,
`customer.subscription.paused`,
`customer.subscription.resumed`,
`invoice.paid` e
`invoice.payment_failed`.

A Stripe serve como fonte de verdade para o estado atual. As requisições de licença têm proteção por origem permitida, limite de chamadas e validação de assinatura diretamente na Stripe. Isso dificulta o compartilhamento casual, **mas não impede alterações feitas por alguém que possui o código local**.

### Desenvolver e testar

Requisitos: Node 22+, pnpm, Wrangler para deploy.

```powershell
cd website
pnpm install
pnpm dev
pnpm test
```

A suíte do repositório principal também executa os testes do site. Para usar Stripe de verdade, configure as variáveis e o D1 no Pages; os testes de unidade simulam respostas da Stripe e não cobram ninguém.

### Recursos de referência

- [Revisão de segurança, limitações e checklist de lançamento](./SECURITY.md)
- https://docs.stripe.com/billing/subscriptions
- https://docs.stripe.com/webhooks
- https://developers.cloudflare.com/pages/functions/
- https://developers.cloudflare.com/d1/

