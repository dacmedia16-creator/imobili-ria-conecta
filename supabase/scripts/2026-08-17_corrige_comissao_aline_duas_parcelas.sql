-- NÃO É UMA MIGRATION — não roda em `supabase db push` nem em qualquer aplicação automática.
-- Script manual, de aplicação única, pra rodar SÓ depois que alguém confirmar humanamente que
-- "Aline Rodrigues" em cada uma das duas vendas abaixo é de fato a Aline de Souza Rodrigues (perfil
-- único, sem ambiguidade — não existe outro profiles.nome ilike '%aline%'). Não faz correspondência
-- por nome sozinho: os WHERE de cada UPDATE travam por ID exato de linha, e cada valor esperado é
-- conferido antes de escrever (se algo mudou desde a reconciliação, o UPDATE simplesmente não afeta
-- nenhuma linha — RAISE NOTICE avisa qual das quatro).
--
-- PRÉ-REQUISITO: migration 20260817020000_exige_confirmacao_sem_cadastro.sql já aplicada (cria a
-- coluna sem_cadastro_confirmado usada abaixo).
--
-- Substitui o script anterior (2026-08-17_corrige_comissao_aline_venda_f0255f67.sql, só a 1ª parcela)
-- — agora cobre as DUAS parcelas encontradas na auditoria com a mesma causa confirmada: linha criada
-- com nome digitado livre em vez de selecionar da lista, user_id nunca preenchido, copiada 1:1 de
-- sale_commission_extras pra occurrence_commissions por criar_ocorrencia_lancamento() (sem qualquer
-- correspondência automática por nome).
--
-- Parcela 1 — Venda f0255f67-793d-4535-b496-d8371bd049f8 (Lançamento, ocorrencia_analise_financeiro)
--   Ocorrência a8cc7380-d6d1-4d52-a52c-3c1fe997f9f3 — papel coordenador_lancamento, 5%, R$ 765,05.
--   Confirmada na reconciliação anterior (Virginia Aranha R$ 7.335,45 e Gustavo Fuentes R$ 3.060,20
--   já vinculados corretamente na mesma ocorrência; só a linha da Aline ficou sem user_id).
--
-- Parcela 2 — Venda ecc306bc-c8ff-4c15-a394-064523ac6b50 (Lançamento, ocorrencia_concluida)
--   Ocorrência f6322757-716f-4d24-8a15-528caa181a38 — papel coordenador_lancamento, 5%, R$ 617,47.
--   Mesmo padrão exato: Virginia Aranha (45%, R$ 5.557,26) e Gustavo Fuentes (20%, R$ 2.469,89) já
--   vinculados corretamente na mesma ocorrência; só a linha da Aline ficou sem user_id. Nesta venda
--   Aline também é sales.corretor_id (quem cadastrou/reportou) — papel diferente do de beneficiária
--   coordenadora aqui tratado; confirmado que não existe nenhuma outra linha de occurrence_commissions
--   nesta ocorrência já creditando o user_id dela, então este UPDATE não duplica crédito.
--
-- Perfil confirmado (único, sem ambiguidade) para as duas parcelas:
--   Aline de Souza Rodrigues — 4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0
--
-- A diferença de R$ 2,00 na parcela da Virginia (R$ 7.335,45 real vs R$ 7.333,45 citado em conversa)
-- permanece FORA de escopo — nada relacionado à Virginia é alterado por este script.

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
  set user_id = '4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0', sem_cadastro_confirmado = false
  where id = '8e379c07-b522-4606-bcde-feea5c9bf7ae'
    and sale_id = 'f0255f67-793d-4535-b496-d8371bd049f8'
    and nome = 'Aline Rodrigues'
    and papel = 'coordenador_lancamento'
    and valor = 765.05
    and user_id is null;
  get diagnostics v_extra1_rows = row_count;

  update public.occurrence_commissions
  set user_id = '4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0', sem_cadastro_confirmado = false
  where id = '23cc696d-7200-4544-968f-d48acb87c283'
    and occurrence_id = 'a8cc7380-d6d1-4d52-a52c-3c1fe997f9f3'
    and nome = 'Aline Rodrigues'
    and papel = 'coordenador_lancamento'
    and valor = 765.05
    and user_id is null;
  get diagnostics v_occ1_rows = row_count;

  -- Parcela 2 (R$ 617,47) — venda ecc306bc
  update public.sale_commission_extras
  set user_id = '4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0', sem_cadastro_confirmado = false
  where id = 'b53062ae-841a-494f-9095-e2c0478185e0'
    and sale_id = 'ecc306bc-c8ff-4c15-a394-064523ac6b50'
    and nome = 'Aline Rodrigues'
    and papel = 'coordenador_lancamento'
    and valor = 617.47
    and user_id is null;
  get diagnostics v_extra2_rows = row_count;

  update public.occurrence_commissions
  set user_id = '4816fb2f-dddf-4c6f-a93e-7b7c56ddf8c0', sem_cadastro_confirmado = false
  where id = 'f1bc3348-f911-435e-8e03-f0b69986eb90'
    and occurrence_id = 'f6322757-716f-4d24-8a15-528caa181a38'
    and nome = 'Aline Rodrigues'
    and papel = 'coordenador_lancamento'
    and valor = 617.47
    and user_id is null;
  get diagnostics v_occ2_rows = row_count;

  if v_extra1_rows <> 1 or v_occ1_rows <> 1 or v_extra2_rows <> 1 or v_occ2_rows <> 1 then
    raise exception 'Estado inesperado — parcela 1 (extra=% ocorrência=%), parcela 2 (extra=% ocorrência=%), esperado 1/1/1/1 em todas (o dado pode já ter mudado desde a reconciliação). Abortando, nada foi gravado.',
      v_extra1_rows, v_occ1_rows, v_extra2_rows, v_occ2_rows;
  end if;

  raise notice 'OK — 4 linhas corrigidas (2 parcelas x 2 tabelas cada).';
end $$;

-- Confira o resultado ANTES de fechar a transação (SELECT abaixo, ainda dentro do BEGIN/COMMIT).
-- Se os valores baterem com o esperado, troque o ROLLBACK por COMMIT manualmente — este script não
-- comita sozinho de propósito.
select 'sale_commission_extras' as tabela, id, sale_id, nome, valor, user_id, sem_cadastro_confirmado
from public.sale_commission_extras where id in ('8e379c07-b522-4606-bcde-feea5c9bf7ae', 'b53062ae-841a-494f-9095-e2c0478185e0')
union all
select 'occurrence_commissions', id, occurrence_id, nome, valor, user_id, sem_cadastro_confirmado
from public.occurrence_commissions where id in ('23cc696d-7200-4544-968f-d48acb87c283', 'f1bc3348-f911-435e-8e03-f0b69986eb90')
order by 1, 2;

-- Trocar por COMMIT; só depois de conferir o SELECT acima manualmente.
rollback;
