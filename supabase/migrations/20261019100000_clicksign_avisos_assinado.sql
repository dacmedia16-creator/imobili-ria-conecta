-- Clicksign — corretor vê o assinado ao fechar + avisos de status (sino + WhatsApp)
-- (cartão t_f8dc8b99; aprovado por Denis em 18/10/2026). Vem DEPOIS de 20261019090000 (t_eb3f23e0).
-- Rollback: supabase/rollback/20261019100000_clicksign_avisos_assinado.sql
--
-- A) Contrato assinado visível ao CAPTADOR/criador assim que a Clicksign fecha o envelope, mesmo com a
--    captação ainda "enviada"/"em_assinatura" (a aprovação do gestor continua manual; o webhook não
--    aprova). Só o kind 'assinado' que veio do envelope fechado (signed_document_id); o 'gerado' segue
--    como hoje e nenhum outro corretor passa a ver nada (exclusive_can_view continua obrigatório).
--    O bucket exclusive-captures (exclusive_storage_read) depende da linha visível em
--    exclusive_documents, então herda a mesma regra sem mudar a policy do storage.
-- B) Avisos de status, por gatilho em clicksign_envelopes (captação e venda) e pelo webhook ("sign"):
--    sino para todos os eventos; WhatsApp SÓ em 4: enviado, todos assinaram, recusado e prazo perto de
--    vencer (3 dias antes, a partir das 9h de Brasília, 1 vez por envelope). Destino: corretor(es)
--    criador(es), líderes/co-líderes da equipe deles e quem enviou pela Clicksign (que não é avisado do
--    próprio envio). Idempotente: clicksign_avisos (envelope + chave) impede aviso repetido na
--    reentrega do webhook. O WhatsApp vai para uma fila (clicksign_whatsapp_fila) enviada pela rotina
--    de 5 minutos que o ADM MAX já tem, com a mesma chave ZionTalk e as preferências já existentes
--    (user_roles.notificar_whatsapp, telefone e ativo do perfil). Nenhum CPF ou e-mail no texto.
--    Falha no aviso NUNCA desfaz a ação (bloco de exceção).

-- ===== Estrutura =====
ALTER TABLE public.clicksign_envelopes ADD COLUMN deadline_at timestamptz;
GRANT SELECT (deadline_at) ON public.clicksign_envelopes TO authenticated;
-- Envelopes já em assinatura: prazo = criação + prazo da org (a edge usa o mesmo cálculo no envio).
UPDATE public.clicksign_envelopes e SET deadline_at = e.created_at + make_interval(days => s.deadline_days)
  FROM public.clicksign_org_settings s
  WHERE s.organization_id = e.organization_id AND e.status = 'running' AND e.deadline_at IS NULL;

CREATE TABLE public.clicksign_avisos (
  envelope_id uuid NOT NULL REFERENCES public.clicksign_envelopes(id) ON DELETE CASCADE,
  chave text NOT NULL CHECK (chave ~ '^[a-z_]+(:[0-9a-f]{64}|:ev[0-9]+)?$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (envelope_id, chave)
);
ALTER TABLE public.clicksign_avisos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clicksign_avisos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.clicksign_avisos TO service_role;

CREATE TABLE public.clicksign_whatsapp_fila (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  envelope_id uuid NOT NULL REFERENCES public.clicksign_envelopes(id) ON DELETE CASCADE,
  evento text NOT NULL CHECK (evento IN ('enviado','finalizado','recusado','prazo_perto')),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text CHECK (last_error IS NULL OR (length(last_error) <= 200 AND last_error !~ '@')),
  UNIQUE (envelope_id, evento, user_id)
);
CREATE INDEX clicksign_whatsapp_fila_pendente ON public.clicksign_whatsapp_fila (created_at)
  WHERE sent_at IS NULL;
ALTER TABLE public.clicksign_whatsapp_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clicksign_whatsapp_fila FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.clicksign_whatsapp_fila TO service_role;

-- ===== A) assinado visível ao captador quando o envelope fechou =====
CREATE FUNCTION public.clicksign_assinado_liberado(_doc uuid, _capture uuid, _actor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.exclusive_captures c
    WHERE c.id = _capture AND (c.captor_id = _actor OR c.created_by = _actor)
      AND c.status IN ('enviada','em_assinatura') AND c.discarded_at IS NULL
      AND EXISTS (SELECT 1 FROM public.clicksign_envelopes e
        WHERE e.capture_id = c.id AND e.organization_id = c.organization_id
          AND e.status = 'closed' AND e.signed_document_id = _doc)), false)
