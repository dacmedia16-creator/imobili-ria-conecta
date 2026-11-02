-- Depoimentos do ADM MAX (t_c7cfaf00, pedido de Denis em 02/11/2026, tópico 6238).
--
-- Fluxo: convite no sistema (ou link /depoimento) -> nota de 1 a 5 ->
--   4 ou 5: "o que mudou" (obrigatória), "tarefa mais fácil" e "frase para um colega" (opcionais);
--   1 a 3: "o que podemos melhorar" -> feedback INTERNO, nunca vai para a vitrine.
-- Publicar exige a autorização marcada (versão do texto + data/hora gravadas). Sem ela = interno.
-- Moderação (aprovar / recusar / remover / corrigir digitação) só pelo dono da PLATAFORMA
-- (platform_admins). A vitrine pública lê só depoimentos_publicos(): aprovados + autorizados + não
-- retirados, com foto, nome abreviado, papel, imobiliária, cidade, nota, frase e texto.
-- Nada de e-mail, telefone, CPF, ID RE/MAX ou ids internos na saída pública.
--
-- LGPD: tabelas sem acesso direto (nem SELECT) para anon/authenticated; tudo por RPCs SECURITY
-- DEFINER com search_path vazio. Cada pessoa vê/retira só os próprios; "Entrar como" e visão da
-- plataforma não enviam nem retiram (ficha_sessao_restrita). Histórico em depoimento_eventos.
--
-- Convite automático (critério proposto pela tecnologia, medido em 02/11/2026 = 87 pessoas):
--   conta criada há 14+ dias E pelo menos 1 ação real (documento enviado/aprovado/arquivado,
--   mudança de status de venda, ocorrência aberta/concluída, lançamento criado ou captação própria);
--   sem envio nos últimos 180 dias; não recusou ("Não quero"); fora do adiamento ("Agora não" = 30 dias).
--
-- Rollback: supabase/rollback/20261102120000_depoimentos.sql
-- Sem BEGIN/COMMIT próprios (igual às migrations recentes): o teste a inclui numa transação desfeita.

-- 1) Tabelas ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.depoimento_termos (
  versao text PRIMARY KEY,
  texto text NOT NULL,
  vigente boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS depoimento_termos_um_vigente ON public.depoimento_termos (vigente) WHERE vigente;
ALTER TABLE public.depoimento_termos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.depoimento_termos FROM PUBLIC, anon, authenticated;
INSERT INTO public.depoimento_termos (versao, texto, vigente) VALUES
  ('v1-2026-11-02',
   'Autorizo usar meu nome, foto, imobiliária e este depoimento na divulgação do ADM MAX.', true)
ON CONFLICT (versao) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.depoimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  nota smallint NOT NULL CHECK (nota BETWEEN 1 AND 5),
  -- Respostas do autor (nunca editadas; correção de digitação vai nas colunas *_corrigido).
  mudou text CHECK (mudou IS NULL OR char_length(mudou) <= 600),
  tarefa text CHECK (tarefa IS NULL OR char_length(tarefa) <= 300),
  frase text CHECK (frase IS NULL OR char_length(frase) <= 160),
  melhorar text CHECK (melhorar IS NULL OR char_length(melhorar) <= 1000),
  -- interno = feedback (nota 1–3 ou sem autorização); nunca aparece na vitrine.
  status text NOT NULL CHECK (status IN ('interno', 'pendente', 'aprovado', 'recusado', 'removido')),
  origem text NOT NULL DEFAULT 'convite' CHECK (origem IN ('convite', 'link')),
  -- Autorização (LGPD): data/hora, versão do texto e o próprio usuário (user_id).
  consentimento boolean NOT NULL DEFAULT false,
  consentimento_em timestamptz,
  consentimento_versao text REFERENCES public.depoimento_termos(versao),
  -- Como vai aparecer (gravado no envio = o que a pessoa viu na prévia).
  nome_completo text NOT NULL,
  nome_exibicao text NOT NULL,
  papel_exibicao text NOT NULL,
  imobiliaria_exibicao text NOT NULL,
  cidade_exibicao text,
  foto_url text,
  -- Moderação
  moderado_por uuid REFERENCES auth.users(id),
  moderado_em timestamptz,
  motivo_moderacao text CHECK (motivo_moderacao IS NULL OR char_length(motivo_moderacao) <= 300),
  aprovado_em timestamptz,
  -- Correção de digitação (o original continua acima, intacto).
  mudou_corrigido text CHECK (mudou_corrigido IS NULL OR char_length(mudou_corrigido) <= 600),
  tarefa_corrigido text CHECK (tarefa_corrigido IS NULL OR char_length(tarefa_corrigido) <= 300),
  frase_corrigido text CHECK (frase_corrigido IS NULL OR char_length(frase_corrigido) <= 160),
  corrigido_por uuid REFERENCES auth.users(id),
  corrigido_em timestamptz,
  -- Retirada pelo autor (revogação): não volta a ser publicado.
  revogado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT depoimentos_publicavel CHECK (
    status NOT IN ('pendente', 'aprovado')
    OR (nota >= 4 AND consentimento AND consentimento_em IS NOT NULL AND consentimento_versao IS NOT NULL
        AND revogado_em IS NULL AND char_length(btrim(coalesce(mudou, ''))) >= 10)),
  CONSTRAINT depoimentos_nota_baixa_interna CHECK (nota >= 4 OR (status = 'interno' AND NOT consentimento)),
  CONSTRAINT depoimentos_aprovado_data CHECK (status <> 'aprovado' OR aprovado_em IS NOT NULL)
);
-- Um depoimento "vivo" (pendente/aprovado) por pessoa; feedback interno pode ter vários.
CREATE UNIQUE INDEX IF NOT EXISTS depoimentos_um_vivo_por_usuario
  ON public.depoimentos (user_id) WHERE status IN ('pendente', 'aprovado');
