# Checklist de migrations — ADM MAX

Vale para toda migration em `supabase/migrations`. O teste `src/lib/perf-itens-1-2-migration.test.ts`
reprova o build quando a regra 1 não é cumprida.

## 1. Regra fixa: cálculo da distribuição gravado (venda_distribuicao)

Desde as migrations `20261008100000/100100/100200`, o resultado de `calcular_distribuicao_venda` fica gravado na
tabela `public.venda_distribuicao` (Painel e Financeiro leem dela). Por isso:

- **Toda migration que alterar o cálculo da distribuição** — `calcular_distribuicao_venda` ou qualquer coluna,
  tabela ou função que ela leia (`sales`, `sale_commission_extras`, `occurrences`, `occurrence_commissions`) —
  **tem de terminar recalculando todas as vendas e rodando a reconciliação**, na mesma transação:

  ```sql
  select public.venda_distribuicao_recalcular_todas();
  do $c$ begin
    if exists (select 1 from public.venda_distribuicao_conferir()) then
      raise exception 'reconciliação falhou: resultado gravado diferente do cálculo ao vivo';
    end if;
  end $c$;
  ```

- `venda_distribuicao_conferir()` vazia = 100% das vendas com gravado igual ao cálculo ao vivo.
- Se o cálculo passar a ler uma tabela nova, acrescente gatilho `zz_venda_distribuicao` nela (veja
  `trg_venda_distribuicao`) e rode `supabase/tests/perf_itens_1_2/ensaio.sh` no homolog.
- O cálculo tem de continuar determinístico (sem `now()`, data atual, usuário logado ou aleatório); caso
  contrário o resultado gravado deixa de ser válido.
- Nunca editar `venda_distribuicao` à mão.

## 2. Permissões de leitura por lista

As policies de LEITURA das tabelas de venda usam `sale_id IN (select public.vendas_visiveis_ids())` (e as listas
de co-líder/jurídico). Quem mudar `can_view_sale`, `is_lead_of`, `sale_corretores` ou as regras de co-líder/jurídico
tem de mudar a lista correspondente **na mesma migration** e rodar a equivalência
(`supabase/tests/perf_itens_1_2/ensaio.sh`: so_antigo = so_novo = 0 em todos os perfis).

## 3. Gerais

- Uma migration por etapa, idempotente (pode rodar duas vezes sem efeito novo).
- Desfazer em `supabase/rollback/<versão>_*.sql`, gerado das definições atuais de produção (leitura).
- Ensaio no homolog (`qvhyepwduhlgqwpgmpvh`) antes de produção: aplicar → testar → desfazer → reaplicar.
- Produção só com aprovação explícita de Denis e backup listado antes da primeira escrita.
