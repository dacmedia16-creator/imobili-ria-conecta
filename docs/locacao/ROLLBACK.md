# Rollback — Módulo de Locação Fase 1 (t_74426f94)

Nada disto está em produção. Este PR é RASCUNHO; publicação só com novo "sim" de Denis.

## O que a mudança cria
- Migration `supabase/migrations/20261110120000_locacao_fase1.sql` (ADITIVA): módulo `locacao` (nasce DESLIGADO em todas as imobiliárias), tabelas `locacao_config`, `locacao_papeis`, `locacoes`, `locacao_documentos`, `locacao_eventos` (RLS ligada, sem acesso direto do navegador), funções `locacao_*`, bucket privado `locacao-documentos`.
- Front: rotas `/locacoes` e `/locacoes/$id`, item "Locação" no menu (só com o módulo ligado), módulo na tela da Plataforma.
- Não altera venda, captação, leads, usuários nem papéis do sistema.

## Desligar sem apagar nada (mais rápido, reversível)
Plataforma → Imobiliárias → (imobiliária) → Módulos → desmarcar "Locação". O menu some e todas as RPCs recusam.

## Desfazer o banco
1. Se o bucket tiver arquivos: Supabase → Storage → `locacao-documentos` → selecionar tudo → Delete (a API exige isso).
2. Rodar `supabase/rollback/20261110120000_locacao_fase1.sql` e apagar a linha `20261110120000` de `supabase_migrations.schema_migrations`.
3. Conferência: na homologação, impressão digital do esquema antes = depois do rollback (`012a4a83…`), suíte `supabase/tests/run-locacao.sh` 81/81.

## Desfazer o código
`git revert` do merge do PR (ou não mergear). Reverter código E banco juntos: a tela de Módulos lista `locacao` e o CHECK antigo não aceitaria.

## Teste
`PGCONN=<homologação> bash supabase/tests/run-locacao.sh` (transação desfeita, nunca produção) e `npx vitest run src/lib/locacao.test.ts`.
