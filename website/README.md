# Site oficial · Media Finder Pro

Site comercial responsivo com checkout hospedado na Stripe e funções server-side do Cloudflare Pages. O site mora em `website/`, separado da extensão instalada no navegador.

## Estado atual

- ✅ Landing page responsiva, apresentação, recursos, instalação, dúvidas e seção de compra.
- ✅ API de preço consultando a Stripe sem divulgar chave privada, Checkout Sessions de pagamento único e verificação server-side do status.
- ✅ Webhook Stripe com assinatura HMAC-SHA256, tolerância a timestamp e pedidos D1 com `session_id` único.
- ✅ Páginas preliminares de privacidade/termos e confirmação. Testes automatizados.
- **⛔ Checkout DESATIVADO por padrão**. Não habilite pagamentos antes de configurar a entrega real da licença, o instalador/release, o suporte, as políticas legais e a revisão da elegibilidade pela Stripe.

O site deliberadamente NÃO promete uma licença automática ou um download privado já entregue: o sistema de ativação/licenciamento e distribuição paga ainda precisam ser ligados ao pagamento antes de qualquer venda. O banco registra pedidos, mas não envia chaves de licença.

## Publicar pelo Cloudflare Pages (Git)

1. No painel **Workers & Pages → Create → Pages → Connect to Git**, selecione `kardecallan566/media_dowloader`.
2. Configure **Root directory** como `website`, **Build command** vazio e **Build output directory** como `public`. O diretório `functions/` fica na raiz da pasta `website`, separado dos arquivos estáticos.
3. Faça o primeiro deploy. Guarde o endereço real `https://...pages.dev` fornecido pelo painel.
4. Crie um banco Cloudflare D1 específico para a loja, por exemplo `mediafinder-shop`; execute `wrangler d1 execute mediafinder-shop --remote --file=migrations/0001_orders.sql` a partir da pasta `website`, autenticado na sua conta.
5. Em **Pages → Settings → Bindings**, vincule o D1 com o nome exato **`DB`**; redeploy para a função receber o binding.

### Variáveis e segredos do Pages

Configure no ambiente de produção do Pages:

| Variável | Exemplo de valor | Segredo? |
|---|---|---|
| `SITE_ORIGIN` | `https://seu-projeto.pages.dev` (sem barra final) | não |
| `STRIPE_SECRET_KEY` | chave secreta de **teste** obtida no Stripe Dashboard | **sim** |
| `STRIPE_PRICE_ID` | Price ID `price_...` de pagamento **único** | não |
| `STRIPE_WEBHOOK_SECRET` | assinatura `whsec_...` do endpoint de webhook | **sim** |
| `SALES_ENABLED` | `false` | não |
| `DELIVERY_READY` | `false` | não |

**Não envie segredos pela conversa, não inclua chaves em GitHub e não coloque `sk_test`, `sk_live` ou `whsec` em código do navegador.** Configure-os como variáveis criptografadas no Cloudflare Pages (ou localmente em `website/.dev.vars`, ignorado pelo Git).

A disponibilidade de compra exige **todas** as configurações, `SALES_ENABLED=true`, `DELIVERY_READY=true` e D1. Mesmo com estas opções, a entrega da licença precisa ser implementada e testada antes de habilitar as cobranças.

### Stripe Dashboard

1. Crie um **produto Media Finder Pro** no modo de teste, com preço de **pagamento único** definido por você. Copie o Price ID (`price_...`). A implementação atual **não suporta assinatura recorrente**; isso poderá ser adicionado numa próxima etapa.
2. Em **Developers → Webhooks**, cadastre a URL **`https://SEU_SITE/api/stripe-webhook`** e selecione os eventos:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
3. Copie a **signing secret** deste webhook para `STRIPE_WEBHOOK_SECRET`. Chaves/assinaturas de **teste** e **produção** são diferentes.
4. Configure `SITE_ORIGIN` para a origem real do site; não use o caminho da página, barra final nem domínio inventado.
5. Faça um teste de checkout com credenciais de teste, veja os eventos chegarem e confira o registro em D1. Confirme ausência de duplicatas quando o webhook for reentregue.

A API do checkout responde com a URL de uma Stripe Checkout Session gerada no servidor e usa **apenas** o Price ID configurado; não aceita preço enviado pelo comprador. Para cada pagamento, as funções conferem a assinatura do webhook antes de escrever no banco. O navegador não deve decidir se um pagamento foi aprovado.

### Testar localmente

Requisitos: Node 22+, pnpm, Wrangler autenticado.

```powershell
cd website
pnpm install
pnpm dev
```

O comando acima utiliza `wrangler pages dev public`. Para testar Stripe de verdade, configure `website/.dev.vars` e passe o binding D1 local conforme a documentação do Wrangler. Não use o banco de produção para testes locais.

Teste unitário, sem acesso à Stripe real:

```powershell
pnpm test
```

O pipeline GitHub Actions do repositório principal também executa estes testes.

## Segurança / ativação antes de vender

Ainda precisam ser concluídos: **chaves de licença e validação no produto**, entrega segura para comprador, política de suporte/reembolsos, identificação do vendedor e documento legal definitivo, análise das políticas Stripe e das plataformas cujo conteúdo o software processa, mecanismo de limitação de abuso do checkout, e testes completos de reembolsos/disputas. Não prometa funcionalidades que os testes de navegador ainda não comprovaram.

Não exiba publicamente uma licença, e-mail, identificador de checkout ou outro dado privado de um comprador. O endpoint `/api/order` exibe apenas o status básico após consultar a Stripe, sem devolver e-mail ou informações do cartão.

**Importante:** a extensão em si continua funcionando independentemente desta página. Nenhum arquivo da extensão ou do assistente foi modificado nesta implementação do site.

## Documentação

- Stripe Checkout: https://docs.stripe.com/payments/checkout
- Webhooks: https://docs.stripe.com/webhooks
- Cloudflare Pages Functions: https://developers.cloudflare.com/pages/functions/
- D1 Bindings: https://developers.cloudflare.com/pages/functions/bindings/
