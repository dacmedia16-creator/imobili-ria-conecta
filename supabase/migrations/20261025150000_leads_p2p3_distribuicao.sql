-- Leads — piloto P2 (entrada) + P3 (distribuição e banco "Leads da imobiliária").
-- Card t_9a8dccc7; "sim" de Denis em 25/10/2026, tópico 6238. Base: P1 = 20261025120000_leads_piloto.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261025150000_leads_p2p3_distribuicao.rollback.sql
--
-- Regras de Denis (25/10):
--  1) Lead ligado a captação vai para o CAPTADOR do imóvel.
--  2) Prazo para ACEITAR = lead_config.prazo_aceite_min (ZZ = 1440 = 24 h). Sem aceite, ou sem
--     captador, o lead vai para o PRÓXIMO DA VEZ no rodízio simples entre os corretores ativos.
--  3) Depois do aceite: prazo_primeira_interacao_dias (7) para a 1ª interação; sem ela -> banco.
--  4) Depois de interagir: prazo_sem_interacao_dias (30) sem nova interação -> banco.
--  5) Interação = mudar etapa, anotação ou ligação registradas PELO RESPONSÁVEL. Abrir não conta.
--  6) Banco: gestor/admin redistribui; qualquer corretor da imobiliária pega para si.
--  7) Tarefa agendada (pg_cron, 5 min) idempotente, registra tudo em lead_eventos.
--  8) Avisos SÓ no sino (notifications). Nenhum WhatsApp/e-mail.
--  9) Ganho/perdido não volta ao banco nem conta prazo.
-- Também: corretor que perde o papel de atendimento deixa de ver e de receber leads (pendente do P1).
-- Módulo "leads" desligado = RPCs recusam e a tarefa agendada ignora a imobiliária.
BEGIN;

-- 1) Configuração ------------------------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS prazo_primeira_interacao_dias integer NOT NULL DEFAULT 7
    CONSTRAINT lead_config_prazo_primeira_check CHECK (prazo_primeira_interacao_dias BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS prazo_sem_interacao_dias integer NOT NULL DEFAULT 30
    CONSTRAINT lead_config_prazo_sem_interacao_check CHECK (prazo_sem_interacao_dias BETWEEN 1 AND 365),
  -- Ponteiro do rodízio: último corretor que recebeu lead pelo rodízio.
  ADD COLUMN IF NOT EXISTS rodizio_ultimo_id uuid,
  -- Formulário público de teste (P2). Desligado por padrão; o token vira o link público.
  ADD COLUMN IF NOT EXISTS form_publico_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS form_token text
    CONSTRAINT lead_config_form_token_check CHECK (form_token ~ '^[A-Za-z0-9_-]{32,64}$');
CREATE UNIQUE INDEX IF NOT EXISTS lead_config_form_token_uniq ON public.lead_config (form_token)
  WHERE form_token IS NOT NULL;

-- 2) Lead: aceite, interação, banco, simulado, consentimento -----------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS aceito_em timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_interacao_em timestamptz,
  -- Preenchido = lead está no banco "Leads da imobiliária" (sem responsável).
  ADD COLUMN IF NOT EXISTS no_banco_desde timestamptz,
  -- Quantas vezes a distribuição automática já entregou este lead sem aceite (trava o rodízio infinito).
  ADD COLUMN IF NOT EXISTS tentativas_aceite integer NOT NULL DEFAULT 0
    CONSTRAINT leads_tentativas_check CHECK (tentativas_aceite BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS simulado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consentimento_em timestamptz,
  ADD COLUMN IF NOT EXISTS consentimento_texto text
    CONSTRAINT leads_consentimento_texto_check CHECK (char_length(consentimento_texto) <= 600);
ALTER TABLE public.leads ADD CONSTRAINT leads_banco_sem_responsavel
  CHECK (no_banco_desde IS NULL OR responsavel_id IS NULL);
CREATE INDEX IF NOT EXISTS leads_banco_idx ON public.leads (organization_id, no_banco_desde DESC)
  WHERE no_banco_desde IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_prazos_idx ON public.leads (organization_id)
  WHERE etapa NOT IN ('ganho', 'perdido') AND no_banco_desde IS NULL;

-- 3) Linha do tempo: tipos novos ----------------------------------------------------------------
ALTER TABLE public.lead_eventos DROP CONSTRAINT lead_eventos_tipo_check;
ALTER TABLE public.lead_eventos ADD CONSTRAINT lead_eventos_tipo_check
  CHECK (tipo IN ('criado', 'etapa', 'atribuido', 'nota', 'vinculo',
                  'aceite', 'devolvido_banco', 'redistribuido', 'ligacao'));

