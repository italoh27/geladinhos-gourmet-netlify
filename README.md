# Geladinhos Gourmet — React + Netlify

Cópia independente da loja original, reescrita em React e TypeScript. O projeto antigo não é alterado. Esta versão trabalha com uma única loja e um único estoque, sem separação entre Italo e Karina.

## O que está incluído

- loja responsiva, carrinho local e consulta de estoque;
- confirmação transacional de estoque somente na criação do pedido;
- reserva temporária para checkout e devolução automática por função agendada;
- cadastro, login, sessões seguras e recuperação automática de senha por código no e-mail;
- endereço com preenchimento por CEP;
- InfinitePay com criação de checkout, consulta e webhook de confirmação;
- opção administrativa de liberar o pedido antes ou somente depois do pagamento;
- Pix manual opcional, taxa ou entrega grátis e WhatsApp flutuante;
- painel com pedidos, edição, exclusão, status, pedido rápido e notificações;
- sabores e estoque editáveis;
- clientes cadastrados e campanha de fidelidade nas faixas de R$ 5 e R$ 7;
- análise por período, pagamento e cliente cadastrado, com exportação CSV compatível com Excel.

## Desenvolvimento local

Requer Node.js 22+ e pnpm.

```bash
pnpm install
pnpm dev
```

A interface usa dados demonstrativos somente em `localhost` quando a API do Netlify não está disponível. Para testar banco e funções localmente, vincule o projeto e use `netlify dev`.

## Variáveis no Netlify

Copie os nomes de `.env.example` para **Project configuration > Environment variables**:

- `ADMIN_PASSWORD`: senha forte do painel;
- `SESSION_SECRET`: chave aleatória com pelo menos 24 caracteres;
- `INFINITEPAY_HANDLE`: identificador da conta InfinitePay;
- `PUBLIC_SITE_URL`: URL final do site no Netlify;
- `RESEND_API_KEY` e `EMAIL_FROM`: envio do código de recuperação de senha;

Nunca publique valores reais no repositório.

## Publicação

1. Crie um repositório separado no GitHub para esta cópia.
2. Importe esse repositório no Netlify.
3. O `netlify.toml` já define `pnpm build`, diretório `dist` e as Functions.
4. O Netlify Database detecta e aplica automaticamente a migração em `netlify/database/migrations` durante o deploy.
5. Cadastre as variáveis acima e faça um novo deploy.
6. Abra o painel em `/admin/login`, configure WhatsApp, estoque, entrega, pagamentos e a abertura da loja.

## Verificação

```bash
pnpm typecheck
pnpm build
```
