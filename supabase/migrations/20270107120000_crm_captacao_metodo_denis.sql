-- CRM: Funil de Captação no Método Denis (t_ab39e04e; Denis 27/11, itens 1, 2 e 3; tópico 6238).
--   Captação: novo (Novo contato) → em_atendimento (Em contato) → avaliacao (1ª visita: conhecer o proprietário)
--             → proposta (2ª visita: dossiê) → acompanhamento (Acompanhamento pós-dossiê) → ganho (Captado) | perdido.
--   * SEM migrar dados (decisão do MAX Principal): avaliacao e proposta só trocam o RÓTULO na tela; nenhum UPDATE
--     em leads. A única etapa nova é 'acompanhamento', aceita só no funil de captação.
--   * Venda e locação: sem mudança (não aceitam 'acompanhamento').
--   * Próximo contato: as regras de crm_mover/crm_validar_proximo continuam (data + motivo obrigatórios). A sugestão
--     de +7 dias e os atalhos 7/10/15 são só da tela (src/lib/crm.ts, sugestaoProximo).
--   * lead_mudar_etapa: corpo copiado de PRODUÇÃO em 27/11/2026 (pg_get_functiondef); só a checagem de etapa muda.
-- Rollback: docs/sql/rollback/20270107120000_crm_captacao_metodo_denis.rollback.sql
BEGIN;

ALTER TABLE public.leads DROP CONSTRAINT leads_etapa_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_etapa_check
  CHECK (etapa IN ('novo', 'em_atendimento', 'visita_agendada', 'avaliacao', 'proposta', 'acompanhamento', 'ganho', 'perdido'));
ALTER TABLE public.leads DROP CONSTRAINT leads_etapa_do_funil;
ALTER TABLE public.leads ADD CONSTRAINT leads_etapa_do_funil
  CHECK ((funil = 'venda' AND etapa NOT IN ('avaliacao', 'acompanhamento')) OR (funil = 'captacao' AND etapa <> 'visita_agendada')
         OR (funil = 'locacao' AND etapa NOT IN ('avaliacao', 'acompanhamento')));

CREATE OR REPLACE FUNCTION public.lead_mudar_etapa(_lead uuid, _etapa text, _motivo_perda_id uuid DEFAULT NULL::uuid, _obs text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _conta boolean;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _etapa IS NULL OR _etapa NOT IN ('novo', 'em_atendimento', 'visita_agendada', 'avaliacao', 'proposta', 'acompanhamento', 'ganho', 'perdido')
     OR (_l.funil IN ('venda', 'locacao') AND _etapa IN ('avaliacao', 'acompanhamento'))
     OR (_l.funil = 'captacao' AND _etapa = 'visita_agendada') THEN
    RAISE EXCEPTION 'Etapa invalida' USING ERRCODE = '22023';
  END IF;
  IF _etapa = _l.etapa THEN RETURN _etapa; END IF;
  IF _l.etapa IN ('ganho', 'perdido') AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead encerrado: so gestor ou administrador reabre' USING ERRCODE = '42501';
  END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  IF _etapa NOT IN ('ganho', 'perdido') AND public.crm_enabled()
     AND current_setting('app.crm_mover', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Informe a data e o motivo do proximo contato' USING ERRCODE = '22023';
  END IF;
  _conta := public.lead_checar_atendimento(_l, _me);
  IF _etapa = 'perdido' THEN
    IF _motivo_perda_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.lead_motivos_perda
        WHERE id = _motivo_perda_id AND organization_id = _org AND ativo) THEN
      RAISE EXCEPTION 'Informe o motivo da perda' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- Reabrir (sair de ganho/perdido) recomeça o relógio, para o lead não voltar ao banco na hora.
  UPDATE public.leads SET etapa = _etapa, etapa_em = now(), updated_at = now(),
         motivo_perda_id = CASE WHEN _etapa = 'perdido' THEN _motivo_perda_id END,
         motivo_perda_obs = CASE WHEN _etapa = 'perdido' THEN nullif(btrim(coalesce(_obs, '')), '') END,
         proximo_contato_em = CASE WHEN _etapa IN ('ganho', 'perdido') THEN NULL ELSE proximo_contato_em END,
         proximo_contato_motivo = CASE WHEN _etapa IN ('ganho', 'perdido') THEN NULL ELSE proximo_contato_motivo END,
         ultima_interacao_em = CASE WHEN _conta OR (_l.etapa IN ('ganho', 'perdido') AND aceito_em IS NOT NULL)
                                    THEN now() ELSE ultima_interacao_em END,
         atribuido_em = CASE WHEN _l.etapa IN ('ganho', 'perdido') AND aceito_em IS NULL AND responsavel_id IS NOT NULL
                             THEN now() ELSE atribuido_em END
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, 'etapa', _l.etapa, _etapa, left(nullif(btrim(coalesce(_obs, '')), ''), 2000), _me);
  RETURN _etapa;
END $function$;

COMMIT;