CREATE INDEX IF NOT EXISTS depoimentos_status_idx ON public.depoimentos (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS depoimentos_user_idx ON public.depoimentos (user_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS depoimentos_org_idx ON public.depoimentos (organization_id);
ALTER TABLE public.depoimentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.depoimentos FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.depoimentos IS
  'Depoimentos/feedback do ADM MAX (t_c7cfaf00). Sem acesso direto: só RPCs depoimento_* e depoimentos_publicos().';

CREATE TABLE IF NOT EXISTS public.depoimento_convites (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  adiado_ate timestamptz,
  recusado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.depoimento_convites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.depoimento_convites FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.depoimento_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  depoimento_id uuid NOT NULL REFERENCES public.depoimentos(id) ON DELETE CASCADE,
  acao text NOT NULL,
  ator_id uuid REFERENCES auth.users(id),
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS depoimento_eventos_dep_idx ON public.depoimento_eventos (depoimento_id, em);
ALTER TABLE public.depoimento_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.depoimento_eventos FROM PUBLIC, anon, authenticated;

-- 2) Helpers ---------------------------------------------------------------------------------------
-- "Maria Aparecida da Silva" -> "Maria S." (ignora da/de/do/dos/das/e).
CREATE OR REPLACE FUNCTION public.depoimento_nome_abreviado(_nome text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  WITH p AS (
    SELECT array_remove(array_agg(w ORDER BY i), NULL) AS ws
    FROM unnest(regexp_split_to_array(btrim(coalesce(_nome, '')), '\s+')) WITH ORDINALITY AS t(w, i)
    WHERE w <> '' AND lower(w) NOT IN ('da', 'de', 'do', 'dos', 'das', 'e')
  )
  SELECT CASE
    WHEN coalesce(array_length(ws, 1), 0) = 0 THEN 'Usuário ADM MAX'
    WHEN array_length(ws, 1) = 1 THEN initcap(ws[1])
    ELSE initcap(ws[1]) || ' ' || upper(left(ws[array_length(ws, 1)], 1)) || '.'
  END FROM p
$$;
REVOKE ALL ON FUNCTION public.depoimento_nome_abreviado(text) FROM PUBLIC, anon, authenticated;

-- Papel para a vitrine (o mais representativo que a pessoa tem na imobiliária).
CREATE OR REPLACE FUNCTION public.depoimento_papel(_uid uuid, _org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((
    SELECT CASE r.role::text
      WHEN 'super_admin' THEN 'Administrador(a)'
      WHEN 'admin' THEN 'Administrador(a)'
      WHEN 'gestor' THEN 'Gestor(a)'
      WHEN 'team_leader' THEN 'Team Leader'
      WHEN 'coordenador' THEN 'Coordenador(a)'
      WHEN 'staff' THEN 'Staff'
      WHEN 'financeiro' THEN 'Financeiro'
      WHEN 'juridico' THEN 'Jurídico'
      WHEN 'lancamento' THEN 'Lançamentos'
      ELSE 'Corretor(a)' END
    FROM public.user_roles r
    WHERE r.user_id = _uid AND (r.organization_id = _org OR r.organization_id IS NULL)
    ORDER BY array_position(ARRAY['super_admin','admin','gestor','team_leader','coordenador','staff',
                                  'financeiro','juridico','lancamento','corretor'], r.role::text)
    LIMIT 1), 'Corretor(a)')
$$;
REVOKE ALL ON FUNCTION public.depoimento_papel(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Uso real: pelo menos 1 ação relevante registrada OU uma captação própria.
CREATE OR REPLACE FUNCTION public.depoimento_tem_uso_real(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.activity_logs a
    WHERE a.autor_id = _uid
      AND a.acao IN ('document_uploaded', 'status_change', 'document_approved', 'document_archived',
                     'document_reused_from_other_party', 'occurrence_created', 'occurrence_concluded',
                     'lancamento_criado'))
  OR EXISTS (SELECT 1 FROM public.exclusive_captures c WHERE c.captor_id = _uid)
$$;
REVOKE ALL ON FUNCTION public.depoimento_tem_uso_real(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.depoimento_eh_moderador() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.depoimento_eh_moderador() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depoimento_eh_moderador() TO authenticated;

-- 3) Própria pessoa --------------------------------------------------------------------------------
-- Situação: se o convite automático deve abrir agora, a prévia (como vai aparecer) e o que já enviou.
CREATE OR REPLACE FUNCTION public.depoimento_minha_situacao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _criado timestamptz;
  _conv public.depoimento_convites;
  _p public.profiles;
  _o public.organizations;
  _motivo text := NULL;
  _termo public.depoimento_termos;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RETURN jsonb_build_object('pode_enviar', false, 'convite', false, 'motivo', 'sessao_restrita');
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _uid) THEN
    RETURN jsonb_build_object('pode_enviar', false, 'convite', false, 'motivo', 'plataforma');
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN
    RETURN jsonb_build_object('pode_enviar', false, 'convite', false, 'motivo', 'sem_imobiliaria');
  END IF;

  SELECT * INTO _p FROM public.profiles WHERE id = _uid;
  SELECT * INTO _o FROM public.organizations WHERE id = _org;
  SELECT * INTO _conv FROM public.depoimento_convites WHERE user_id = _uid;
  SELECT u.created_at INTO _criado FROM auth.users u WHERE u.id = _uid;
  SELECT * INTO _termo FROM public.depoimento_termos WHERE vigente;

  IF _conv.recusado_em IS NOT NULL THEN _motivo := 'recusou';
  ELSIF _conv.adiado_ate IS NOT NULL AND _conv.adiado_ate > now() THEN _motivo := 'adiado';
  ELSIF EXISTS (SELECT 1 FROM public.depoimentos d WHERE d.user_id = _uid
                  AND (d.status IN ('pendente', 'aprovado') OR d.criado_em > now() - interval '180 days'))
    THEN _motivo := 'ja_enviou';
  ELSIF _criado IS NULL OR _criado > now() - interval '14 days' THEN _motivo := 'conta_nova';
  ELSIF NOT public.depoimento_tem_uso_real(_uid) THEN _motivo := 'sem_uso';
  END IF;

  RETURN jsonb_build_object(
    'pode_enviar', true,
    'convite', _motivo IS NULL,
    'motivo', coalesce(_motivo, 'elegivel'),
    'termo', jsonb_build_object('versao', _termo.versao, 'texto', _termo.texto),
    'previa', jsonb_build_object(
      'nome_exibicao', public.depoimento_nome_abreviado(_p.nome),
      'papel', public.depoimento_papel(_uid, _org),
      'imobiliaria', _o.nome,
      'cidade', _o.cidade,
      'foto_url', _p.avatar_url),
    'meus', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'nota', d.nota, 'status', d.status, 'consentimento', d.consentimento,
        'mudou', d.mudou, 'tarefa', d.tarefa, 'frase', d.frase, 'melhorar', d.melhorar,
        'criado_em', d.criado_em, 'revogado_em', d.revogado_em) ORDER BY d.criado_em DESC)
      FROM public.depoimentos d WHERE d.user_id = _uid), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.depoimento_minha_situacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depoimento_minha_situacao() TO authenticated;

-- "Agora não" (volta em 30 dias) / "Não quero" (não pergunta mais).
CREATE OR REPLACE FUNCTION public.depoimento_responder_convite(_resposta text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR public.ficha_sessao_restrita() THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  IF _resposta NOT IN ('agora_nao', 'nao_quero') THEN
    RAISE EXCEPTION 'Resposta invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.depoimento_convites AS c (user_id, adiado_ate, recusado_em)
  VALUES (_uid,
          CASE WHEN _resposta = 'agora_nao' THEN now() + interval '30 days' END,
          CASE WHEN _resposta = 'nao_quero' THEN now() END)
  ON CONFLICT (user_id) DO UPDATE SET
    adiado_ate = CASE WHEN _resposta = 'agora_nao' THEN now() + interval '30 days' ELSE c.adiado_ate END,
    recusado_em = CASE WHEN _resposta = 'nao_quero' THEN now() ELSE c.recusado_em END,
    atualizado_em = now();
END $$;
REVOKE ALL ON FUNCTION public.depoimento_responder_convite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depoimento_responder_convite(text) TO authenticated;

-- Envio. O banco decide o destino: nota 1–3 ou sem autorização = interno; 4–5 com autorização = pendente.
CREATE OR REPLACE FUNCTION public.depoimento_enviar(
  _nota integer,
  _mudou text,
  _tarefa text,
  _frase text,
  _melhorar text,
  _autorizo boolean,
  _termo_versao text,
  _origem text DEFAULT 'convite'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _p public.profiles;
  _o public.organizations;
  _termo public.depoimento_termos;
  _m text := nullif(btrim(regexp_replace(coalesce(_mudou, ''), '[ \t]+', ' ', 'g')), '');
  _t text := nullif(btrim(regexp_replace(coalesce(_tarefa, ''), '[ \t]+', ' ', 'g')), '');
  _f text := nullif(btrim(regexp_replace(coalesce(_frase, ''), '\s+', ' ', 'g')), '');
  _mel text := nullif(btrim(coalesce(_melhorar, '')), '');
  _publica boolean;
  _status text;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RAISE EXCEPTION 'O depoimento so pode ser enviado pela propria pessoa' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _uid) THEN
    RAISE EXCEPTION 'Conta da plataforma nao envia depoimento' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN RAISE EXCEPTION 'Sem imobiliaria ativa' USING ERRCODE = '42501'; END IF;
  IF _nota IS NULL OR _nota < 1 OR _nota > 5 THEN
    RAISE EXCEPTION 'Escolha uma nota de 1 a 5' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_origem, '') NOT IN ('convite', 'link') THEN _origem := 'convite'; END IF;

  IF _nota <= 3 THEN
    IF _mel IS NULL OR char_length(_mel) < 3 THEN
      RAISE EXCEPTION 'Conte o que podemos melhorar' USING ERRCODE = '22023';
    END IF;
    IF char_length(_mel) > 1000 THEN RAISE EXCEPTION 'Texto muito longo' USING ERRCODE = '22023'; END IF;
    _m := NULL; _t := NULL; _f := NULL; _publica := false;
  ELSE
    IF _m IS NULL OR char_length(_m) < 10 THEN
      RAISE EXCEPTION 'Conte o que mudou no seu trabalho (pelo menos 10 letras)' USING ERRCODE = '22023';
    END IF;
    IF char_length(_m) > 600 THEN RAISE EXCEPTION 'Resposta muito longa (max. 600)' USING ERRCODE = '22023'; END IF;
    IF _t IS NOT NULL AND char_length(_t) > 300 THEN
      RAISE EXCEPTION 'Resposta muito longa (max. 300)' USING ERRCODE = '22023';
    END IF;
    IF _f IS NOT NULL AND char_length(_f) > 160 THEN
      RAISE EXCEPTION 'Frase muito longa (max. 160)' USING ERRCODE = '22023';
    END IF;
    IF _mel IS NOT NULL AND char_length(_mel) > 1000 THEN
      RAISE EXCEPTION 'Texto muito longo' USING ERRCODE = '22023';
    END IF;
    _publica := _autorizo IS TRUE;
  END IF;

  IF _publica THEN
    SELECT * INTO _termo FROM public.depoimento_termos WHERE vigente;
    IF _termo.versao IS NULL OR _termo_versao IS DISTINCT FROM _termo.versao THEN
      RAISE EXCEPTION 'O texto da autorizacao mudou. Recarregue a pagina.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.depoimentos d WHERE d.user_id = _uid AND d.status IN ('pendente', 'aprovado')) THEN
      RAISE EXCEPTION 'Voce ja tem um depoimento enviado. Retire o anterior para mandar outro.' USING ERRCODE = '23505';
    END IF;
  END IF;
  _status := CASE WHEN _publica THEN 'pendente' ELSE 'interno' END;

  SELECT * INTO _p FROM public.profiles WHERE id = _uid;
  SELECT * INTO _o FROM public.organizations WHERE id = _org;

  INSERT INTO public.depoimentos (user_id, organization_id, nota, mudou, tarefa, frase, melhorar, status,
      origem, consentimento, consentimento_em, consentimento_versao, nome_completo, nome_exibicao,
      papel_exibicao, imobiliaria_exibicao, cidade_exibicao, foto_url)
  VALUES (_uid, _org, _nota, _m, _t, _f, _mel, _status, _origem, _publica,
      CASE WHEN _publica THEN now() END, CASE WHEN _publica THEN _termo.versao END,
      coalesce(nullif(btrim(_p.nome), ''), 'Usuário ADM MAX'), public.depoimento_nome_abreviado(_p.nome),
      public.depoimento_papel(_uid, _org), coalesce(_o.nome, ''), _o.cidade,
      CASE WHEN _publica THEN _p.avatar_url END)
  RETURNING id INTO _id;

  INSERT INTO public.depoimento_eventos (depoimento_id, acao, ator_id, detalhe)
  VALUES (_id, 'enviado', _uid, jsonb_build_object('nota', _nota, 'status', _status, 'origem', _origem,
          'consentimento_versao', CASE WHEN _publica THEN _termo.versao END));

  -- Enviou: o convite automático não volta (a situação também olha os últimos 180 dias).
  INSERT INTO public.depoimento_convites (user_id) VALUES (_uid) ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('id', _id, 'status', _status, 'publicavel', _publica);
END $$;
REVOKE ALL ON FUNCTION public.depoimento_enviar(integer, text, text, text, text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depoimento_enviar(integer, text, text, text, text, boolean, text, text) TO authenticated;

-- Retirar (revogar a autorização): sai da vitrine na hora e não volta a ser aprovado.
CREATE OR REPLACE FUNCTION public.depoimento_retirar(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR public.ficha_sessao_restrita() THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  UPDATE public.depoimentos d
     SET status = CASE WHEN d.status = 'interno' THEN 'interno' ELSE 'removido' END,
         consentimento = false, revogado_em = now(), atualizado_em = now()
   WHERE d.id = _id AND d.user_id = _uid AND d.revogado_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depoimento nao encontrado' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.depoimento_eventos (depoimento_id, acao, ator_id) VALUES (_id, 'retirado_pelo_autor', _uid);
END $$;
REVOKE ALL ON FUNCTION public.depoimento_retirar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depoimento_retirar(uuid) TO authenticated;

-- 4) Moderação (dono da plataforma) ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.depoimento_moderacao_listar() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.depoimento_eh_moderador() THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'nota', d.nota, 'status', d.status, 'origem', d.origem,
      'mudou', d.mudou, 'tarefa', d.tarefa, 'frase', d.frase, 'melhorar', d.melhorar,
      'mudou_corrigido', d.mudou_corrigido, 'tarefa_corrigido', d.tarefa_corrigido,
      'frase_corrigido', d.frase_corrigido, 'corrigido_em', d.corrigido_em,
      'consentimento', d.consentimento, 'consentimento_em', d.consentimento_em,
      'consentimento_versao', d.consentimento_versao,
      'nome_completo', d.nome_completo, 'nome_exibicao', d.nome_exibicao,
      'papel', d.papel_exibicao, 'imobiliaria', d.imobiliaria_exibicao, 'cidade', d.cidade_exibicao,
      'foto_url', d.foto_url, 'motivo_moderacao', d.motivo_moderacao, 'moderado_em', d.moderado_em,
      'aprovado_em', d.aprovado_em, 'revogado_em', d.revogado_em, 'criado_em', d.criado_em)
      ORDER BY (d.status = 'pendente') DESC, d.criado_em DESC)
    FROM public.depoimentos d), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.depoimento_moderacao_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depoimento_moderacao_listar() TO authenticated;

