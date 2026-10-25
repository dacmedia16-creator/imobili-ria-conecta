-- Rollback da migration 20261025150000_leads_p2p3_distribuicao.sql (card t_9a8dccc7).
-- Volta o módulo de leads ao estado do P1 (20261025120000). Leads e linha do tempo do P1 ficam;
-- somem: colunas de aceite/banco/simulado/consentimento, rodízio, formulário público, tarefa agendada.
-- ATENÇÃO: apaga da linha do tempo os eventos dos tipos novos (aceite, devolvido_banco, redistribuido,
-- ligacao) — no piloto são só dados de teste da ZZ. Antes, desligue o módulo pelo painel Plataforma.
-- As funções do P1 abaixo são cópia literal de supabase/migrations/20261025120000_leads_piloto.sql.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'leads-prazos';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.leads_processar_prazos();
DROP FUNCTION IF EXISTS public.lead_form_enviar(text, text, text, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.lead_form_info(text);
DROP FUNCTION IF EXISTS public.lead_form_configurar(boolean);
DROP FUNCTION IF EXISTS public.lead_config_salvar(integer, integer, integer, text);
DROP FUNCTION IF EXISTS public.lead_simular(integer, text, boolean);
DROP FUNCTION IF EXISTS public.lead_pegar(uuid);
DROP FUNCTION IF EXISTS public.lead_banco_listar();
DROP FUNCTION IF EXISTS public.lead_aceitar(uuid);
DROP FUNCTION IF EXISTS public.lead_registrar_ligacao(uuid, text);
DROP FUNCTION IF EXISTS public.lead_checar_atendimento(public.leads, uuid);
DROP FUNCTION IF EXISTS public.lead_inserir(uuid, text, text, text, text, text, uuid, uuid, boolean, text, text);
DROP FUNCTION IF EXISTS public.lead_distribuir(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.lead_mandar_banco(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.lead_prazo_txt(integer);
DROP FUNCTION IF EXISTS public.lead_notificar(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.lead_ja_recebeu(uuid);
DROP FUNCTION IF EXISTS public.lead_rodizio_proximo(uuid, uuid, uuid[]);
DROP TABLE IF EXISTS public.lead_form_tentativas;

DELETE FROM public.lead_eventos WHERE tipo IN ('aceite', 'devolvido_banco', 'redistribuido', 'ligacao');
ALTER TABLE public.lead_eventos DROP CONSTRAINT lead_eventos_tipo_check;
ALTER TABLE public.lead_eventos ADD CONSTRAINT lead_eventos_tipo_check
  CHECK (tipo IN ('criado', 'etapa', 'atribuido', 'nota', 'vinculo'));

DROP INDEX IF EXISTS public.leads_prazos_idx;
DROP INDEX IF EXISTS public.leads_banco_idx;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_banco_sem_responsavel;
ALTER TABLE public.leads
  DROP COLUMN IF EXISTS consentimento_texto, DROP COLUMN IF EXISTS consentimento_em,
  DROP COLUMN IF EXISTS simulado, DROP COLUMN IF EXISTS tentativas_aceite,
  DROP COLUMN IF EXISTS no_banco_desde, DROP COLUMN IF EXISTS ultima_interacao_em,
  DROP COLUMN IF EXISTS aceito_em;

DROP INDEX IF EXISTS public.lead_config_form_token_uniq;
ALTER TABLE public.lead_config
  DROP COLUMN IF EXISTS form_token, DROP COLUMN IF EXISTS form_publico_ativo,
  DROP COLUMN IF EXISTS rodizio_ultimo_id, DROP COLUMN IF EXISTS prazo_sem_interacao_dias,
  DROP COLUMN IF EXISTS prazo_primeira_interacao_dias;

-- Funções do P1 (texto original):
CREATE OR REPLACE FUNCTION public.leads_responsaveis_visiveis() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() WHERE auth.uid() IS NOT NULL
  UNION
  SELECT tm.membro_id FROM public.team_members tm
   WHERE auth.uid() IS NOT NULL AND tm.organization_id = public.current_org_id()
     AND public.has_role(auth.uid(), 'team_leader'::public.app_role)
     AND public.leads_team_or_parent(tm.team_id, auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.lead_criar(_nome text, _telefone text, _email text, _origem text,
  _mensagem text DEFAULT NULL, _capture_id uuid DEFAULT NULL, _responsavel_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _id uuid; _captador uuid;
  _tel text := nullif(regexp_replace(coalesce(_telefone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador cadastra lead' USING ERRCODE = '42501';
  END IF;
  IF _origem IS NULL OR _origem NOT IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro') THEN
    RAISE EXCEPTION 'Origem invalida' USING ERRCODE = '22023';
  END IF;
  IF _capture_id IS NOT NULL THEN
    SELECT c.captor_id INTO _captador FROM public.exclusive_captures c
     WHERE c.id = _capture_id AND c.organization_id = _org AND c.discarded_at IS NULL AND c.archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Captacao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  END IF;
  IF _responsavel_id IS NOT NULL AND NOT public.lead_pode_ser_responsavel(_responsavel_id, _org) THEN
    RAISE EXCEPTION 'Responsavel invalido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.leads (organization_id, nome, telefone, email, origem, mensagem, capture_id, captador_id,
                            responsavel_id, atribuido_em, created_by)
  VALUES (_org, btrim(_nome), _tel, nullif(lower(btrim(coalesce(_email, ''))), ''), _origem,
          nullif(btrim(coalesce(_mensagem, '')), ''), _capture_id, _captador,
          _responsavel_id, CASE WHEN _responsavel_id IS NOT NULL THEN now() END, _me)
  RETURNING id INTO _id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_org, _id, 'criado', _origem, _me);
  IF _capture_id IS NOT NULL THEN
    -- Registra o imóvel e o captador (D4) na linha do tempo.
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
    VALUES (_org, _id, 'vinculo', _captador::text, _me);
  END IF;
  IF _responsavel_id IS NOT NULL THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
    VALUES (_org, _id, 'atribuido', _responsavel_id::text, _me);
  END IF;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.lead_mudar_etapa(_lead uuid, _etapa text,
  _motivo_perda_id uuid DEFAULT NULL, _obs text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads;
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
  IF _etapa = 'perdido' THEN
    IF _motivo_perda_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.lead_motivos_perda
        WHERE id = _motivo_perda_id AND organization_id = _org AND ativo) THEN
      RAISE EXCEPTION 'Informe o motivo da perda' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.leads SET etapa = _etapa, etapa_em = now(), updated_at = now(),
         motivo_perda_id = CASE WHEN _etapa = 'perdido' THEN _motivo_perda_id END,
         motivo_perda_obs = CASE WHEN _etapa = 'perdido' THEN nullif(btrim(coalesce(_obs, '')), '') END
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, 'etapa', _l.etapa, _etapa, left(nullif(btrim(coalesce(_obs, '')), ''), 2000), _me);
  RETURN _etapa;
END $$;

CREATE OR REPLACE FUNCTION public.lead_atribuir(_lead uuid, _responsavel_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador atribui lead' USING ERRCODE = '42501';
  END IF;
  _l := public.lead_pega(_lead, _org);
  IF NOT public.lead_pode_ser_responsavel(_responsavel_id, _org) THEN
    RAISE EXCEPTION 'Responsavel invalido' USING ERRCODE = '22023';
  END IF;
  IF _l.responsavel_id IS NOT DISTINCT FROM _responsavel_id THEN RETURN _responsavel_id; END IF;
  UPDATE public.leads SET responsavel_id = _responsavel_id, atribuido_em = now(), updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, autor_id)
  VALUES (_org, _l.id, 'atribuido', _l.responsavel_id::text, _responsavel_id::text, _me);
  RETURN _responsavel_id;
END $$;

CREATE OR REPLACE FUNCTION public.lead_anotar(_lead uuid, _nota text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _id uuid;
  _t text := btrim(coalesce(_nota, ''));
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF char_length(_t) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Anotacao vazia ou longa demais' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, nota, autor_id)
  VALUES (_org, _l.id, 'nota', _t, _me) RETURNING id INTO _id;
  UPDATE public.leads SET updated_at = now() WHERE id = _l.id;
  RETURN _id;
END $$;
COMMIT;