-- 4) Anti-spam do formulário público: tentativas por IP (só o hash, nunca o IP) ---------------
CREATE TABLE IF NOT EXISTS public.lead_form_tentativas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_form_tentativas_idx ON public.lead_form_tentativas (organization_id, ip_hash, created_at);
ALTER TABLE public.lead_form_tentativas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_form_tentativas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_form_tentativas TO service_role;
-- Sem policy para authenticated: ninguém do app lê; só as funções do servidor.

-- 5) Quem atende / vê ---------------------------------------------------------------------------
-- Pendente do P1: quem perdeu o papel de atendimento (ex.: virou financeiro) deixa de ver os
-- leads em que ainda consta como responsável. Gestor/admin continuam vendo tudo pela leads_gestor().
CREATE OR REPLACE FUNCTION public.leads_responsaveis_visiveis() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() WHERE auth.uid() IS NOT NULL
     AND public.lead_pode_ser_responsavel(auth.uid(), public.current_org_id())
  UNION
  SELECT tm.membro_id FROM public.team_members tm
   WHERE auth.uid() IS NOT NULL AND tm.organization_id = public.current_org_id()
     AND public.has_role(auth.uid(), 'team_leader'::public.app_role)
     AND public.leads_team_or_parent(tm.team_id, auth.uid())
$$;

-- Corretores do rodízio: papel "corretor", membro ativo e perfil ativo na imobiliária.
-- Próximo da vez = o primeiro depois do ponteiro (ordem fixa por id), dando a volta,
-- pulando quem já recebeu este lead no ciclo atual (_excluir).
CREATE OR REPLACE FUNCTION public.lead_rodizio_proximo(_org uuid, _apos uuid, _excluir uuid[])
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH e AS (
    SELECT DISTINCT p.id FROM public.profiles p
      JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
      JOIN public.user_roles r ON r.user_id = p.id AND r.organization_id = _org AND r.role::text = 'corretor'
     WHERE p.organization_id = _org AND p.ativo IS TRUE AND NOT (p.id = ANY (coalesce(_excluir, '{}'::uuid[]))))
  SELECT coalesce((SELECT id FROM e WHERE _apos IS NOT NULL AND id > _apos ORDER BY id LIMIT 1),
                  (SELECT id FROM e ORDER BY id LIMIT 1))
$$;
-- Quem já recebeu o lead no ciclo atual (desde a última volta ao banco).
CREATE OR REPLACE FUNCTION public.lead_ja_recebeu(_lead uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(array_agg(DISTINCT e.para::uuid), '{}'::uuid[]) FROM public.lead_eventos e
   WHERE e.lead_id = _lead AND e.tipo IN ('atribuido', 'redistribuido')
     AND e.para ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND e.created_at >= coalesce((SELECT max(b.created_at) FROM public.lead_eventos b
                                    WHERE b.lead_id = _lead AND b.tipo = 'devolvido_banco'), '-infinity'::timestamptz)
$$;

-- 6) Peças internas (sem acesso direto do app) ---------------------------------------------------
-- Aviso no sino do ADM. Nenhum envio externo.
CREATE OR REPLACE FUNCTION public.lead_notificar(_user uuid, _org uuid, _titulo text, _msg text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  -- Não avisa a própria pessoa nem quem já não atende leads (ex.: mudou de papel).
  IF _user IS NULL OR _user IS NOT DISTINCT FROM auth.uid()
     OR NOT public.lead_pode_ser_responsavel(_user, _org) THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, organization_id, tipo, titulo, mensagem)
  VALUES (_user, _org, 'lead', left(_titulo, 120), left(_msg, 500));
END $$;

