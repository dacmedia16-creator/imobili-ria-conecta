-- t_867f464c — Captação em assinatura: e-mail/telefone do proprietário corrigido na captação e na
-- Clicksign ficam iguais (pedido de Denis em 09/11/2026, tópico 6238; diagnóstico t_18a2909f).
-- Antes: depois do envio à Clicksign o formulário fica travado (exclusive_save só aceita
-- rascunho/devolvida) e o "Editar" do quadro Signatários trocava só na Clicksign, sem voltar para a
-- captação. Resultado: o corretor achava que tinha corrigido e o convite seguia para o e-mail antigo.
--
-- Esta migration só CRIA duas funções. NÃO altera exclusive_save, exclusive_transition,
-- clicksign_manage_done nem nenhuma tabela. Rollback: supabase/rollback/20261109200000_captacao_contato_signatario.sql
--
-- 1) exclusive_contato_assinatura_salvar(_id, _owner, _email, _telefone) — authenticated.
--    Grava e-mail (e telefone, se vier) do Proprietário N na captação EM ASSINATURA.
--    Quem pode: o corretor captador ou quem gerencia (exclusive_is_manager ou
--    clicksign_capture_sender_ok), sempre na organização do contexto.
--    NÃO fala com a Clicksign, NÃO apaga o PDF enviado e NÃO reenvia/cancela nada.
--    Histórico: 'contato_corrigido' com e-mail/telefone mascarados.
--    Quem não pode aplicar no envelope (ex.: corretor): avisa no sino o líder/co-líder da equipe e o
--    líder da equipe-mãe (sem nenhum: admins da org), para corrigir em Signatários. Sem valores no aviso.
--    Retorno: {mudou, pode_aplicar, envelope_ativo, precisa_aplicar, avisados}.
-- 2) clicksign_capture_signer_sync(_envelope, _idx, _email, _actor) — só service_role (edge
--    clicksign-manage, depois de trocar o signatário na Clicksign). Copia o e-mail novo para o
--    proprietário correspondente na captação. Só aceita o e-mail cujo sha256 já está gravado no
--    envelope para aquele signatário (não grava e-mail arbitrário).
BEGIN;

