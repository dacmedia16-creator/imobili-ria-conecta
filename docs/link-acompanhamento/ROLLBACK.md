# ROLLBACK — Link de acompanhamento (PR feat/link-acompanhamento, migration 20261108200000)

Cartões t_54c79bdc (construção) e t_950ee1e1 (homologação). **Nada disto está em produção.** Use este roteiro só
depois de uma publicação autorizada por Denis. Do mais leve ao mais pesado, pare no primeiro que resolver.

## 1. Desligar a chave (segundos, sem deploy, sem perder nada)

O módulo `link_acompanhamento` é por imobiliária e nasce desligado.

- **Pela tela:** Plataforma → Imobiliárias → Módulos → desligar "Link de acompanhamento" na imobiliária.
- **Por SQL (Management API, produção `xvvymgurpchhlmbpjbgc`, com autorização):**

```sql
UPDATE public.organization_modules SET enabled = false, updated_at = now()
 WHERE module = 'link_acompanhamento' AND organization_id = '<org>';
```

Efeito: todos os links daquela imobiliária passam a mostrar "Este link não está mais disponível. Fale com o seu
corretor." e o bloco some da tela da venda. Os links e as contagens continuam guardados. Religar = `enabled = true`,
e os MESMOS links voltam a abrir.

**Desligar um link só:** na venda, use "Desligar e gerar outro" (o link antigo para de abrir na hora).

## 2. Reverter o front (PR)

1. `gh pr view <nº> --json mergeCommit` para achar o merge na `main`.
2. `git revert -m 1 <merge>` numa branch → PR → merge.
3. `npm run deploy:safe` a partir da `main` (worktree de release). Para voltar mais rápido sem build, use
   `wrangler rollback <versão anterior>` (anote a versão no deploy).

Sem o front, a rota `/acompanhar/$token` deixa de existir (404) e o bloco sai da venda. O banco pode ficar como está,
porque nada no app antigo usa as tabelas novas.

## 3. Reverter o banco (SQL) — só se precisar apagar tudo

Arquivo: `supabase/rollback/20261108200000_link_acompanhamento.sql`. Antes, faça backup
(`bash /root/.config/max/adm-max-prod-pg/backup-prod.sh pre-rollback-link`) e reverta o front (passo 2):
a tela de Módulos lista `link_acompanhamento`, e o CHECK deixaria de aceitar o valor.

O que ele faz: apaga as 10 funções `acompanhamento_*`, as tabelas `sale_acompanhamento_links` e
`sale_acompanhamento_tentativas`, a chave HMAC `acompanhamento_link_chave` do Vault, a coluna
`organizations.google_avaliacao_url` (o "Link de avaliação no Google" digitado se perde), as funções do módulo e as
linhas `link_acompanhamento` de `organization_modules`. Também devolve o CHECK e `platform_set_organization_module` à
versão da 20261108180000. **Não toca** em vendas, partes, histórico de status nem no histórico de liga/desliga.

Para aplicar com registro do histórico de migrations numa transação só:

```sql
BEGIN;
-- conteúdo do arquivo de rollback, sem as linhas BEGIN; / COMMIT;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261108200000';
COMMIT;
```

Depois do rollback, todos os links já enviados param de abrir de vez. Reaplicar a migration gera uma chave nova,
e os links antigos NÃO voltam (é preciso copiar e mandar os novos).

## Provado na homologação (t_950ee1e1)

Na homologação `qvhyepwduhlgqwpgmpvh`, o ciclo migration → rollback → reaplicar deu impressão digital do esquema
A = C = `b8f23505…` (sem a migration) e B = D = `c2ec0800…` (com a migration). A suíte
`supabase/tests/run-link-acompanhamento.sh` deu 64/64, e a impressão digital antes e depois do rollback foi igual.