$$;
REVOKE ALL ON FUNCTION public.clicksign_assinado_liberado(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_assinado_liberado(uuid, uuid, uuid) TO authenticated, service_role;

-- Igual à de 20261008160000 + o assinado liberado acima.
DROP POLICY IF EXISTS exclusive_documents_read ON public.exclusive_documents;
CREATE POLICY exclusive_documents_read ON public.exclusive_documents
  FOR SELECT TO authenticated
  USING (
    public.exclusive_can_view(capture_id, (SELECT auth.uid()))
    AND (
      kind NOT IN ('gerado','assinado')
      OR public.exclusive_is_manager(capture_id, (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.exclusive_captures c
                 WHERE c.id = exclusive_documents.capture_id
                   AND (c.status = 'aprovada' OR (c.manual AND exclusive_documents.kind = 'assinado')))
      OR (kind = 'assinado'
          AND public.clicksign_assinado_liberado(id, capture_id, (SELECT auth.uid())))
    )
  );

-- ===== B) avisos =====
-- Rótulo sem dado pessoal: captação = código; venda = código do imóvel/interno ou código da venda.
CREATE FUNCTION public.clicksign_aviso_rotulo(_e public.clicksign_envelopes) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN _e.origem = 'venda' THEN 'Venda ' || coalesce(
      (SELECT coalesce(nullif(trim(s.imovel_id), ''), nullif(trim(s.codigo_interno), ''))
         FROM public.sales s WHERE s.id = _e.sale_id),
      '#' || upper(left(_e.sale_id::text, 8)))
    ELSE 'Captação #' || upper(left(_e.capture_id::text, 8)) END
$$;
REVOKE ALL ON FUNCTION public.clicksign_aviso_rotulo(public.clicksign_envelopes) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_aviso_rotulo(public.clicksign_envelopes) TO service_role;

-- Quem recebe: corretor(es) criador(es) + líderes e co-líderes da equipe deles (mesma regra de
-- leaderIdsForCorretor) + quem enviou. Só perfis ativos da MESMA organização. _sem = quem agiu.
CREATE FUNCTION public.clicksign_aviso_destinos(_e public.clicksign_envelopes, _sem uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH corretores AS (
    SELECT c.captor_id AS id FROM public.exclusive_captures c
      WHERE _e.origem IS DISTINCT FROM 'venda' AND c.id = _e.capture_id
    UNION
    SELECT r FROM public.sale_responsaveis(_e.sale_id) r WHERE _e.origem = 'venda'
  ), equipes AS (
    SELECT tm.team_id FROM public.team_members tm
      WHERE tm.organization_id = _e.organization_id AND tm.membro_id IN (SELECT id FROM corretores)
  ), todos AS (
    SELECT id FROM corretores
    UNION SELECT t.lider_id FROM public.teams t
      WHERE t.organization_id = _e.organization_id AND t.id IN (SELECT team_id FROM equipes)
    UNION SELECT cl.user_id FROM public.team_co_leaders cl
      WHERE cl.organization_id = _e.organization_id AND cl.team_id IN (SELECT team_id FROM equipes)
    UNION SELECT _e.created_by
  )
  SELECT p.id FROM public.profiles p
  WHERE p.id IN (SELECT id FROM todos WHERE id IS NOT NULL)
    AND p.organization_id = _e.organization_id AND p.ativo IS NOT FALSE
    AND p.id IS DISTINCT FROM _sem
$$;
REVOKE ALL ON FUNCTION public.clicksign_aviso_destinos(public.clicksign_envelopes, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_aviso_destinos(public.clicksign_envelopes, uuid) TO service_role;

-- Núcleo: grava a chave (idempotência), o sino e, se _whats, a fila do WhatsApp. Devolve quantos
-- destinatários receberam o sino (0 = aviso repetido ou ninguém para avisar).
CREATE FUNCTION public.clicksign_aviso(_e public.clicksign_envelopes, _chave text, _evento text,
  _titulo text, _msg text, _whats boolean, _sem uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _n integer;
BEGIN
  INSERT INTO public.clicksign_avisos (envelope_id, chave) VALUES (_e.id, _chave)
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 0; END IF;
  INSERT INTO public.notifications (user_id, organization_id, sale_id, exclusive_capture_id, tipo, titulo, mensagem)
    SELECT d, _e.organization_id, CASE WHEN _e.origem = 'venda' THEN _e.sale_id END,
      CASE WHEN _e.origem IS DISTINCT FROM 'venda' THEN _e.capture_id END,
      'clicksign_status', left(_titulo, 200), left(_msg, 500)
    FROM public.clicksign_aviso_destinos(_e, _sem) d;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _whats THEN
    INSERT INTO public.clicksign_whatsapp_fila (organization_id, envelope_id, evento, user_id)
      SELECT _e.organization_id, _e.id, _evento, d FROM public.clicksign_aviso_destinos(_e, _sem) d
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_aviso(public.clicksign_envelopes, text, text, text, text, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_aviso(public.clicksign_envelopes, text, text, text, text, boolean, uuid)
  TO service_role;

CREATE FUNCTION public.clicksign_data_br(_t timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(_t AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
$$;

-- Prazo gravado quando o envelope entra em assinatura (mesmo cálculo da edge: criação + prazo da org).
CREATE FUNCTION public.clicksign_envelope_prazo_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'running' AND NEW.deadline_at IS NULL THEN
    SELECT NEW.created_at + make_interval(days => least(greatest(s.deadline_days, 1), 90))
      INTO NEW.deadline_at FROM public.clicksign_org_settings s
      WHERE s.organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clicksign_envelope_prazo BEFORE UPDATE OF status ON public.clicksign_envelopes
  FOR EACH ROW EXECUTE FUNCTION public.clicksign_envelope_prazo_trg();

-- Mudanças de status do envelope → avisos. Nunca derruba a transação de quem mudou o status.
CREATE FUNCTION public.clicksign_envelope_aviso_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _r text; _venda boolean := NEW.origem = 'venda';
BEGIN
  BEGIN
    _r := public.clicksign_aviso_rotulo(NEW);
    IF NEW.status = 'running' AND OLD.status IS DISTINCT FROM 'running' THEN
      PERFORM public.clicksign_aviso(NEW, 'enviado', 'enviado',
        _r || ': contrato enviado para assinatura',
        'Enviado pela Clicksign' || CASE WHEN NEW.is_test THEN ' (TESTE)' ELSE '' END
          || coalesce('. Prazo para assinar: ' || public.clicksign_data_br(NEW.deadline_at), '') || '.',
        true, NEW.created_by);
    ELSIF NEW.status = 'closed' AND NEW.signed_document_id IS NOT NULL
          AND OLD.signed_document_id IS NULL THEN
      PERFORM public.clicksign_aviso(NEW, 'finalizado', 'finalizado',
        _r || ': todos assinaram',
        CASE WHEN _venda THEN 'O contrato assinado foi anexado à venda e está disponível para baixar.'
          ELSE 'O contrato assinado está disponível para baixar. O gestor precisa aprovar a captação.' END,
        true, NULL);
    ELSIF NEW.status = 'canceled' AND OLD.status IS DISTINCT FROM 'canceled' THEN
      IF NEW.last_event = 'refusal' THEN
        PERFORM public.clicksign_aviso(NEW, 'recusado', 'recusado',
          _r || ': assinatura recusada',
          'Um signatário recusou a assinatura na Clicksign e o envio foi cancelado. Confira e envie o contrato de novo.',
          true, NULL);
      ELSIF NEW.last_event = 'deadline' THEN
        PERFORM public.clicksign_aviso(NEW, 'prazo_vencido', 'prazo_vencido',
          _r || ': prazo da assinatura venceu',
          'O prazo na Clicksign venceu sem todas as assinaturas e o envio foi cancelado. Envie o contrato de novo.',
          false, NULL);
      ELSE
        PERFORM public.clicksign_aviso(NEW, 'cancelado', 'cancelado',
          _r || ': assinatura cancelada', 'O envio pela Clicksign foi cancelado.', false, NULL);
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'clicksign aviso falhou: %', left(SQLERRM, 120);
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER clicksign_envelope_aviso AFTER UPDATE OF status, signed_document_id
  ON public.clicksign_envelopes FOR EACH ROW EXECUTE FUNCTION public.clicksign_envelope_aviso_trg();
REVOKE ALL ON FUNCTION public.clicksign_envelope_prazo_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clicksign_envelope_aviso_trg() FROM PUBLIC, anon, authenticated;

-- Papel de quem assinou, pelo sha256 do e-mail já guardado (nunca o e-mail): "Proprietário 1",
-- "Testemunha 2", "Comprador 1"... NULL se não achar.
CREATE FUNCTION public.clicksign_papel_por_sha(_e public.clicksign_envelopes, _sha text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN nullif(s.v->>'label', '') IS NOT NULL THEN s.v->>'label'
    WHEN s.v->>'papel' = 'proprietario_1' THEN 'Proprietário 1'
    WHEN s.v->>'papel' = 'proprietario_2' THEN 'Proprietário 2'
    WHEN s.v->>'papel' = 'corretor' THEN 'Corretor'
    WHEN s.v->>'papel' IN ('imobiliaria','testemunha') THEN
      CASE s.v->>'papel' WHEN 'imobiliaria' THEN 'Imobiliária ' ELSE 'Testemunha ' END
      || (SELECT count(*) FROM jsonb_array_elements(_e.signers) WITH ORDINALITY x(v, n)
          WHERE x.n <= s.n AND x.v->>'papel' = s.v->>'papel')::text
    ELSE 'Um signatário' END
  FROM jsonb_array_elements(_e.signers) WITH ORDINALITY s(v, n)
  WHERE s.v->>'email_sha256' = _sha LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.clicksign_papel_por_sha(public.clicksign_envelopes, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_papel_por_sha(public.clicksign_envelopes, text) TO service_role;

-- Webhook "sign" (cada assinatura): só sino. _sha = sha256 do e-mail do payload (ou NULL); _evento =
-- id do evento recebido (idempotência quando o payload não traz o e-mail). Retorna o nº de avisos.
CREATE FUNCTION public.clicksign_aviso_assinou(_envelope uuid, _sha text, _evento bigint)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _papel text; _feitas integer; _total integer; _chave text;
BEGIN
  IF _sha IS NOT NULL AND _sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Assinatura inválida'; END IF;
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope;
  IF NOT FOUND OR _e.status NOT IN ('running','closed') THEN RETURN 0; END IF;
  _papel := CASE WHEN _sha IS NULL THEN NULL ELSE public.clicksign_papel_por_sha(_e, _sha) END;
  _chave := 'assinou:' || coalesce(_sha, 'ev' || coalesce(_evento, 0)::text);
  _total := jsonb_array_length(_e.signers);
  _feitas := (SELECT count(*) FROM public.clicksign_avisos a
    WHERE a.envelope_id = _envelope AND a.chave LIKE 'assinou:%' AND a.chave <> _chave) + 1;
  RETURN public.clicksign_aviso(_e, _chave, 'assinou',
    public.clicksign_aviso_rotulo(_e) || ': ' || coalesce(_papel, 'um signatário') || ' assinou',
    'Assinatura registrada na Clicksign' || CASE WHEN _total > 0
      THEN ' (' || least(_feitas, _total) || ' de ' || _total || ')' ELSE '' END || '.',
    false, NULL);
END $$;
REVOKE ALL ON FUNCTION public.clicksign_aviso_assinou(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_aviso_assinou(uuid, text, bigint) TO service_role;

-- Lembrete do prazo (rotina de 5 min): envelope ainda em assinatura, vencendo em até 3 dias, a partir
-- das 9h e até 19h59 de Brasília. 1 vez por envelope. Retorna quantos envelopes foram avisados.
CREATE FUNCTION public.clicksign_lembrete_prazo(_agora timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _n integer := 0; _h integer;
BEGIN
  _h := extract(hour FROM _agora AT TIME ZONE 'America/Sao_Paulo')::integer;
  IF _h < 9 OR _h >= 20 THEN RETURN 0; END IF;
  FOR _e IN SELECT * FROM public.clicksign_envelopes e
      WHERE e.status = 'running' AND e.deadline_at > _agora AND e.deadline_at <= _agora + interval '3 days'
        AND NOT EXISTS (SELECT 1 FROM public.clicksign_avisos a WHERE a.envelope_id = e.id AND a.chave = 'prazo_perto')
  LOOP
    PERFORM public.clicksign_aviso(_e, 'prazo_perto', 'prazo_perto',
      public.clicksign_aviso_rotulo(_e) || ': prazo da assinatura perto de vencer',
      'O prazo na Clicksign vence em ' || public.clicksign_data_br(_e.deadline_at)
        || ' e ainda falta assinatura.', true, NULL);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_lembrete_prazo(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_lembrete_prazo(timestamptz) TO service_role;

-- Fila do WhatsApp para a rotina do Worker (service_role). Telefone, ativo e preferência lidos na hora
-- do envio. prazo_perto de envelope que já fechou/cancelou volta com env_status <> 'running' (não envia).
CREATE FUNCTION public.clicksign_whatsapp_pendentes(_limite integer DEFAULT 50)
RETURNS TABLE (id bigint, evento text, origem text, ref_id uuid, rotulo text, prazo text,
  env_status text, telefone text, ativo boolean, quer_whatsapp boolean, is_test boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT f.id, f.evento, coalesce(e.origem, 'captacao'),
    CASE WHEN e.origem = 'venda' THEN e.sale_id ELSE e.capture_id END,
    public.clicksign_aviso_rotulo(e), public.clicksign_data_br(e.deadline_at), e.status,
    p.telefone, p.ativo IS NOT FALSE,
    coalesce((SELECT bool_or(r.notificar_whatsapp IS NOT FALSE) FROM public.user_roles r
      WHERE r.user_id = f.user_id AND r.organization_id = f.organization_id), true),
    e.is_test
  FROM public.clicksign_whatsapp_fila f
  JOIN public.clicksign_envelopes e ON e.id = f.envelope_id
  JOIN public.profiles p ON p.id = f.user_id AND p.organization_id = f.organization_id
  WHERE f.sent_at IS NULL AND f.attempts < 3 AND f.created_at > now() - interval '2 days'
  ORDER BY f.created_at LIMIT least(greatest(_limite, 1), 200)
$$;
REVOKE ALL ON FUNCTION public.clicksign_whatsapp_pendentes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_whatsapp_pendentes(integer) TO service_role;

-- Resultado do envio: ok = enviado; ignorado (sem telefone, inativo, WhatsApp desligado, prazo já
-- resolvido) também encerra; erro conta tentativa (até 3).
CREATE FUNCTION public.clicksign_whatsapp_marcar(_id bigint, _resultado text, _erro text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _resultado NOT IN ('ok','ignorado','erro') THEN RAISE EXCEPTION 'Resultado inválido'; END IF;
  UPDATE public.clicksign_whatsapp_fila SET
    sent_at = CASE WHEN _resultado IN ('ok','ignorado') THEN now() END,
    attempts = attempts + CASE WHEN _resultado = 'erro' THEN 1 ELSE 0 END,
    last_error = CASE WHEN _resultado = 'ok' THEN NULL
      ELSE left(regexp_replace(coalesce(_erro, _resultado), '[^ ]*@[^ ]*', '[email]', 'g'), 200) END
  WHERE id = _id;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_whatsapp_marcar(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_whatsapp_marcar(bigint, text, text) TO service_role;