CREATE FUNCTION public.exclusive_contato_assinatura_salvar(_id uuid, _owner integer, _email text,
  _telefone text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _c public.exclusive_captures%ROWTYPE;
  _uid uuid := auth.uid();
  _dono boolean; _aplica boolean; _gestor boolean;
  _owners jsonb; _o jsonb; _path text[];
  _email_n text := lower(btrim(coalesce(_email, '')));
  _tel_n text := nullif(btrim(coalesce(_telefone, '')), '');
  _email_old text; _tel_old text;
  _mud_email boolean; _mud_tel boolean;
  _env public.clicksign_envelopes%ROWTYPE;
  _sig jsonb; _precisa boolean := false;
  _detalhe text; _avisados integer := 0; _quem text;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures
    WHERE id = _id AND organization_id = public.current_org_id() FOR UPDATE;
  IF NOT FOUND OR _uid IS NULL OR NOT public.exclusive_can_view(_id, _uid) THEN
    RAISE EXCEPTION 'Captação não disponível';
  END IF;
  _dono := _c.captor_id = _uid;
  _gestor := coalesce(public.exclusive_is_manager(_id, _uid), false);
  _aplica := coalesce(public.clicksign_capture_sender_ok(_uid, _id), false);
  IF NOT (_dono OR _gestor OR _aplica) THEN
    RAISE EXCEPTION 'Só o corretor captador ou o gestor pode corrigir o contato do proprietário';
  END IF;
  IF _c.status <> 'em_assinatura' OR _c.archived_at IS NOT NULL OR _c.discarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Só captação em assinatura é corrigida por aqui (antes do envio, edite o formulário)';
  END IF;
  _owners := public.exclusive_owner_list(_c.form_data);
  IF _owner IS NULL OR _owner < 1 OR _owner > jsonb_array_length(_owners) THEN
    RAISE EXCEPTION 'Proprietário inválido';
  END IF;
  -- Mesma regra de e-mail da Clicksign (EMAIL_RE em _shared/clicksign.ts).
  IF length(_email_n) > 200 OR _email_n !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'E-mail inválido';
  END IF;
  IF _tel_n IS NOT NULL AND (length(_tel_n) > 30
      OR length(regexp_replace(_tel_n, '[^0-9]', '', 'g')) NOT BETWEEN 10 AND 13
      OR _tel_n !~ '^[0-9 ()+.-]+$') THEN
    RAISE EXCEPTION 'Telefone inválido';
  END IF;
  _o := _owners -> (_owner - 1);
  _email_old := lower(btrim(coalesce(_o->>'email', '')));
  _tel_old := btrim(coalesce(_o->>'telefone_1', ''));
  _mud_email := _email_old IS DISTINCT FROM _email_n;
  _mud_tel := _tel_n IS NOT NULL AND _tel_old IS DISTINCT FROM _tel_n;

  _path := CASE WHEN _owner = 1 THEN ARRAY['proprietario_1']
                WHEN _owner = 2 THEN ARRAY['proprietario_2']
                ELSE ARRAY['proprietarios_extras', (_owner - 3)::text] END;
  IF _mud_email OR _mud_tel THEN
    _o := _o || jsonb_build_object('email', _email_n)
       || CASE WHEN _mud_tel THEN jsonb_build_object('telefone_1', _tel_n) ELSE '{}'::jsonb END;
    -- Só o contato muda; o PDF já enviado à Clicksign NÃO é apagado nem regerado.
    UPDATE public.exclusive_captures SET form_data = jsonb_set(form_data, _path, _o, false),
      updated_at = now() WHERE id = _id;
  END IF;

  -- Envelope rodando: o e-mail dele para este proprietário já é o novo?
  SELECT * INTO _env FROM public.clicksign_envelopes
    WHERE capture_id = _id AND organization_id = _c.organization_id AND status = 'running'
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    SELECT s INTO _sig FROM jsonb_array_elements(_env.signers) s
      WHERE s->>'papel' = 'proprietario_' || _owner LIMIT 1;
    _precisa := _sig IS NOT NULL AND (_sig->>'email_sha256') IS DISTINCT FROM
      encode(extensions.digest(_email_n, 'sha256'), 'hex');
  END IF;

  IF NOT (_mud_email OR _mud_tel) THEN
    RETURN jsonb_build_object('mudou', false, 'pode_aplicar', _aplica,
      'envelope_ativo', _env.id IS NOT NULL, 'precisa_aplicar', _precisa, 'avisados', 0);
  END IF;

  _detalhe := 'Proprietário ' || _owner || ': ' || concat_ws('; ',
      CASE WHEN _mud_email THEN 'e-mail ' || public.exclusive_correcao_mascara('email', _email_old)
        || ' → ' || public.exclusive_correcao_mascara('email', _email_n) END,
      CASE WHEN _mud_tel THEN 'telefone ' || public.exclusive_correcao_mascara('telefone_1', _tel_old)
        || ' → ' || public.exclusive_correcao_mascara('telefone_1', _tel_n) END)
    || CASE WHEN NOT _precisa THEN ' (captação e Clicksign iguais)'
            WHEN _aplica THEN ' (falta aplicar na Clicksign)'
            ELSE ' (documento já enviado: gestor avisado para aplicar em Signatários)' END;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_id, _uid, 'contato_corrigido', left(_detalhe, 500));

  -- Quem corrigiu não pode trocar no envelope: avisa quem pode (sem valores no texto).
  IF _precisa AND NOT _aplica THEN
    BEGIN
      SELECT nullif(btrim(p.nome), '') INTO _quem FROM public.profiles p WHERE p.id = _uid;
      WITH ativos AS (
        SELECT p.id FROM public.profiles p
         WHERE p.organization_id = _c.organization_id AND p.ativo IS NOT FALSE AND p.id IS DISTINCT FROM _uid
      ), lideres AS (
        SELECT x.id FROM (
          SELECT t.lider_id AS id FROM public.team_members tm
            JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
           WHERE tm.organization_id = _c.organization_id AND tm.membro_id = _c.captor_id
          UNION
          SELECT pt.lider_id FROM public.team_members tm
            JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
            JOIN public.teams pt ON pt.id = t.parent_team_id AND pt.organization_id = _c.organization_id
           WHERE tm.organization_id = _c.organization_id AND tm.membro_id = _c.captor_id
          UNION
          SELECT cl.user_id FROM public.team_members tm
            JOIN public.team_co_leaders cl ON cl.team_id = tm.team_id AND cl.organization_id = _c.organization_id
           WHERE tm.organization_id = _c.organization_id AND tm.membro_id = _c.captor_id
        ) x WHERE x.id IN (SELECT id FROM ativos)
      ), admins AS (
        SELECT ur.user_id AS id FROM public.user_roles ur
         WHERE ur.organization_id = _c.organization_id AND ur.role = 'admin'::public.app_role
           AND ur.user_id IN (SELECT id FROM ativos)
      ), alvo AS (
        SELECT id FROM lideres
        UNION SELECT id FROM admins WHERE NOT EXISTS (SELECT 1 FROM lideres)
      ), ins AS (
        INSERT INTO public.notifications (user_id, organization_id, exclusive_capture_id, tipo, titulo, mensagem)
          SELECT a.id, _c.organization_id, _id, 'captacao_contato_assinatura',
            left('Captação #' || upper(left(_id::text, 8)) || ': corrigir e-mail na Clicksign', 200),
            left(coalesce(_quem, 'O corretor') || ' corrigiu o contato do Proprietário ' || _owner
              || ' na captação. O documento já foi enviado: abra Signatários e use "Aplicar na Clicksign".', 500)
            FROM alvo a WHERE a.id IS NOT NULL
          RETURNING 1
      )
      SELECT count(*) INTO _avisados FROM ins;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'exclusive_contato_assinatura_salvar: aviso não gravado (%)', SQLSTATE;
      _avisados := 0;
    END;
  END IF;

  RETURN jsonb_build_object('mudou', true, 'pode_aplicar', _aplica,
    'envelope_ativo', _env.id IS NOT NULL, 'precisa_aplicar', _precisa, 'avisados', _avisados);
