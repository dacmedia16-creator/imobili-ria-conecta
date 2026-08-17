-- Reversão do script 2026-08-17_corrige_comissao_aline_duas_parcelas.sql — só use se o script de
-- correção já foi aplicado (COMMIT) e precisa ser desfeito. Mesmo princípio: trava por ID exato,
-- confere o estado atual antes de reverter (WHERE exige que o user_id esteja hoje igual ao da Aline,
-- pra não reverter uma linha que já tenha sido corrigida/alterada de novo por outro motivo), roda
-- dentro de transação sem COMMIT automático. Reverte as duas parcelas (765,05 e 617,47) juntas.

begin;

do $$
declare
  v_extra1_rows integer;
  v_occ1_rows integer;
  v_extra2_rows integer;
  v_occ2_rows integer;
begin
  -- Parcela 1 (R$ 765,05) — venda f0255f67
  update public.sale_commission_extras
  set user_id = null, sem_cadastro_confirmado = false
  where id = '8e379c07-b522-4606-bcde-feea5c9bf7ae'
    and user_id = '4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0';
  get diagnostics v_extra1_rows = row_count;

  update public.occurrence_commissions
  set user_id = null, sem_cadastro_confirmado = false
  where id = '23cc696d-7200-4544-968f-d48acb87c283'
    and user_id = '4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0';
  get diagnostics v_occ1_rows = row_count;

  -- Parcela 2 (R$ 617,47) — venda ecc306bc
  update public.sale_commission_extras
  set user_id = null, sem_cadastro_confirmado = false
  where id = 'b53062ae-841a-494f-9095-e2c0478185e0'
    and user_id = '4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0';
  get diagnostics v_extra2_rows = row_count;

  update public.occurrence_commissions
  set user_id = null, sem_cadastro_confirmado = false
  where id = 'f1bc3348-f911-435e-8e03-f0b69986eb90'
    and user_id = '4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0';
  get diagnostics v_occ2_rows = row_count;

  if v_extra1_rows <> 1 or v_occ1_rows <> 1 or v_extra2_rows <> 1 or v_occ2_rows <> 1 then
    raise exception 'Estado inesperado — parcela 1 (extra=% ocorrência=%), parcela 2 (extra=% ocorrência=%), esperado 1/1/1/1 em todas. Abortando, nada foi revertido.',
      v_extra1_rows, v_occ1_rows, v_extra2_rows, v_occ2_rows;
  end if;

  raise notice 'OK — 4 linhas revertidas (user_id voltou a null nas 2 parcelas x 2 tabelas).';
end $$;

select 'sale_commission_extras' as tabela, id, sale_id, nome, valor, user_id, sem_cadastro_confirmado
from public.sale_commission_extras where id in ('8e379c07-b522-4606-bcde-feea5c9bf7ae', 'b53062ae-841a-494f-9095-e2c0478185e0')
union all
select 'occurrence_commissions', id, occurrence_id, nome, valor, user_id, sem_cadastro_confirmado
from public.occurrence_commissions where id in ('23cc696d-7200-4544-968f-d48acb87c283', 'f1bc3348-f911-435e-8e03-f0b69986eb90')
order by 1, 2;

-- Trocar por COMMIT; só depois de conferir o SELECT acima manualmente.
rollback;
