-- Dados para pagamento da equipe: qualquer pessoa com acesso à venda preenche (card t_19cd1fc1).
-- Nova regra de Denis (16/10/2026, tópico 6238, opção 2), substitui a decisão 2 de t_a4ef3b48:
--   * Na CÓPIA POR VENDA (sale_dados_pagamento), qualquer usuário ativo da mesma organização que
--     enxerga a venda (can_view_sale) pode criar/alterar os dados de qualquer pessoa da equipe.
--     Quem não enxerga a venda ou é de outra organização continua sem gravar.
--   * Cada registro guarda quem preencheu e quando (preenchido_por / preenchido_em).
--   * O CADASTRO (corretor_dados_pagamento, "Meu acesso") continua só do dono: ninguém altera o
--     cadastro bancário de outra pessoa. _salvar_cadastro só é aceito quando a pessoa é o próprio usuário.
--   * Visualização não muda: completo só para o dono, admin/super_admin e financeiro; demais mascarado.
-- Depende de 20261016220000_dados_pagamento_equipe.sql. Rollback: supabase/rollback/20261016230000_*.sql
BEGIN;

-- 1) Quem preencheu e quando ----------------------------------------------------------------------
ALTER TABLE public.sale_dados_pagamento
  ADD COLUMN IF NOT EXISTS preenchido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preenchido_em timestamptz;

-- Registros anteriores só podiam ser gravados pelo próprio dono (regra antiga).
UPDATE public.sale_dados_pagamento
   SET preenchido_por = user_id, preenchido_em = updated_at
 WHERE preenchido_por IS NULL;

