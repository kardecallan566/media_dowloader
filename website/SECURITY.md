# Media Finder Pro — proteção de assinatura mensal

## Modelo de ameaça: o que podemos e não podemos impedir

Qualquer extensão Chrome, JavaScript distribuído ao usuário, executável Python/Windows ou binário local pode ser inspecionado e alterado por alguém com controle da própria máquina. **Não é possível garantir que um bloqueio local de assinatura seja impossível de contornar.** Ofuscar o JavaScript ou usar uma senha fixa no executável não resolve esse problema.

O repositório `kardecallan566/media_dowloader` está atualmente **público**. Edições já copiadas não podem ser recolhidas. Para um produto pago, mantenha a edição existente gratuita/comunitária e proteja serviços premium e canais futuros em repositório privado, com acesso autorizado. Ao tornar o repositório privado futuramente, preserve a licença e os direitos já concedidos sobre as versões publicadas.

## Camadas efetivamente implementadas no backend

1. **Stripe Billing recorrente:** Checkout `mode=subscription`, com Price ID ativo, `recurring.interval=month` e cobrança mensal fixa, nunca preço passado pelo navegador.
2. **Status confiável:** webhook Stripe assinado por HMAC, atualizado pelos eventos de assinatura e fatura; o servidor consulta o objeto atual da assinatura na Stripe antes de registrar mudanças. Não considera redirecionamento de sucesso como comprovação de acesso.
3. **Banco Cloudflare D1:** migração `0002_subscriptions.sql` cria assinaturas, eventos exclusivos e dispositivos autorizados. Registro de eventos idempotente e controles contra eventos antigos reverterem o estado mais novo.
4. **Licença:** HMAC-SHA256 calculado no servidor a partir do identificador da assinatura, versão e `LICENSE_SIGNING_SECRET` (segredo de 32+ caracteres). O D1 armazena somente **SHA-256 da licença**, nunca a licença em texto puro. Nunca inclua o segredo no site, na extensão, no repositório ou no assistente local.
5. **Validação online:** `POST /api/license/validate` exige chave e identificador da instalação, confirma a assinatura ativa na Stripe e nega acesso se estiver cancelada, vencida, revogada ou com status de cobrança inválido. Cabeçalhos de origem permitida e rate limiting reduzem uso indevido; a chave de licença continua sendo a autenticação real.
6. **Dispositivos:** permite até **dois IDs de instalação** por assinatura. IDs são derivados e armazenados como hash no banco. Esse controle evita compartilhamento trivial, mas IDs locais podem ser falsificados ou copiados; não é proteção criptográfica de hardware.
7. **Fail closed:** vendas permanecem desligadas a menos que `SALES_ENABLED`, `DELIVERY_READY`, `LICENSE_VALIDATION_ENABLED`, `EXTENSION_ID`, Stripe, D1, `LICENSE_SIGNING_SECRET` e o limitador de requisições estejam devidamente configurados.

## Ainda NÃO implementado para vender (bloqueadores)

- **Identificação/autenticação do comprador** e entrega automática e autenticada de licença (por e-mail transacional ou área do cliente); nada de expor licença na URL pública de sucesso.
- **Ativação na extensão e no assistente local** com UX clara, renovação da autorização e distinção de recursos gratuitos/pagos. A extensão atual **não exige** a chave de licença; a API está apenas preparada. Não anuncie proteção aplicada no cliente antes dessa etapa.
- **Portal seguro Stripe Billing** para o cliente administrar e cancelar sua assinatura. Jamais permita abrir o portal de outro cliente apenas sabendo um e-mail ou sem autenticação.
- **Revogação/troca de dispositivos**, recuperação de conta, reset de chave individual e recuperação de pagamentos contestados e reembolsos.
- **Proteção dos diferenciais premium no servidor:** funcionalidades que rodam inteiramente no PC poderão ser alteradas mesmo se um bloqueio de licença for integrado. Recursos pagos importantes devem envolver serviços autenticados no backend, benefícios de suporte ou entrega controlada de atualizações, quando aplicável.
- **Rate limiting do próprio checkout, antifraude, termos finais, suporte, consentimento, política de reembolso, análise de direitos e elegibilidade na Stripe**, testes reais do checkout e entrega em ambiente de testes.
- **Versão comercial separada / distribuição segura:** instalação do pacote com assinatura digital quando apropriado, releases autorizadas, checksums, instruções claras e downloads HTTPS; não incluir chave secreta de Stripe em binário.

## Configurar o Cloudflare Pages

1. Execute `migrations/0001_orders.sql` (se ainda não foi executada) e **também** `migrations/0002_subscriptions.sql` no D1 de destino.
2. Crie na Stripe o produto Media Finder Pro e um **preço recorrente mensal**. Não reutilize o antigo Price ID de pagamento único.
3. Habilite no webhook:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Crie `LICENSE_SIGNING_SECRET` com pelo menos 32 caracteres **aleatórios de um gerador seguro**, em segredo do Cloudflare; registre em backup seguro. Trocar o segredo torna as licenças derivadas anteriormente inválidas, exigindo plano de migração.
5. Configure binding **`LICENSE_RATE_LIMITER`** do Cloudflare Workers Rate Limiting, com limite conservador conforme a carga legítima esperada. Configure `EXTENSION_ID` com o ID definitivo do pacote que será distribuído.
6. Deixe `SALES_ENABLED=false`, `DELIVERY_READY=false` e `LICENSE_VALIDATION_ENABLED=false` enquanto as etapas pendentes não estiverem completas.
7. Valide todos os fluxos em modo **Stripe Test**, especialmente renovação, cancelamento imediato, cancelamento ao final do ciclo, cartão recusado, reenvio/atraso de webhooks, dois dispositivos e recusa de terceiro aparelho.

A assinatura **não pode ser considerada um mecanismo anticrack por si só**. Use os eventos da Stripe e verificações de acesso como controle comercial, e recursos de backend como a fronteira de confiança.

Documentação:
- https://docs.stripe.com/billing/subscriptions
- https://docs.stripe.com/webhooks
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
