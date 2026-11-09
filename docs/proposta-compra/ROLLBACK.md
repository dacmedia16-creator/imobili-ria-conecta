# ROLLBACK — Proposta de compra (PR feat/proposta-compra, migration 20261109120000)

Cartões t_4cff61a6 (banco), t_da0dac53 (telas), t_4617a9e9 (homologação) e t_b4e7c368 (texto oficial + tipo de sinal). **Nada disto está em produção.**
Use este roteiro só depois de uma publicação autorizada por Denis. Comece pelo passo mais leve e pare no primeiro que resolver.

> Texto aprovado por Denis em 09/11 ("1 aprovado", pendência do advogado resolvida): `TEXTO_APROVADO_ADVOGADO = true`
> (`src/lib/proposta-compra.ts`), sem marca de minuta. Voltar a `false` recoloca a marca no PDF, no link e na tela.

## 1. Desligar a chave (segundos, sem deploy, sem perder nada)

O módulo `proposta_compra` é por imobiliária e nasce desligado em todas.

- **Pela tela:** Plataforma → Imobiliárias → Módulos → desligar "Proposta de compra" na imobiliária.
- **Por SQL (produção `xvvymgurpchhlmbpjbgc`, só com autorização):**

```sql
UPDATE public.organization_modules SET enabled = false, updated_at = now()
 WHERE module = 'proposta_compra' AND organization_id = '<org>';
```

Efeito: a aba Propostas some da captação, `/propostas/$id` volta para o início, os itens de proposta saem do
"O que fazer hoje" e os links `/proposta/$token` deixam de abrir para assinatura. As propostas, assinaturas e
códigos continuam guardados. Para religar, use `enabled = true`; os mesmos links voltam a valer, desde que a proposta
e o código ainda estejam dentro da validade.

## 2. Parar o WhatsApp sem desligar o módulo

O envio real só acontece com `PROPOSTA_WHATSAPP_REAL=1`. Para voltar ao modo de teste, apague esse secret do Worker
ou troque o valor para `0`; nenhuma mensagem sai, e a tela avisa "Modo de teste". O envio usa só
`ZIONTALK_API_KEY`. Enquanto existir, `PROPOSTA_WHATSAPP_SO_PARA` restringe o envio a esse único número.

## 3. Reverter o front (PR)

1. Rode `gh pr view <nº> --json mergeCommit` para achar o merge na `main`.
2. Faça `git revert -m 1 <merge>` numa branch, abra um PR e faça o merge.
3. Rode `npm run deploy:safe` a partir da `main`. Para voltar mais rápido sem build, use
   `wrangler rollback <versão anterior>` (anote a versão no deploy).

Sem o front, as rotas `/propostas/$id` e `/proposta/$token` deixam de existir. O banco pode continuar como está,
porque nada no app antigo usa as tabelas novas.

## 4. Reverter o banco (SQL), só se precisar apagar tudo

Arquivo: `supabase/rollback/20261109120000_proposta_compra.sql`. Antes, faça backup
(`bash /root/.config/max/adm-max-prod-pg/backup-prod.sh pre-rollback-proposta`) e reverta o front (passo 3).
A tela de Módulos lista `proposta_compra`, e o CHECK deixaria de aceitar o valor.

O rollback faz o seguinte:
- apaga as funções `proposta_*`;
- apaga as 6 tabelas: `propostas_compra`, `proposta_partes`, `proposta_codigos`, `proposta_assinaturas`, `proposta_eventos` e `proposta_tentativas`;
- apaga a chave HMAC `proposta_compra_chave` do Vault;
- apaga as linhas `proposta_compra` de `organization_modules`;
- devolve o CHECK e `platform_set_organization_module` à versão da 20261108200000;
- (t_b4e7c368) devolve `agency_profile_save` à versão da 20261004173400 (sem a chave `endereco`) e apaga a coluna
  `organizations.endereco`. **Atenção:** o endereço digitado em Dados da imobiliária se perde. Se quiser guardar,
  exporte antes: `SELECT id, nome, endereco FROM public.organizations WHERE endereco IS NOT NULL;`.

**Não toca** em vendas, `sale_parties`, `sale_documents`, captações, leads nem no histórico de liga/desliga.
A venda criada por "Criar venda em rascunho" continua sendo uma venda normal, e o lead continua na etapa em que está.

Para aplicar e registrar no histórico de migrations, numa transação só:

```sql
BEGIN;
-- conteúdo do arquivo de rollback, sem as linhas BEGIN; / COMMIT;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261109120000';
COMMIT;
```

Depois do rollback, todos os links já enviados param de abrir de vez. Reaplicar a migration gera uma chave nova,
e os links antigos **não** voltam.

## Provado na homologação (t_4617a9e9)

Na homologação `qvhyepwduhlgqwpgmpvh`, com backup prévio `pre-t_4617a9e9-20261109T034021Z`, a impressão digital do esquema deu:
- antes: `ef103df3…`;
- com a migration: `5b869f82…`, com 6 tabelas, 42 funções e 1 segredo no Vault;
- depois do rollback: `ef103df3…`, igual ao antes;
- depois de reaplicar: `5b869f82…`.

A suíte `supabase/tests/run-proposta-compra.sh` passou 112/112 contra a migration aplicada.

## Texto oficial + tipo de sinal (t_b4e7c368) — provado na homologação, transação desfeita

A própria migration `20261109120000` (nunca aplicada em produção) ganhou: `sinal_tipo` com `confirmatorias` (padrão)
ou `penitenciais`; `termos jsonb` (lista fechada validada por `proposta_termos_limpar`); `documento_data` e
`cadastro jsonb` (data e retrato do cadastro fixados por `proposta_preparar_pdf`); `organizations.endereco` e a chave
`endereco` em `agency_profile_save`. Mudar o tipo de sinal (ou qualquer termo) depois de alguém assinar gera nova
versão e invalida as assinaturas (mesma regra do restante do texto).

Numa transação desfeita no fim (`ROLLBACK`), na homologação `qvhyepwduhlgqwpgmpvh`:
- com a migration antiga aplicada: `b0e4b785…` (6 tabelas, 42 funções);
- depois do rollback antigo: `753e1ef8…` (sem a migration);
- depois da migration nova: `3baaa796…` (6 tabelas, 45 funções, 1 segredo no Vault);
- suíte SQL contra a migration nova: **126/126 ok**;
- depois do rollback novo: `753e1ef8…`, igual ao estado sem a migration.

A homologação **continua com a migration antiga aplicada** (nada foi trocado de verdade). Para trocar, com
autorização: `bash t_b4e7c368/ciclo.sh aplicar` (rollback antigo + migration nova, com impressão digital antes/depois).