-- 2) Gravar o bloco de uma pessoa da equipe na venda ---------------------------------------------
-- _user_id: pessoa da equipe cujo bloco será gravado (NULL = o próprio usuário).
-- _usar_cadastro: copia a conta salva no cadastro DESSA pessoa (o valor não volta para quem chama).
-- _salvar_cadastro: só permitido quando _user_id = usuário logado.
CREATE OR REPLACE FUNCTION public.salvar_dados_pagamento_venda(
  _sale_id uuid, _user_id uuid, _modo text, _usar_cadastro boolean DEFAULT false,
  _dados jsonb DEFAULT '{}'::jsonb, _salvar_cadastro boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  _me uuid := auth.uid(); _org uuid := public.current_org_id();
  _alvo uuid := coalesce(_user_id, auth.uid());
  _sale_org uuid; _status text;
  _cad public.corretor_dados_pagamento%ROWTYPE;
  _titular text; _documento text; _tipo_conta text; _banco text; _agencia text; _conta text;
  _pix_tipo text; _pix_chave text;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  SELECT s.organization_id, s.status::text INTO _sale_org, _status FROM public.sales s WHERE s.id = _sale_id;
  IF _sale_org IS NULL OR _sale_org <> _org OR NOT coalesce(public.can_view_sale(_me, _sale_id), false) THEN
    RAISE EXCEPTION 'Venda não encontrada' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sale_equipe_pagamento(_sale_id) p WHERE p.user_id = _alvo) THEN
    RAISE EXCEPTION 'Essa pessoa não está na equipe desta venda' USING ERRCODE = '42501';
  END IF;
  IF _status IN ('arquivada', 'cancelada', 'ocorrencia_concluida') THEN
    RAISE EXCEPTION 'Venda encerrada: os dados de pagamento não podem mais ser alterados' USING ERRCODE = '42501';
  END IF;
  IF _modo IS NULL OR _modo NOT IN ('imobiliaria', 'conta_propria') THEN
    RAISE EXCEPTION 'Escolha como vai receber' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_salvar_cadastro, false) AND _alvo <> _me THEN
    RAISE EXCEPTION 'Só a própria pessoa altera o cadastro bancário dela' USING ERRCODE = '42501';
  END IF;

  IF _modo = 'conta_propria' THEN
    IF coalesce(_usar_cadastro, false) THEN
      SELECT * INTO _cad FROM public.corretor_dados_pagamento c WHERE c.organization_id = _org AND c.user_id = _alvo;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ainda não há conta salva no cadastro dessa pessoa' USING ERRCODE = '22023';
      END IF;
      _titular := _cad.titular; _documento := _cad.documento; _tipo_conta := _cad.tipo_conta;
      _banco := _cad.banco; _agencia := _cad.agencia; _conta := _cad.conta;
      _pix_tipo := _cad.pix_tipo; _pix_chave := _cad.pix_chave;
    ELSE
      _dados := coalesce(_dados, '{}'::jsonb);
      _titular := nullif(btrim(_dados->>'titular'), '');
      _documento := nullif(btrim(_dados->>'documento'), '');
      _tipo_conta := nullif(btrim(_dados->>'tipo_conta'), '');
      _banco := nullif(btrim(_dados->>'banco'), '');
      _agencia := nullif(btrim(_dados->>'agencia'), '');
      _conta := nullif(btrim(_dados->>'conta'), '');
      _pix_tipo := nullif(btrim(_dados->>'pix_tipo'), '');
      _pix_chave := nullif(btrim(_dados->>'pix_chave'), '');
      IF coalesce(_salvar_cadastro, false) THEN
        INSERT INTO public.corretor_dados_pagamento AS c (organization_id, user_id, recebe_pela_imobiliaria,
          titular, documento, tipo_conta, banco, agencia, conta, pix_tipo, pix_chave)
        VALUES (_org, _me, false, _titular, _documento, _tipo_conta, _banco, _agencia, _conta, _pix_tipo, _pix_chave)
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          recebe_pela_imobiliaria = false, titular = EXCLUDED.titular, documento = EXCLUDED.documento,
          tipo_conta = EXCLUDED.tipo_conta, banco = EXCLUDED.banco, agencia = EXCLUDED.agencia,
          conta = EXCLUDED.conta, pix_tipo = EXCLUDED.pix_tipo, pix_chave = EXCLUDED.pix_chave;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.sale_dados_pagamento AS d (organization_id, sale_id, user_id, modo, titular, documento,
    tipo_conta, banco, agencia, conta, pix_tipo, pix_chave, preenchido_por, preenchido_em)
  VALUES (_org, _sale_id, _alvo, _modo, _titular, _documento, _tipo_conta, _banco, _agencia, _conta,
          _pix_tipo, _pix_chave, _me, now())
  ON CONFLICT (sale_id, user_id) DO UPDATE SET
    modo = EXCLUDED.modo, titular = EXCLUDED.titular, documento = EXCLUDED.documento,
    tipo_conta = EXCLUDED.tipo_conta, banco = EXCLUDED.banco, agencia = EXCLUDED.agencia,
    conta = EXCLUDED.conta, pix_tipo = EXCLUDED.pix_tipo, pix_chave = EXCLUDED.pix_chave,
    preenchido_por = EXCLUDED.preenchido_por, preenchido_em = EXCLUDED.preenchido_em;