-- aprovar | recusar | remover (da vitrine) | pendente (voltar para análise)
CREATE OR REPLACE FUNCTION public.depoimento_moderar(_id uuid, _acao text, _motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _d public.depoimentos;
  _novo text;
  _mot text := nullif(btrim(coalesce(_motivo, '')), '');
BEGIN
  IF NOT public.depoimento_eh_moderador() THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  _novo := CASE _acao WHEN 'aprovar' THEN 'aprovado' WHEN 'recusar' THEN 'recusado'
                      WHEN 'remover' THEN 'removido' WHEN 'pendente' THEN 'pendente' END;
  IF _novo IS NULL THEN RAISE EXCEPTION 'Acao invalida' USING ERRCODE = '22023'; END IF;
  IF _mot IS NOT NULL AND char_length(_mot) > 300 THEN
    RAISE EXCEPTION 'Motivo muito longo' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _d FROM public.depoimentos WHERE id = _id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Depoimento nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _d.status = 'interno' THEN
    RAISE EXCEPTION 'Feedback interno nao vai para a vitrine' USING ERRCODE = '22023';
  END IF;
  IF _d.revogado_em IS NOT NULL AND _novo IN ('aprovado', 'pendente') THEN
    RAISE EXCEPTION 'O autor retirou este depoimento' USING ERRCODE = '22023';
  END IF;
  IF _novo IN ('aprovado', 'pendente') AND EXISTS (
       SELECT 1 FROM public.depoimentos o WHERE o.user_id = _d.user_id AND o.id <> _d.id
         AND o.status IN ('pendente', 'aprovado')) THEN
    RAISE EXCEPTION 'Esta pessoa ja tem outro depoimento ativo' USING ERRCODE = '23505';
  END IF;

  UPDATE public.depoimentos SET
    status = _novo,
    aprovado_em = CASE WHEN _novo = 'aprovado' THEN now() ELSE NULL END,
    moderado_por = _uid, moderado_em = now(), motivo_moderacao = _mot, atualizado_em = now()
  WHERE id = _id;
  INSERT INTO public.depoimento_eventos (depoimento_id, acao, ator_id, detalhe)
  VALUES (_id, _acao, _uid, jsonb_build_object('de', _d.status, 'para', _novo, 'motivo', _mot));
  RETURN jsonb_build_object('id', _id, 'status', _novo);
END $$;
REVOKE ALL ON FUNCTION public.depoimento_moderar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depoimento_moderar(uuid, text, text) TO authenticated;

-- Correção de digitação: grava a versão corrigida ao lado do original (que não muda) + registro.
-- NULL/vazio = sem correção naquele campo (volta a mostrar o original).
CREATE OR REPLACE FUNCTION public.depoimento_corrigir(_id uuid, _mudou text, _tarefa text, _frase text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _d public.depoimentos;
  _m text := nullif(btrim(coalesce(_mudou, '')), '');
  _t text := nullif(btrim(coalesce(_tarefa, '')), '');
  _f text := nullif(btrim(coalesce(_frase, '')), '');
BEGIN
  IF NOT public.depoimento_eh_moderador() THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _d FROM public.depoimentos WHERE id = _id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Depoimento nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _d.status = 'interno' THEN RAISE EXCEPTION 'Feedback interno nao e corrigido' USING ERRCODE = '22023'; END IF;
  -- Só "digitação": a correção não pode criar campo que o autor deixou vazio nem mudar muito o tamanho.
  IF (_m IS NOT NULL AND (_d.mudou IS NULL OR abs(char_length(_m) - char_length(_d.mudou)) > greatest(10, char_length(_d.mudou) / 5)))
  OR (_t IS NOT NULL AND (_d.tarefa IS NULL OR abs(char_length(_t) - char_length(_d.tarefa)) > greatest(10, char_length(_d.tarefa) / 5)))
  OR (_f IS NOT NULL AND (_d.frase IS NULL OR abs(char_length(_f) - char_length(_d.frase)) > greatest(10, char_length(_d.frase) / 5))) THEN
    RAISE EXCEPTION 'So e permitido corrigir digitacao (sem reescrever o texto)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.depoimentos SET
    mudou_corrigido = CASE WHEN _m IS DISTINCT FROM _d.mudou THEN _m END,
    tarefa_corrigido = CASE WHEN _t IS DISTINCT FROM _d.tarefa THEN _t END,
    frase_corrigido = CASE WHEN _f IS DISTINCT FROM _d.frase THEN _f END,
    corrigido_por = _uid, corrigido_em = now(), atualizado_em = now()
  WHERE id = _id;
  INSERT INTO public.depoimento_eventos (depoimento_id, acao, ator_id, detalhe)
  VALUES (_id, 'corrigido', _uid, jsonb_build_object(
    'antes', jsonb_build_object('mudou', _d.mudou_corrigido, 'tarefa', _d.tarefa_corrigido, 'frase', _d.frase_corrigido),
    'depois', jsonb_build_object(
      'mudou', CASE WHEN _m IS DISTINCT FROM _d.mudou THEN _m END,
      'tarefa', CASE WHEN _t IS DISTINCT FROM _d.tarefa THEN _t END,
      'frase', CASE WHEN _f IS DISTINCT FROM _d.frase THEN _f END)));
END $$;
REVOKE ALL ON FUNCTION public.depoimento_corrigir(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.depoimento_corrigir(uuid, text, text, text) TO authenticated;

-- 5) Vitrine pública (página de vendas) ------------------------------------------------------------
-- Só aprovados + autorizados + não retirados + nota 4–5. Saída mínima, sem ids nem contato.
CREATE OR REPLACE FUNCTION public.depoimentos_publicos()
RETURNS TABLE (foto_url text, nome text, papel text, imobiliaria text, cidade text, nota smallint,
               frase text, texto text, tarefa text, publicado_em date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT d.foto_url, d.nome_exibicao, d.papel_exibicao, d.imobiliaria_exibicao, d.cidade_exibicao, d.nota,
         coalesce(d.frase_corrigido, d.frase), coalesce(d.mudou_corrigido, d.mudou),
         coalesce(d.tarefa_corrigido, d.tarefa), d.aprovado_em::date
  FROM public.depoimentos d
  WHERE d.status = 'aprovado' AND d.consentimento AND d.revogado_em IS NULL AND d.nota >= 4
    AND d.consentimento_em IS NOT NULL AND d.consentimento_versao IS NOT NULL
  ORDER BY d.nota DESC, d.aprovado_em DESC
  LIMIT 30
$$;
REVOKE ALL ON FUNCTION public.depoimentos_publicos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.depoimentos_publicos() TO anon, authenticated;