-- Prazo de aceite em texto ("24 h" / "30 min").
CREATE OR REPLACE FUNCTION public.lead_prazo_txt(_min integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN _min % 60 = 0 THEN (_min / 60)::text || ' h' ELSE _min::text || ' min' END
$$;

-- Manda o lead para o banco "Leads da imobiliária".
CREATE OR REPLACE FUNCTION public.lead_mandar_banco(_lead uuid, _motivo text, _autor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.leads;
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead FOR UPDATE;
  IF _l.id IS NULL OR _l.etapa IN ('ganho', 'perdido') OR _l.no_banco_desde IS NOT NULL THEN RETURN; END IF;
  UPDATE public.leads SET responsavel_id = NULL, atribuido_em = NULL, aceito_em = NULL,
         ultima_interacao_em = NULL, tentativas_aceite = 0, no_banco_desde = now(), updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_l.organization_id, _l.id, 'devolvido_banco', _l.responsavel_id::text, 'banco', left(_motivo, 2000), _autor);
  PERFORM public.lead_notificar(_l.responsavel_id, _l.organization_id, 'Lead devolvido ao banco',
    'O lead "' || _l.nome || '" voltou para Leads da imobiliária: ' || coalesce(_motivo, '') || '.');
END $$;

-- Distribui: captador (1ª vez) -> próximo do rodízio -> banco. Trava o lead e a config da
-- imobiliária (FOR UPDATE), então duas distribuições ao mesmo tempo nunca entregam o mesmo lead
-- duas vezes nem pulam/repetem a vez no rodízio. Devolve o novo responsável (NULL = banco).
CREATE OR REPLACE FUNCTION public.lead_distribuir(_lead uuid, _excluir uuid, _motivo text, _autor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.leads; _c public.lead_config; _alvo uuid; _rodizio boolean := false; _ja uuid[];
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead FOR UPDATE;
  IF _l.id IS NULL OR _l.etapa IN ('ganho', 'perdido') THEN RETURN _l.responsavel_id; END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_l.organization_id) ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id FOR UPDATE;
  -- Cada corretor recebe o lead no máximo 1 vez por ciclo; todos recusaram = banco (sem loop infinito).
  _ja := array_remove(public.lead_ja_recebeu(_l.id) || _excluir, NULL);
  IF _c.distribuicao <> 'manual' THEN
    IF _c.distribuicao = 'captador_depois_rodizio' AND _l.tentativas_aceite = 0 AND _l.captador_id IS NOT NULL
       AND NOT (_l.captador_id = ANY (_ja))
       AND public.lead_pode_ser_responsavel(_l.captador_id, _l.organization_id) THEN
      _alvo := _l.captador_id;
    ELSE
      _alvo := public.lead_rodizio_proximo(_l.organization_id, _c.rodizio_ultimo_id, _ja);
      _rodizio := _alvo IS NOT NULL;
    END IF;
  END IF;

  IF _alvo IS NULL THEN
    IF _l.no_banco_desde IS NULL THEN
      PERFORM public.lead_mandar_banco(_l.id, coalesce(_motivo || '; ', '') || 'ninguem disponivel para receber', _autor);
    END IF;
    RETURN NULL;
  END IF;

  IF _rodizio THEN
    UPDATE public.lead_config SET rodizio_ultimo_id = _alvo, updated_at = now() WHERE organization_id = _l.organization_id;
  END IF;
  UPDATE public.leads SET responsavel_id = _alvo, atribuido_em = now(), aceito_em = NULL,
         ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = _l.tentativas_aceite + 1,
         updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_l.organization_id, _l.id,
          CASE WHEN _l.responsavel_id IS NULL AND _l.no_banco_desde IS NULL THEN 'atribuido' ELSE 'redistribuido' END,
          coalesce(_l.responsavel_id::text, CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'banco' END), _alvo::text,
          left(concat_ws('; ', _motivo, CASE WHEN _rodizio THEN 'rodizio' ELSE 'captador do imovel' END), 2000), _autor);
  PERFORM public.lead_notificar(_alvo, _l.organization_id, 'Novo lead para você',
    'Lead "' || _l.nome || '": aceite em até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || ' em Meus leads.');
  IF _l.responsavel_id IS NOT NULL AND _l.responsavel_id <> _alvo THEN
    PERFORM public.lead_notificar(_l.responsavel_id, _l.organization_id, 'Lead passado para outro corretor',
      'O lead "' || _l.nome || '" foi para o próximo da vez: ' || coalesce(_motivo, 'redistribuído') || '.');
  END IF;
  RETURN _alvo;
END $$;

-- Grava um lead (todas as entradas: manual, simulador, formulário). Não distribui.
CREATE OR REPLACE FUNCTION public.lead_inserir(_org uuid, _nome text, _telefone text, _email text, _origem text,
  _mensagem text, _capture_id uuid, _autor uuid, _simulado boolean, _consentimento text, _externo_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid; _captador uuid;
  _tel text := nullif(regexp_replace(coalesce(_telefone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro') THEN
    RAISE EXCEPTION 'Origem invalida' USING ERRCODE = '22023';
  END IF;
  IF _capture_id IS NOT NULL THEN
    SELECT c.captor_id INTO _captador FROM public.exclusive_captures c
     WHERE c.id = _capture_id AND c.organization_id = _org AND c.discarded_at IS NULL AND c.archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Captacao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  END IF;
  INSERT INTO public.leads (organization_id, nome, telefone, email, origem, mensagem, capture_id, captador_id,
                            created_by, simulado, consentimento_em, consentimento_texto, externo_id)
  VALUES (_org, btrim(_nome), _tel, nullif(lower(btrim(coalesce(_email, ''))), ''), _origem,
          nullif(btrim(coalesce(_mensagem, '')), ''), _capture_id, _captador, _autor, coalesce(_simulado, false),
          CASE WHEN nullif(btrim(coalesce(_consentimento, '')), '') IS NOT NULL THEN now() END,
          nullif(btrim(coalesce(_consentimento, '')), ''), _externo_id)
  RETURNING id INTO _id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_org, _id, 'criado', _origem, _autor);
  IF _capture_id IS NOT NULL THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
    VALUES (_org, _id, 'vinculo', _captador::text, _autor);
  END IF;
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.lead_rodizio_proximo(uuid, uuid, uuid[]), public.lead_ja_recebeu(uuid),
  public.lead_notificar(uuid, uuid, text, text), public.lead_prazo_txt(integer),
  public.lead_mandar_banco(uuid, text, uuid), public.lead_distribuir(uuid, uuid, text, uuid),
  public.lead_inserir(uuid, text, text, text, text, text, uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;

-- 7) RPCs do app (substituem as do P1 com a mesma assinatura) -----------------------------------
-- Criar lead manual (gestor/admin). Sem responsável escolhido = distribuição automática.
CREATE OR REPLACE FUNCTION public.lead_criar(_nome text, _telefone text, _email text, _origem text,
  _mensagem text DEFAULT NULL, _capture_id uuid DEFAULT NULL, _responsavel_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _id uuid; _prazo integer;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador cadastra lead' USING ERRCODE = '42501';
  END IF;
  IF _responsavel_id IS NOT NULL AND NOT public.lead_pode_ser_responsavel(_responsavel_id, _org) THEN
    RAISE EXCEPTION 'Responsavel invalido' USING ERRCODE = '22023';
  END IF;
  _id := public.lead_inserir(_org, _nome, _telefone, _email, _origem, _mensagem, _capture_id, _me, false, NULL, NULL);
  IF _responsavel_id IS NOT NULL THEN
    -- tentativas = 1: se não aceitar, vai para o rodízio (o captador não "fura a fila" depois da escolha do gestor).
    UPDATE public.leads SET responsavel_id = _responsavel_id, atribuido_em = now(), tentativas_aceite = 1 WHERE id = _id;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota, autor_id)
    VALUES (_org, _id, 'atribuido', _responsavel_id::text, 'escolhido pelo gestor', _me);
    SELECT coalesce((SELECT prazo_aceite_min FROM public.lead_config WHERE organization_id = _org), 30) INTO _prazo;
    PERFORM public.lead_notificar(_responsavel_id, _org, 'Novo lead para você',
      'Lead "' || btrim(_nome) || '": aceite em até ' || public.lead_prazo_txt(_prazo) || ' em Meus leads.');
  ELSE
    PERFORM public.lead_distribuir(_id, NULL, 'entrada manual', _me);
  END IF;
  RETURN _id;
END $$;

-- Interação do responsável: conta para os prazos de 7/30 dias. Exige aceite antes.
CREATE OR REPLACE FUNCTION public.lead_checar_atendimento(_l public.leads, _me uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _l.responsavel_id IS NOT DISTINCT FROM _me THEN
    IF _l.aceito_em IS NULL AND _l.etapa NOT IN ('ganho', 'perdido') THEN
      RAISE EXCEPTION 'Aceite o lead antes de atender' USING ERRCODE = '42501';
    END IF;
    RETURN true; -- conta como interação
  END IF;
  RETURN false; -- gestor/TL mexendo no lead de outro: registra, mas não zera o prazo do corretor
END $$;
REVOKE ALL ON FUNCTION public.lead_checar_atendimento(public.leads, uuid) FROM PUBLIC, anon, authenticated;

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
  -- Reabrir (sair de ganho/perdido) recomeça o relógio, para o lead não voltar ao banco na hora.
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

CREATE OR REPLACE FUNCTION public.lead_anotar(_lead uuid, _nota text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _id uuid; _conta boolean;
  _t text := btrim(coalesce(_nota, ''));
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF char_length(_t) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Anotacao vazia ou longa demais' USING ERRCODE = '22023';
  END IF;
  _conta := public.lead_checar_atendimento(_l, _me);
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, nota, autor_id)
  VALUES (_org, _l.id, 'nota', _t, _me) RETURNING id INTO _id;
  UPDATE public.leads SET updated_at = now(),
         ultima_interacao_em = CASE WHEN _conta THEN now() ELSE ultima_interacao_em END
   WHERE id = _l.id;
  RETURN _id;
END $$;

-- Ligação registrada pelo atendimento (nota opcional). Conta como interação.
CREATE OR REPLACE FUNCTION public.lead_registrar_ligacao(_lead uuid, _nota text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _id uuid; _conta boolean;
  _t text := nullif(btrim(coalesce(_nota, '')), '');
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF char_length(_t) > 2000 THEN RAISE EXCEPTION 'Anotacao vazia ou longa demais' USING ERRCODE = '22023'; END IF;
  _conta := public.lead_checar_atendimento(_l, _me);
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, nota, autor_id)
  VALUES (_org, _l.id, 'ligacao', _t, _me) RETURNING id INTO _id;
  UPDATE public.leads SET updated_at = now(),
         ultima_interacao_em = CASE WHEN _conta THEN now() ELSE ultima_interacao_em END
   WHERE id = _l.id;
  RETURN _id;
END $$;

-- Aceitar (só o responsável, dentro do prazo — depois do prazo a tarefa agendada já passou adiante).
CREATE OR REPLACE FUNCTION public.lead_aceitar(_lead uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _l.responsavel_id IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'So o responsavel aceita o lead' USING ERRCODE = '42501';
  END IF;
  IF _l.etapa IN ('ganho', 'perdido') THEN RAISE EXCEPTION 'Lead encerrado' USING ERRCODE = '42501'; END IF;
  IF _l.aceito_em IS NOT NULL THEN RETURN _l.aceito_em; END IF;
  UPDATE public.leads SET aceito_em = now(), updated_at = now() WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_org, _l.id, 'aceite', _me::text, _me);
  RETURN now();
END $$;

-- Gestor/admin atribui ou redistribui (inclusive do banco). Recomeça o prazo de aceite.
CREATE OR REPLACE FUNCTION public.lead_atribuir(_lead uuid, _responsavel_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _prazo integer;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador atribui lead' USING ERRCODE = '42501';
  END IF;
  _l := public.lead_pega(_lead, _org);
  IF NOT public.lead_pode_ser_responsavel(_responsavel_id, _org) THEN
    RAISE EXCEPTION 'Responsavel invalido' USING ERRCODE = '22023';
  END IF;
  IF _l.responsavel_id IS NOT DISTINCT FROM _responsavel_id THEN RETURN _responsavel_id; END IF;
  UPDATE public.leads SET responsavel_id = _responsavel_id, atribuido_em = now(), aceito_em = NULL,
         ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = 1, updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'redistribuido' ELSE 'atribuido' END,
          coalesce(_l.responsavel_id::text, CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'banco' END),
          _responsavel_id::text, 'pelo gestor', _me);
  SELECT coalesce((SELECT prazo_aceite_min FROM public.lead_config WHERE organization_id = _org), 30) INTO _prazo;
  PERFORM public.lead_notificar(_responsavel_id, _org, 'Novo lead para você',
    'Lead "' || _l.nome || '": aceite em até ' || public.lead_prazo_txt(_prazo) || ' em Meus leads.');
  RETURN _responsavel_id;
END $$;

-- Banco "Leads da imobiliária": lista para quem atende (sem telefone/e-mail até pegar — LGPD,
-- só o necessário). Gestor/admin já vê tudo pelo painel.
CREATE OR REPLACE FUNCTION public.lead_banco_listar()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx();
BEGIN
  IF NOT (public.leads_gestor() OR public.lead_pode_ser_responsavel(auth.uid(), _org)) THEN
    RAISE EXCEPTION 'Sem acesso ao banco de leads' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'nome', l.nome, 'origem', l.origem, 'etapa', l.etapa, 'no_banco_desde', l.no_banco_desde,
      'created_at', l.created_at, 'com_imovel', l.capture_id IS NOT NULL, 'simulado', l.simulado,
      'mensagem', left(l.mensagem, 280)) ORDER BY l.no_banco_desde DESC)
    FROM (SELECT * FROM public.leads WHERE organization_id = _org AND no_banco_desde IS NOT NULL
            AND etapa NOT IN ('ganho', 'perdido') ORDER BY no_banco_desde DESC LIMIT 300) l), '[]'::jsonb);
END $$;

-- Corretor pega um lead do banco para si (fica já aceito: ele escolheu).
-- FOR UPDATE: dois corretores clicando ao mesmo tempo -> só o primeiro leva.
CREATE OR REPLACE FUNCTION public.lead_pegar(_lead uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads;
BEGIN
  IF NOT public.lead_pode_ser_responsavel(_me, _org) THEN
    RAISE EXCEPTION 'Sem papel de atendimento' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _lead AND organization_id = _org FOR UPDATE;
  IF _l.id IS NULL OR _l.no_banco_desde IS NULL OR _l.etapa IN ('ganho', 'perdido') THEN
    RAISE EXCEPTION 'Lead nao esta mais no banco' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.leads SET responsavel_id = _me, atribuido_em = now(), aceito_em = now(),
         ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = 0, updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, 'redistribuido', 'banco', _me::text, 'pegou do banco', _me),
         (_org, _l.id, 'aceite', NULL, _me::text, NULL, _me);
  RETURN _me;
END $$;

-- Simulador (P2): N leads fictícios. Origem OLX/Meta/site é só rótulo; nada é chamado lá fora.
CREATE OR REPLACE FUNCTION public.lead_simular(_n integer, _origem text, _com_captacao boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _i integer; _id uuid; _cap uuid; _tag text;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador usa o simulador' USING ERRCODE = '42501';
  END IF;
  IF _n IS NULL OR _n NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Quantidade entre 1 e 20' USING ERRCODE = '22023'; END IF;
  IF _origem IS NULL OR _origem NOT IN ('olx', 'meta', 'site') THEN RAISE EXCEPTION 'Origem invalida' USING ERRCODE = '22023'; END IF;
  IF coalesce(_com_captacao, false) AND NOT EXISTS (SELECT 1 FROM public.exclusive_captures
      WHERE organization_id = _org AND discarded_at IS NULL AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Captacao nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  FOR _i IN 1.._n LOOP
    _tag := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    _cap := NULL;
    IF coalesce(_com_captacao, false) THEN
      SELECT id INTO _cap FROM public.exclusive_captures
       WHERE organization_id = _org AND discarded_at IS NULL AND archived_at IS NULL ORDER BY random() LIMIT 1;
    END IF;
    _id := public.lead_inserir(_org, 'Lead simulado ' || upper(_tag), NULL, 'simulado-' || _tag || '@exemplo.invalid',
      _origem, '[SIMULADO] Interesse em imóvel (lead fictício de teste).', _cap, _me, true, NULL, 'sim-' || _tag);
    PERFORM public.lead_distribuir(_id, NULL, 'simulador', _me);
  END LOOP;
  RETURN _n;
END $$;

-- Configuração da imobiliária (só administrador; gestor não mexe em Configurações).
CREATE OR REPLACE FUNCTION public.lead_config_salvar(_prazo_aceite_min integer, _prazo_primeira_dias integer,
  _prazo_sem_interacao_dias integer, _distribuicao text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx();
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador altera a configuracao' USING ERRCODE = '42501';
  END IF;
  IF _distribuicao IS NULL OR _distribuicao NOT IN ('captador_depois_rodizio', 'rodizio', 'manual') THEN
    RAISE EXCEPTION 'Distribuicao invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.lead_config SET prazo_aceite_min = _prazo_aceite_min, prazo_primeira_interacao_dias = _prazo_primeira_dias,
         prazo_sem_interacao_dias = _prazo_sem_interacao_dias, distribuicao = _distribuicao, updated_at = now()
   WHERE organization_id = _org;
END $$;

-- Liga/desliga o formulário público de teste. Devolve o token do link (gera na 1ª vez).
CREATE OR REPLACE FUNCTION public.lead_form_configurar(_ativo boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _tok text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador altera a configuracao' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.lead_config SET form_publico_ativo = coalesce(_ativo, false), updated_at = now(),
         form_token = coalesce(form_token, translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'))
   WHERE organization_id = _org RETURNING form_token INTO _tok;
  RETURN _tok;
END $$;

REVOKE ALL ON FUNCTION public.lead_registrar_ligacao(uuid, text), public.lead_aceitar(uuid),
  public.lead_banco_listar(), public.lead_pegar(uuid), public.lead_simular(integer, text, boolean),
  public.lead_config_salvar(integer, integer, integer, text), public.lead_form_configurar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_registrar_ligacao(uuid, text), public.lead_aceitar(uuid),
  public.lead_banco_listar(), public.lead_pegar(uuid), public.lead_simular(integer, text, boolean),
  public.lead_config_salvar(integer, integer, integer, text), public.lead_form_configurar(boolean)
  TO authenticated, service_role;

-- 8) Formulário público (P2): só o servidor do ADM (service_role) chama --------------------------
CREATE OR REPLACE FUNCTION public.lead_form_info(_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_build_object('imobiliaria', o.nome)
    FROM public.lead_config c
    JOIN public.organizations o ON o.id = c.organization_id AND o.status = 'ativa'
    JOIN public.organization_modules m ON m.organization_id = c.organization_id AND m.module = 'leads' AND m.enabled
   WHERE _token IS NOT NULL AND c.form_token = _token AND c.form_publico_ativo
$$;

-- Recebe o envio. Anti-spam no banco: máx. 5 envios/hora por IP (hash) e 60/hora por imobiliária.
-- Mesmo contato com lead aberto nas últimas 24 h = não duplica (responde ok sem revelar).
CREATE OR REPLACE FUNCTION public.lead_form_enviar(_token text, _nome text, _telefone text, _email text,
  _mensagem text, _capture_id uuid, _consentimento text, _ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _id uuid; _tel text := nullif(regexp_replace(coalesce(_telefone, ''), '[^0-9+]', '', 'g'), '');
  _mail text := nullif(lower(btrim(coalesce(_email, ''))), '');
BEGIN
  SELECT c.organization_id INTO _org FROM public.lead_config c
    JOIN public.organizations o ON o.id = c.organization_id AND o.status = 'ativa'
    JOIN public.organization_modules m ON m.organization_id = c.organization_id AND m.module = 'leads' AND m.enabled
   WHERE _token IS NOT NULL AND c.form_token = _token AND c.form_publico_ativo;
  IF _org IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'indisponivel'); END IF;
  IF _ip_hash IS NULL OR _ip_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'erro', 'invalido'); END IF;
  IF nullif(btrim(coalesce(_consentimento, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'consentimento');
  END IF;
  -- Contato válido antes de gravar (mesmos CHECKs da tabela leads).
  IF char_length(btrim(coalesce(_nome, ''))) NOT BETWEEN 1 AND 120
     OR (_tel IS NULL AND _mail IS NULL)
     OR (_tel IS NOT NULL AND _tel !~ '^\+?[0-9]{8,15}$')
     OR (_mail IS NOT NULL AND (char_length(_mail) > 160 OR _mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
     OR char_length(coalesce(_mensagem, '')) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contato');
  END IF;
  -- Um envio por vez por imobiliária: a contagem do limite não é furada por envios simultâneos.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead_form:' || _org::text, 0));
  IF (SELECT count(*) FROM public.lead_form_tentativas WHERE organization_id = _org AND ip_hash = _ip_hash
        AND created_at > now() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.lead_form_tentativas WHERE organization_id = _org
        AND created_at > now() - interval '1 hour') >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'limite');
  END IF;
  INSERT INTO public.lead_form_tentativas (organization_id, ip_hash) VALUES (_org, _ip_hash);
  IF EXISTS (SELECT 1 FROM public.leads WHERE organization_id = _org AND etapa NOT IN ('ganho', 'perdido')
               AND created_at > now() - interval '24 hours'
               AND ((_tel IS NOT NULL AND telefone = _tel) OR (_mail IS NOT NULL AND email = _mail))) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF _capture_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id = _capture_id
       AND organization_id = _org AND discarded_at IS NULL AND archived_at IS NULL) THEN
    _capture_id := NULL; -- link com imóvel inválido: entra sem imóvel (vai para o rodízio)
  END IF;
  _id := public.lead_inserir(_org, _nome, _tel, _mail, 'formulario', _mensagem, _capture_id, NULL, false,
                             left(_consentimento, 600), NULL);
  PERFORM public.lead_distribuir(_id, NULL, 'formulario publico', NULL);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.lead_form_info(text), public.lead_form_enviar(text, text, text, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_form_info(text), public.lead_form_enviar(text, text, text, text, text, uuid, text, text)
  TO service_role;

-- 9) Tarefa agendada: prazos (a cada 5 min) -------------------------------------------------------
-- Idempotente: cada lead só entra se o prazo venceu e sai da condição depois da ação.
-- SKIP LOCKED: duas execuções ao mesmo tempo não pegam o mesmo lead.
CREATE OR REPLACE FUNCTION public.leads_processar_prazos()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _r record; _sem_dono integer := 0; _papel integer := 0; _aceite integer := 0;
  _primeira integer := 0; _parado integer := 0; _falhas integer := 0;
BEGIN
  FOR _r IN
    SELECT l.id, l.responsavel_id, l.aceito_em, l.ultima_interacao_em, l.atribuido_em, l.organization_id,
           c.prazo_aceite_min, c.prazo_primeira_interacao_dias AS d1, c.prazo_sem_interacao_dias AS d30
      FROM public.leads l
      JOIN public.organizations o ON o.id = l.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = l.organization_id AND m.module = 'leads' AND m.enabled
      JOIN public.lead_config c ON c.organization_id = l.organization_id
     WHERE l.etapa NOT IN ('ganho', 'perdido') AND l.no_banco_desde IS NULL
       AND (l.responsavel_id IS NULL
         OR NOT public.lead_pode_ser_responsavel(l.responsavel_id, l.organization_id)
         OR (l.aceito_em IS NULL AND coalesce(l.atribuido_em, l.created_at) + make_interval(mins => c.prazo_aceite_min) <= now())
         OR (l.aceito_em IS NOT NULL AND l.ultima_interacao_em IS NULL
             AND l.aceito_em + make_interval(days => c.prazo_primeira_interacao_dias) <= now())
         OR (l.ultima_interacao_em IS NOT NULL
             AND l.ultima_interacao_em + make_interval(days => c.prazo_sem_interacao_dias) <= now()))
     ORDER BY l.created_at
     LIMIT 500
     FOR UPDATE OF l SKIP LOCKED
  LOOP
   -- Um lead com problema não trava a rodada: desfaz só ele, avisa no log e segue.
   BEGIN
    IF _r.responsavel_id IS NULL THEN
      PERFORM public.lead_distribuir(_r.id, NULL, 'sem responsavel', NULL); _sem_dono := _sem_dono + 1;
    ELSIF NOT public.lead_pode_ser_responsavel(_r.responsavel_id, _r.organization_id) THEN
      IF _r.aceito_em IS NULL THEN
        PERFORM public.lead_distribuir(_r.id, _r.responsavel_id, 'responsavel sem papel de atendimento', NULL);
      ELSE
        PERFORM public.lead_mandar_banco(_r.id, 'responsavel sem papel de atendimento', NULL);
      END IF;
      _papel := _papel + 1;
    ELSIF _r.aceito_em IS NULL THEN
      PERFORM public.lead_distribuir(_r.id, _r.responsavel_id,
        'nao aceito em ' || public.lead_prazo_txt(_r.prazo_aceite_min), NULL);
      _aceite := _aceite + 1;
    ELSIF _r.ultima_interacao_em IS NULL THEN
      PERFORM public.lead_mandar_banco(_r.id, 'sem 1a interacao em ' || _r.d1 || ' dias', NULL);
      _primeira := _primeira + 1;
    ELSE
      PERFORM public.lead_mandar_banco(_r.id, _r.d30 || ' dias sem interacao', NULL);
      _parado := _parado + 1;
    END IF;
   EXCEPTION WHEN OTHERS THEN
    _falhas := _falhas + 1;
    RAISE WARNING 'leads_processar_prazos: lead % falhou: %', _r.id, SQLERRM;
   END;
  END LOOP;
  DELETE FROM public.lead_form_tentativas WHERE created_at < now() - interval '1 day';
  RETURN jsonb_build_object('sem_responsavel', _sem_dono, 'papel', _papel, 'aceite_vencido', _aceite,
                            'sem_primeira_interacao', _primeira, 'sem_interacao', _parado, 'falhas', _falhas);
END $$;
REVOKE ALL ON FUNCTION public.leads_processar_prazos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_processar_prazos() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'leads-prazos';
    PERFORM cron.schedule('leads-prazos', '*/5 * * * *', 'select public.leads_processar_prazos()');
  END IF;
END $$;

COMMIT;
