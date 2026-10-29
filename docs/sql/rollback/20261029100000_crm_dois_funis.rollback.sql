-- Rollback da migration 20261029100000_crm_dois_funis.sql (card t_188fb282).
-- Volta ao módulo Leads de antes do CRM: some o módulo "crm", as RPCs crm_*, as colunas funil /
-- próximo contato / vínculos e a etapa "avaliacao"; lead_mudar_etapa e platform_set_organization_module
-- voltam à versão anterior (20261025150000 e 20261025120000).
-- ATENÇÃO, perde dados do CRM: funil, próximo contato e vínculos lead→venda/captação. As vendas e as
-- captações criadas pela conversão NÃO são apagadas (ficam como registros normais).
-- Leads em "avaliacao" voltam para "em_atendimento" e leads do funil de captação passam a ser leads comuns.
-- Antes de rodar: publique (git revert + deploy:safe) a versão do app sem a tela do CRM, ou desligue o
-- módulo CRM na imobiliária — senão a tela do CRM mostra erro.
BEGIN;

DROP FUNCTION IF EXISTS public.crm_mover(uuid, text, date, text, uuid, text);
DROP FUNCTION IF EXISTS public.crm_proximo_contato(uuid, date, text);
DROP FUNCTION IF EXISTS public.crm_definir_funil(uuid, text);
DROP FUNCTION IF EXISTS public.crm_converter_venda(uuid);
DROP FUNCTION IF EXISTS public.crm_converter_captacao(uuid, uuid);
DROP FUNCTION IF EXISTS public.crm_validar_proximo(date, text);
DROP FUNCTION IF EXISTS public.crm_ctx();

-- lead_mudar_etapa da 20261025150000 (sem funil e sem próximo contato).
CREATE OR REPLACE FUNCTION public.lead_mudar_etapa(_lead uuid, _etapa text,
  _motivo_perda_id uuid DEFAULT NULL, _obs text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _conta boolean;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _etapa IS NULL OR _etapa NOT IN ('novo', 'em_atendimento', 'visita_agendada', 'proposta', 'ganho', 'perdido') THEN
    RAISE EXCEPTION 'Etapa invalida' USING ERRCODE = '22023';
  END IF;
  IF _etapa = _l.etapa THEN RETURN _etapa; END IF;
  IF _l.etapa IN ('ganho', 'perdido') AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead encerrado: so gestor ou administrador reabre' USING ERRCODE = '42501';
  END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  _conta := public.lead_checar_atendimento(_l, _me);
  IF _etapa = 'perdido' THEN
    IF _motivo_perda_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.lead_motivos_perda
        WHERE id = _motivo_perda_id AND organization_id = _org AND ativo) THEN
      RAISE EXCEPTION 'Informe o motivo da perda' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.leads SET etapa = _etapa, etapa_em = now(), updated_at = now(),
         motivo_perda_id = CASE WHEN _etapa = 'perdido' THEN _motivo_perda_id END,
         motivo_perda_obs = CASE WHEN _etapa = 'perdido' THEN nullif(btrim(coalesce(_obs, '')), '') END,
         ultima_interacao_em = CASE WHEN _conta OR (_l.etapa IN ('ganho', 'perdido') AND aceito_em IS NOT NULL)
                                    THEN now() ELSE ultima_interacao_em END,
         atribuido_em = CASE WHEN _l.etapa IN ('ganho', 'perdido') AND aceito_em IS NULL AND responsavel_id IS NOT NULL
                             THEN now() ELSE atribuido_em END
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, 'etapa', _l.etapa, _etapa, left(nullif(btrim(coalesce(_obs, '')), ''), 2000), _me);
  RETURN _etapa;
END $$;

-- Etapa "avaliacao" e eventos novos.
UPDATE public.leads SET etapa = 'em_atendimento' WHERE etapa = 'avaliacao';
DELETE FROM public.lead_eventos WHERE tipo IN ('proximo_contato', 'convertido', 'funil');
ALTER TABLE public.lead_eventos DROP CONSTRAINT lead_eventos_tipo_check;
ALTER TABLE public.lead_eventos ADD CONSTRAINT lead_eventos_tipo_check
  CHECK (tipo IN ('criado', 'etapa', 'atribuido', 'nota', 'vinculo',
                  'aceite', 'devolvido_banco', 'redistribuido', 'ligacao', 'ia'));
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_etapa_do_funil;
ALTER TABLE public.leads DROP CONSTRAINT leads_etapa_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_etapa_check
  CHECK (etapa IN ('novo', 'em_atendimento', 'visita_agendada', 'proposta', 'ganho', 'perdido'));

-- Colunas (os índices e constraints delas saem junto).
DROP INDEX IF EXISTS public.leads_fila_idx;
ALTER TABLE public.leads
  DROP COLUMN IF EXISTS funil, DROP COLUMN IF EXISTS proximo_contato_em, DROP COLUMN IF EXISTS proximo_contato_motivo,
  DROP COLUMN IF EXISTS sale_id, DROP COLUMN IF EXISTS capture_convertida_id, DROP COLUMN IF EXISTS convertido_em;

-- Módulo.
DROP FUNCTION IF EXISTS public.crm_enabled();
DROP FUNCTION IF EXISTS public.crm_hoje();
DELETE FROM public.organization_modules WHERE module = 'crm';
-- organization_module_history fica como está (é histórico de auditoria e não tem lista de módulos).
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;

COMMIT;