END $function$;
REVOKE ALL ON FUNCTION public.salvar_dados_pagamento_venda(uuid, uuid, text, boolean, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_dados_pagamento_venda(uuid, uuid, text, boolean, jsonb, boolean)
  TO authenticated, service_role;

-- Compatibilidade: a tela antiga (até o deploy) continua gravando o próprio bloco.
CREATE OR REPLACE FUNCTION public.salvar_meus_dados_pagamento_venda(
  _sale_id uuid, _modo text, _usar_cadastro boolean DEFAULT false,
  _dados jsonb DEFAULT '{}'::jsonb, _salvar_cadastro boolean DEFAULT false)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT public.salvar_dados_pagamento_venda(_sale_id, auth.uid(), _modo, _usar_cadastro, _dados, _salvar_cadastro);
$function$;
REVOKE ALL ON FUNCTION public.salvar_meus_dados_pagamento_venda(uuid, text, boolean, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_meus_dados_pagamento_venda(uuid, text, boolean, jsonb, boolean)
  TO authenticated, service_role;

-- 3) Leitura por venda: mesma máscara de antes + quem preencheu e quando -------------------------
-- O tipo de retorno muda (colunas novas no fim), então é preciso recriar.
DROP FUNCTION IF EXISTS public.venda_dados_pagamento(uuid);
CREATE FUNCTION public.venda_dados_pagamento(_sale_id uuid)
RETURNS TABLE(user_id uuid, nome text, origem text, modo text, completo boolean, tem_cadastro boolean,
              dados_completos boolean, titular text, documento text, tipo_conta text, banco text,
              agencia text, conta text, pix_tipo text, pix_chave text,
              preenchido_por uuid, preenchido_por_nome text, preenchido_em timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _sale_org uuid; _priv boolean;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  SELECT s.organization_id INTO _sale_org FROM public.sales s WHERE s.id = _sale_id;
  IF _sale_org IS NULL OR _sale_org <> _org OR NOT coalesce(public.can_view_sale(_me, _sale_id), false) THEN
    RAISE EXCEPTION 'Venda não encontrada' USING ERRCODE = '42501';
  END IF;
  _priv := coalesce(public.has_any_role(_me, ARRAY['admin', 'super_admin', 'financeiro']::public.app_role[]), false);
  RETURN QUERY
  WITH eq AS (SELECT p.user_id FROM public.sale_equipe_pagamento(_sale_id) p),
  base AS (
    SELECT eq.user_id, pr.nome,
           CASE WHEN v.id IS NOT NULL THEN 'venda' WHEN c.user_id IS NOT NULL THEN 'cadastro' ELSE 'nenhum' END AS origem,
           CASE WHEN v.id IS NOT NULL THEN v.modo
                WHEN c.recebe_pela_imobiliaria THEN 'imobiliaria' ELSE 'conta_propria' END AS modo,
           (c.user_id IS NOT NULL) AS tem_cadastro,
           (eq.user_id = _me OR _priv) AS ve_tudo,
           CASE WHEN v.id IS NOT NULL THEN v.titular ELSE c.titular END AS titular,
           CASE WHEN v.id IS NOT NULL THEN v.documento ELSE c.documento END AS documento,
           CASE WHEN v.id IS NOT NULL THEN v.tipo_conta ELSE c.tipo_conta END AS tipo_conta,
           CASE WHEN v.id IS NOT NULL THEN v.banco ELSE c.banco END AS banco,
           CASE WHEN v.id IS NOT NULL THEN v.agencia ELSE c.agencia END AS agencia,
           CASE WHEN v.id IS NOT NULL THEN v.conta ELSE c.conta END AS conta,
           CASE WHEN v.id IS NOT NULL THEN v.pix_tipo ELSE c.pix_tipo END AS pix_tipo,
           CASE WHEN v.id IS NOT NULL THEN v.pix_chave ELSE c.pix_chave END AS pix_chave,
           v.preenchido_por, pp.nome AS preenchido_por_nome, v.preenchido_em
      FROM eq
      LEFT JOIN public.profiles pr ON pr.id = eq.user_id
      LEFT JOIN public.sale_dados_pagamento v ON v.sale_id = _sale_id AND v.user_id = eq.user_id
                                              AND v.organization_id = _org
      LEFT JOIN public.profiles pp ON pp.id = v.preenchido_por
      LEFT JOIN public.corretor_dados_pagamento c ON c.organization_id = _org AND c.user_id = eq.user_id
  )
  SELECT b.user_id, b.nome, b.origem, b.modo,
         (b.titular IS NOT NULL AND (b.pix_chave IS NOT NULL
           OR (b.banco IS NOT NULL AND b.agencia IS NOT NULL AND b.conta IS NOT NULL))) AS completo,
         b.tem_cadastro, b.ve_tudo,
         b.titular,
         CASE WHEN b.ve_tudo THEN b.documento ELSE public.pagamento_mascarar(b.documento) END,
         b.tipo_conta, b.banco,
         CASE WHEN b.ve_tudo THEN b.agencia ELSE public.pagamento_mascarar(b.agencia) END,
         CASE WHEN b.ve_tudo THEN b.conta ELSE public.pagamento_mascarar(b.conta) END,
         b.pix_tipo,
         CASE WHEN b.ve_tudo THEN b.pix_chave ELSE public.pagamento_mascarar(b.pix_chave) END,
         b.preenchido_por, b.preenchido_por_nome, b.preenchido_em
    FROM base b
   ORDER BY b.nome;
END $function$;
REVOKE ALL ON FUNCTION public.venda_dados_pagamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venda_dados_pagamento(uuid) TO authenticated, service_role;

COMMIT;
