-- Rollback da migration 20261018200000_clicksign_venda.sql (cartão t_70734b3a).
-- Remove as RPCs/gatilhos da venda, restaura validate_sale_status_transition e clicksign_manage_done
-- como antes e volta clicksign_envelopes a só captação.
-- ATENÇÃO: só rode sem envelope de venda em andamento (o bloco abaixo recusa). Envelopes de venda já
-- encerrados são APAGADOS do rastreio (o contrato_assinado anexado e o histórico da venda ficam).
-- As colunas occurrence_partners.email e sales.parceria_email ficam (aditivas, podem ter dados).
-- Publicar o frontend anterior junto e remover a edge function clicksign-sale.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.clicksign_envelopes WHERE origem = 'venda' AND status IN ('sending','running')) THEN
    RAISE EXCEPTION 'Há envelope de venda em andamento: cancele na Clicksign antes do rollback';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_zz_clicksign_contrato_novo ON public.sale_documents;
DROP TRIGGER IF EXISTS trg_zz_clicksign_saiu_assinatura ON public.sales;
DROP FUNCTION IF EXISTS public.trg_clicksign_sale_contrato_novo();
DROP FUNCTION IF EXISTS public.trg_clicksign_sale_saiu_assinatura();
DROP FUNCTION IF EXISTS public.clicksign_sale_request_cancel(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_attach_signed(uuid, text, text);
DROP FUNCTION IF EXISTS public.clicksign_sale_canceled(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_mark_sent(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_notify(public.clicksign_envelopes, text, text);
DROP FUNCTION IF EXISTS public.clicksign_sale_set_status(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.clicksign_sale_resolve_extras(uuid, uuid, text[]);
DROP FUNCTION IF EXISTS public.clicksign_sale_signed(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_extra_candidates(uuid, text);
DROP FUNCTION IF EXISTS public.clicksign_mask_email(text);
DROP FUNCTION IF EXISTS public.clicksign_sale_manage_authorize(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_authorize(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_config(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_contrato(uuid);

-- clicksign_manage_done como em 20261018150000 (histórico só da captação).
CREATE OR REPLACE FUNCTION public.clicksign_manage_done(_envelope uuid, _actor uuid, _action text,
  _detail text DEFAULT NULL, _signers jsonb DEFAULT NULL, _notified boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _action IS NOT NULL AND _action NOT IN ('clicksign_aviso','clicksign_signatario') THEN
    RAISE EXCEPTION 'Ação inválida';
  END IF;
  IF _signers IS NOT NULL AND (jsonb_typeof(_signers) <> 'array'
      OR jsonb_array_length(_signers) <> jsonb_array_length(_e.signers) OR _signers::text ~ '@') THEN
    RAISE EXCEPTION 'Signatários inválidos';
  END IF;
  IF _detail IS NOT NULL AND (length(_detail) > 500 OR _detail ~ '@') THEN
    RAISE EXCEPTION 'Detalhe inválido';
  END IF;
  UPDATE public.clicksign_envelopes SET
    action_lock_until = NULL,
    signers = coalesce(_signers, signers),
    last_notified_at = CASE WHEN _notified THEN now() ELSE last_notified_at END,
    -- Aviso confirmado: some o alerta "notificação falhou" do envio.
    error_code = CASE WHEN _notified AND error_code LIKE 'notify_failed:%' THEN NULL ELSE error_code END,
    updated_at = now()
  WHERE id = _envelope;
  IF _action IS NOT NULL THEN
    INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
      VALUES (_e.capture_id, coalesce(_actor, _e.created_by), _action, _detail);
  END IF;
END $$;

-- Chave da venda (t_a5b81fe6): a captação não lê esta coluna.
ALTER TABLE public.clicksign_org_settings DROP COLUMN IF EXISTS sale_enabled;

DROP POLICY IF EXISTS clicksign_envelopes_read_venda ON public.clicksign_envelopes;
REVOKE SELECT (origem, sale_id, cancel_requested_at, cancel_reason) ON public.clicksign_envelopes FROM authenticated;
DELETE FROM public.clicksign_envelopes WHERE origem = 'venda';
DROP INDEX IF EXISTS public.clicksign_envelopes_venda_um_ativo;
DROP INDEX IF EXISTS public.clicksign_envelopes_sale_idx;
ALTER TABLE public.clicksign_envelopes
  DROP CONSTRAINT IF EXISTS clicksign_envelopes_sale_fk,
  DROP CONSTRAINT IF EXISTS clicksign_envelopes_alvo_check,
  DROP CONSTRAINT IF EXISTS clicksign_envelopes_origem_check,
  DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS cancel_requested_at,
  DROP COLUMN IF EXISTS sale_id,
  ALTER COLUMN capture_id SET NOT NULL,
  ADD CONSTRAINT clicksign_envelopes_origem_check CHECK (origem IN ('captacao'));

-- RPCs da ocorrência como antes (sem copiar parceria_email; a coluna continua existindo).
CREATE OR REPLACE FUNCTION public.criar_ocorrencia_completa(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_sale sales%rowtype;
  v_payment sale_payment%rowtype;
  v_vendedor_nome text;
  v_comprador_nome text;
  v_occ_id uuid;
  v_dist jsonb;
begin
  -- O lock por venda serializa cliques/requisições concorrentes e, junto da UNIQUE(sale_id),
  -- impede ocorrência duplicada até quando duas ações chegam praticamente ao mesmo tempo.
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.status::text in ('cancelada', 'arquivada') then
    raise exception 'Não é possível criar Ocorrência para uma venda cancelada ou arquivada.' using errcode = '23514';
  end if;

  -- Valida também quando a ocorrência já existe: enviar ao Financeiro nunca pode contornar
  -- uma inconsistência surgida depois da criação inicial.
  v_dist := calcular_distribuicao_venda(v_sale);
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível criar ou sincronizar a Ocorrência: %', (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
  end if;

  select id into v_occ_id from occurrences where sale_id = p_sale_id;
  if v_occ_id is not null then
    -- sync_occurrence_commissions preserva linhas manuais do Financeiro
    -- (managed_by_sale = false) e atualiza somente as gerenciadas pela venda.
    perform sync_occurrence_commissions(p_sale_id);
    return jsonb_build_object('occurrence_id', v_occ_id, 'created', false);
  end if;

  select * into v_payment from sale_payment where sale_id = p_sale_id;
  select nome into v_vendedor_nome from sale_parties where sale_id = p_sale_id and papel = 'vendedor_1';
  select nome into v_comprador_nome from sale_parties where sale_id = p_sale_id and papel = 'comprador_1';

  insert into occurrences (
    sale_id, codigo_imovel, data_assinatura, tempo_venda_dias, midia,
    valor_anunciado, valor_negociado, percentual_comissao, valor_comissao,
    financiamento, financiamento_valor, financiamento_banco, financiamento_correspondente, financiamento_previsao, oba_credito,
    prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma,
    prev_recebimento2_valor, prev_recebimento2_data, prev_recebimento2_forma,
    prev_recebimento3_valor, prev_recebimento3_data, prev_recebimento3_forma,
    observacoes, status
  ) values (
    p_sale_id, coalesce(v_sale.imovel_id, v_sale.codigo_interno), coalesce(v_sale.data_assinatura, current_date), v_sale.tempo_venda_dias, v_sale.midia,
    v_sale.valor_anunciado, v_sale.valor_negociado, v_sale.percentual_comissao,
    coalesce((v_dist->>'comissao_bruta')::numeric, v_sale.valor_total_comissao),
    coalesce(v_payment.financiamento, false), v_payment.financiamento_valor, v_payment.financiamento_banco, v_payment.financiamento_correspondente, v_payment.financiamento_previsao, coalesce(v_payment.oba_credito, false),
    v_sale.previsao_recebimento_valor, v_sale.previsao_recebimento_data, v_sale.previsao_recebimento_forma,
    v_sale.previsao_recebimento2_valor, v_sale.previsao_recebimento2_data, v_sale.previsao_recebimento2_forma,
    v_sale.previsao_recebimento3_valor, v_sale.previsao_recebimento3_data, v_sale.previsao_recebimento3_forma,
    nullif(concat_ws(' | ',
      case when v_vendedor_nome is not null then 'Vendedor/Proprietário: ' || v_vendedor_nome end,
      case when v_comprador_nome is not null then 'Comprador: ' || v_comprador_nome end
    ), ''),
    'pendente'
  )
  returning id into v_occ_id;

  perform sync_occurrence_commissions(p_sale_id);

  if v_sale.parceria_tipo is not null then
    insert into occurrence_partners (occurrence_id, from_sale, tipo, nome, cpf_cnpj, percentual, valor, banco, agencia, conta, pix)
    values (v_occ_id, true, v_sale.parceria_tipo, v_sale.parceria_nome, v_sale.parceria_cpf_cnpj, v_sale.parceria_percentual, v_sale.parceria_valor, v_sale.parceria_banco, v_sale.parceria_agencia, v_sale.parceria_conta, v_sale.parceria_pix);
  end if;

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'occurrence_created', jsonb_build_object('occurrence_id', v_occ_id, 'automatic', true));

  return jsonb_build_object('occurrence_id', v_occ_id, 'created', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_ocorrencia_antes_financeiro(p_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale public.sales%rowtype;
  v_payment public.sale_payment%rowtype;
  v_occ_id uuid;
begin
  select * into v_sale
  from public.sales
  where id = p_sale_id;

  if not found
     or v_sale.modalidade = 'lancamento'
     or v_sale.status::text not in (
       'aguardando_assinatura',
       'contrato_assinado',
       'ocorrencia_pendente',
       'ocorrencia_devolvida_gestor'
     ) then
    return;
  end if;

  select id into v_occ_id
  from public.occurrences
  where sale_id = p_sale_id
    and status = 'pendente';

  if v_occ_id is null then
    return;
  end if;

  select * into v_payment
  from public.sale_payment
  where sale_id = p_sale_id;

  update public.occurrences
  set
    valor_anunciado = v_sale.valor_anunciado,
    valor_negociado = v_sale.valor_negociado,
    percentual_comissao = v_sale.percentual_comissao,
    valor_comissao = coalesce(
      v_sale.valor_total_comissao,
      case
        when v_sale.valor_negociado is not null and v_sale.percentual_comissao is not null
          then round(v_sale.valor_negociado * v_sale.percentual_comissao / 100, 2)
        else null
      end
    ),
    prev_recebimento_valor = v_sale.previsao_recebimento_valor,
    prev_recebimento_data = v_sale.previsao_recebimento_data,
    prev_recebimento_forma = v_sale.previsao_recebimento_forma,
    prev_recebimento2_valor = v_sale.previsao_recebimento2_valor,
    prev_recebimento2_data = v_sale.previsao_recebimento2_data,
    prev_recebimento2_forma = v_sale.previsao_recebimento2_forma,
    prev_recebimento3_valor = v_sale.previsao_recebimento3_valor,
    prev_recebimento3_data = v_sale.previsao_recebimento3_data,
    prev_recebimento3_forma = v_sale.previsao_recebimento3_forma,
    financiamento = coalesce(v_payment.financiamento, false),
    financiamento_valor = v_payment.financiamento_valor,
    financiamento_banco = v_payment.financiamento_banco,
    financiamento_correspondente = v_payment.financiamento_correspondente,
    financiamento_previsao = v_payment.financiamento_previsao,
    oba_credito = coalesce(v_payment.oba_credito, false)
  where id = v_occ_id;

  perform public.sync_occurrence_commissions(p_sale_id);

  if v_sale.parceria_tipo is null then
    delete from public.occurrence_partners
    where occurrence_id = v_occ_id
      and from_sale = true;
  else
    update public.occurrence_partners
    set
      tipo = v_sale.parceria_tipo,
      nome = v_sale.parceria_nome,
      cpf_cnpj = v_sale.parceria_cpf_cnpj,
      percentual = v_sale.parceria_percentual,
      valor = v_sale.parceria_valor
    where occurrence_id = v_occ_id
      and from_sale = true;

    if not found then
      insert into public.occurrence_partners (
        occurrence_id, from_sale, tipo, nome, cpf_cnpj, percentual, valor,
        banco, agencia, conta, pix
      ) values (
        v_occ_id, true, v_sale.parceria_tipo, v_sale.parceria_nome,
        v_sale.parceria_cpf_cnpj, v_sale.parceria_percentual, v_sale.parceria_valor,
        v_sale.parceria_banco, v_sale.parceria_agencia, v_sale.parceria_conta,
        v_sale.parceria_pix
      );
    end if;
  end if;
end;
$function$;
COMMIT;
-- validate_sale_status_transition: reaplique o bloco CREATE OR REPLACE de
-- supabase/migrations/20261009070000_criador_edita_rascunho.sql (versão anterior, sem o bloco Clicksign).
-- O bloco novo só libera transições sem usuário logado E com a marca clicksign.sale; sem as RPCs acima
-- ninguém define essa marca, então manter a versão nova também é seguro.