END $function$;

CREATE FUNCTION public.clicksign_capture_signer_sync(_envelope uuid, _idx integer, _email text,
  _actor uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _e public.clicksign_envelopes%ROWTYPE;
  _c public.exclusive_captures%ROWTYPE;
  _sig jsonb; _n integer; _owners jsonb; _o jsonb; _path text[];
  _email_n text := lower(btrim(coalesce(_email, '')));
  _old text;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope;
  IF NOT FOUND OR _e.origem <> 'captacao' OR _e.capture_id IS NULL THEN
    RAISE EXCEPTION 'Envelope inválido';
  END IF;
  IF _idx IS NULL OR _idx < 0 OR _idx >= jsonb_array_length(_e.signers) THEN
    RAISE EXCEPTION 'Signatário inválido';
  END IF;
  _sig := _e.signers -> _idx;
  IF coalesce(_sig->>'papel', '') !~ '^proprietario_[0-9]+$' THEN
    RETURN 'nao_proprietario';
  END IF;
  -- Só o e-mail que o envelope já tem para este signatário (gravado por clicksign_manage_done).
  IF (_sig->>'email_sha256') IS DISTINCT FROM encode(extensions.digest(_email_n, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'E-mail diferente do envelope';
  END IF;
  _n := substring(_sig->>'papel' FROM '[0-9]+$')::integer;
  SELECT * INTO _c FROM public.exclusive_captures
    WHERE id = _e.capture_id AND organization_id = _e.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Captação inexistente'; END IF;
  _owners := public.exclusive_owner_list(_c.form_data);
  IF _n < 1 OR _n > jsonb_array_length(_owners) THEN RETURN 'sem_proprietario'; END IF;
  _o := _owners -> (_n - 1);
  _old := lower(btrim(coalesce(_o->>'email', '')));
  IF _old = _email_n THEN RETURN 'igual'; END IF;
  _path := CASE WHEN _n = 1 THEN ARRAY['proprietario_1']
                WHEN _n = 2 THEN ARRAY['proprietario_2']
                ELSE ARRAY['proprietarios_extras', (_n - 3)::text] END;
  UPDATE public.exclusive_captures
     SET form_data = jsonb_set(form_data, _path, _o || jsonb_build_object('email', _email_n), false),
         updated_at = now()
   WHERE id = _c.id;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_c.id, coalesce(_actor, _e.created_by), 'contato_corrigido',
      left('Proprietário ' || _n || ': e-mail ' || public.exclusive_correcao_mascara('email', _old)
        || ' → ' || public.exclusive_correcao_mascara('email', _email_n)
        || ' (captação atualizada pela troca na Clicksign)', 500));
  RETURN 'ok';
END $function$;

-- Permissões. Dono = postgres (padrão), igual às demais funções da Clicksign: elas leem
-- clicksign_envelopes, que o mt_1b_definer não pode ler (teste na homologação, 09/11).
REVOKE ALL ON FUNCTION public.exclusive_contato_assinatura_salvar(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_contato_assinatura_salvar(uuid, integer, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.clicksign_capture_signer_sync(uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_capture_signer_sync(uuid, integer, text, uuid) TO service_role;

COMMIT;
