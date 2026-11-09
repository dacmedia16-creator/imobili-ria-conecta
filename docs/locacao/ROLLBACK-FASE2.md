# Rollback — Locação Fase 2, Financeiro parte 1 (t_be750361)

Nada disto está em produção. O PR é RASCUNHO e só é publicado com um novo "sim" de Denis.

## O que a mudança cria
- Migration `supabase/migrations/20261111120000_locacao_fase2_financeiro.sql`, só ADITIVA:
  - Papel `financeiro` dentro de `locacao_papeis`. **Não** é a app_role global `financeiro`.
  - Tabelas `locacao_fin_config`, `locacao_contratos`, `locacao_cobrancas`, `locacao_fin_descontos`, `locacao_repasses` e `locacao_fin_eventos`. Todas com RLS ligada e sem acesso direto do navegador. O histórico só aceita inserção, porque um trigger bloqueia UPDATE.
  - Funções `locacao_fin_*` e a trigger `locacao_fin_contrato_na_chave` em `locacoes`, que cria o contrato "a completar" quando as chaves são entregues.
  - Na aplicação, as locações que **já** tiverem chave entregue ganham um contrato "a completar". Nenhuma cobrança é gerada sozinha.
  - Redefine 3 funções da Fase 1, que voltam como eram no rollback: `locacao_pode_ver` (o papel financeiro sozinho não vê a esteira), `locacao_contexto` (lista o papel financeiro) e `locacao_papel_definir` (aceita o papel financeiro).
- Front: aba **Financeiro** em `/locacoes`, com Painel, Contratos, Repasse e extrato e Regras financeiras. O papel aparece na tela "Regras e papéis".
- Não altera vendas, captação, leads, usuários nem `user_roles`. Não chama Itaú nem envia mensagem. Não gera boleto e não move dinheiro.

## Desligar sem apagar nada (mais rápido, reversível)
- Tirar o papel "Financeiro da locação" das pessoas, em Locação → Regras e papéis. A aba some e todas as RPCs `locacao_fin_*` passam a recusar.
- Para desligar toda a locação: Plataforma → Imobiliárias → Módulos → desmarcar "Locação".

## Desfazer o banco (apaga o histórico financeiro)
1. **Antes, em produção**, exportar os dados para guardar:
   `pg_dump -t 'public.locacao_contratos' -t 'public.locacao_cobrancas' -t 'public.locacao_fin_*' -t 'public.locacao_repasses' -Fc`.
2. Rodar `supabase/rollback/20261111120000_locacao_fase2_financeiro.sql` e apagar a linha `20261111120000` de `supabase_migrations.schema_migrations`.
3. A Fase 1 fica intacta. As 3 funções voltam com o texto literal da migration `20261110120000`, copiado por script.

## Conferência feita (homologação qvhyepwduhlgqwpgmpvh)
- Backup prévio: `pre-t_be750361-20261109T231635Z.dump`.
- Impressão digital do esquema:
  - Fase 1 = `b3c3d68d…`
  - Fase 1 + Fase 2 = `00fa28d5…` (depois do ajuste de rótulo, `06b02d49…`)
  - Depois do rollback da Fase 2, volta a `b3c3d68d…`
  - Depois de desfazer também a Fase 1 (que a homologação não tinha), volta a `b0e4b785…`, o estado original.
- Suíte `supabase/tests/run-locacao-fin.sh`, numa transação desfeita:
  - Fase 2: 80/80.
  - Regressão da Fase 1 com a Fase 2 aplicada: 81/81.
  - Impressão digital igual antes e depois do rollback.

## Desfazer o código
Basta não fazer merge, ou dar `git revert` no merge. Código e banco precisam voltar juntos, porque a tela chama as RPCs `locacao_fin_*`.

## Teste
- `PGCONN=<homologação> bash supabase/tests/run-locacao-fin.sh` (nunca produção).
- `npx vitest run src/lib/locacao`.
