-- Dados para pagamento da equipe da venda (card t_a4ef3b48, maquete aprovada por Denis em 16/10/2026).
-- Decisões de Denis (tópico 6238):
--   1) Conta/PIX no CADASTRO do corretor (reaproveitável) + CÓPIA na venda com os dados usados naquela
--      venda e a escolha "pela imobiliária" x "conta própria".
--   2) SOMENTE o próprio corretor grava os dados dele (cadastro e bloco dele na venda). Ninguém grava
--      dados bancários de outra pessoa — nem admin.
--   3) Dados completos só para o próprio corretor, admin/super_admin e financeiro da MESMA organização.
--      Os demais (gestor, team leader, jurídico, outros corretores da venda) veem mascarado.
-- Objetos:
--   corretor_dados_pagamento  — cadastro (1 linha por organização + pessoa). Escrita só do dono (RLS).
--   sale_dados_pagamento      — cópia por venda + pessoa. Sem escrita direta: só pela RPC abaixo.
--   salvar_meus_dados_pagamento_venda(...) — grava o bloco do usuário logado numa venda em que ele
--                                            participa (e, se pedido, salva também no cadastro).
--   venda_dados_pagamento(_sale_id)        — status + dados por pessoa da equipe, mascarados conforme
--                                            o perfil de quem pergunta.
-- Não altera sale_bank_accounts (partes do imóvel) nem os campos da parceria externa.
BEGIN;

-- 1) Cadastro do corretor ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corretor_dados_pagamento (
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  recebe_pela_imobiliaria boolean NOT NULL DEFAULT false,
  titular text CHECK (titular IS NULL OR length(titular) <= 120),
  documento text CHECK (documento IS NULL OR length(documento) <= 20),
  tipo_conta text CHECK (tipo_conta IS NULL OR tipo_conta IN ('corrente', 'poupanca')),
  banco text CHECK (banco IS NULL OR length(banco) <= 80),
  agencia text CHECK (agencia IS NULL OR length(agencia) <= 10),
  conta text CHECK (conta IS NULL OR length(conta) <= 20),
  pix_tipo text CHECK (pix_tipo IS NULL OR pix_tipo IN ('cpf', 'cnpj', 'email', 'celular', 'aleatoria')),
  pix_chave text CHECK (pix_chave IS NULL OR length(pix_chave) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- 2) Cópia por venda --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_dados_pagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  modo text NOT NULL CHECK (modo IN ('imobiliaria', 'conta_propria')),
  titular text CHECK (titular IS NULL OR length(titular) <= 120),
  documento text CHECK (documento IS NULL OR length(documento) <= 20),
  tipo_conta text CHECK (tipo_conta IS NULL OR tipo_conta IN ('corrente', 'poupanca')),
  banco text CHECK (banco IS NULL OR length(banco) <= 80),
  agencia text CHECK (agencia IS NULL OR length(agencia) <= 10),
  conta text CHECK (conta IS NULL OR length(conta) <= 20),
  pix_tipo text CHECK (pix_tipo IS NULL OR pix_tipo IN ('cpf', 'cnpj', 'email', 'celular', 'aleatoria')),
  pix_chave text CHECK (pix_chave IS NULL OR length(pix_chave) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, user_id)
);
CREATE INDEX IF NOT EXISTS sale_dados_pagamento_org_user ON public.sale_dados_pagamento (organization_id, user_id);

CREATE OR REPLACE FUNCTION public.dados_pagamento_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dados_pagamento_touch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_corretor_dados_pagamento_touch BEFORE UPDATE ON public.corretor_dados_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.dados_pagamento_touch();
CREATE TRIGGER trg_sale_dados_pagamento_touch BEFORE UPDATE ON public.sale_dados_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.dados_pagamento_touch();

-- RLS do cadastro: lê o dono, admin/super_admin e financeiro da organização; grava só o dono.
ALTER TABLE public.corretor_dados_pagamento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.corretor_dados_pagamento FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corretor_dados_pagamento TO authenticated;
GRANT ALL ON public.corretor_dados_pagamento TO service_role;
CREATE POLICY org_isolation ON public.corretor_dados_pagamento AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY usuario_ativo ON public.corretor_dados_pagamento AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid()))));
CREATE POLICY cdp_ler ON public.corretor_dados_pagamento FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR (SELECT public.has_any_role((SELECT auth.uid()),
                    ARRAY['admin', 'super_admin', 'financeiro']::public.app_role[])));
CREATE POLICY cdp_inserir_proprio ON public.corretor_dados_pagamento FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY cdp_alterar_proprio ON public.corretor_dados_pagamento FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY cdp_apagar_proprio ON public.corretor_dados_pagamento FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- RLS da cópia na venda: só leitura direta (dono ou admin/financeiro que enxergam a venda).
-- Escrita apenas por salvar_meus_dados_pagamento_venda (SECURITY DEFINER, valida auth.uid()).
ALTER TABLE public.sale_dados_pagamento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_dados_pagamento FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sale_dados_pagamento TO authenticated;
GRANT ALL ON public.sale_dados_pagamento TO service_role;
CREATE POLICY org_isolation ON public.sale_dados_pagamento AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY usuario_ativo ON public.sale_dados_pagamento AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid()))));
CREATE POLICY sdp_ler ON public.sale_dados_pagamento FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid())
          OR (SELECT public.has_any_role((SELECT auth.uid()),
                     ARRAY['admin', 'super_admin', 'financeiro']::public.app_role[])))
         AND public.can_view_sale((SELECT auth.uid()), sale_id));

-- 3) Auxiliares internos --------------------------------------------------------------------------
-- Pessoas da equipe da venda que recebem comissão e têm cadastro (captador, vendedor, gestores/TL,
-- indicadores e as linhas "+ Outro" de sale_commission_extras com usuário vinculado).
CREATE OR REPLACE FUNCTION public.sale_equipe_pagamento(_sale_id uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT DISTINCT x.uid FROM (
    SELECT unnest(ARRAY[s.corretor_captador_id, s.corretor_vendedor_id, s.lider_captador_id,
                        s.lider_vendedor_id, s.indicador_captador_id, s.indicador_vendedor_id]) AS uid
      FROM public.sales s WHERE s.id = _sale_id
    UNION ALL
    SELECT e.user_id FROM public.sale_commission_extras e WHERE e.sale_id = _sale_id
  ) x WHERE x.uid IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.sale_equipe_pagamento(uuid) FROM PUBLIC, anon, authenticated;

-- Máscara: nunca devolve o valor inteiro; mostra só os 4 últimos caracteres de valores longos.
CREATE OR REPLACE FUNCTION public.pagamento_mascarar(_v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN _v IS NULL OR btrim(_v) = '' THEN NULL
              WHEN length(_v) <= 4 THEN '***'
              ELSE '***' || right(_v, 4) END;
$$;
REVOKE ALL ON FUNCTION public.pagamento_mascarar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagamento_mascarar(text) TO authenticated, service_role;

-- 4) Gravar o próprio bloco na venda ---------------------------------------------------------------
-- _modo: 'imobiliaria' | 'conta_propria'. _usar_cadastro: copia a conta salva no cadastro.
-- _dados: {titular, documento, tipo_conta, banco, agencia, conta, pix_tipo, pix_chave}.
-- _salvar_cadastro: também grava esses dados no cadastro do próprio usuário.
CREATE OR REPLACE FUNCTION public.salvar_meus_dados_pagamento_venda(
  _sale_id uuid, _modo text, _usar_cadastro boolean DEFAULT false,
  _dados jsonb DEFAULT '{}'::jsonb, _salvar_cadastro boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  _me uuid := auth.uid(); _org uuid := public.current_org_id();
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
  IF NOT EXISTS (SELECT 1 FROM public.sale_equipe_pagamento(_sale_id) p WHERE p.user_id = _me) THEN
    RAISE EXCEPTION 'Só a própria pessoa da equipe preenche os dados de pagamento dela' USING ERRCODE = '42501';
  END IF;
  IF _status IN ('arquivada', 'cancelada', 'ocorrencia_concluida') THEN
    RAISE EXCEPTION 'Venda encerrada: os dados de pagamento não podem mais ser alterados' USING ERRCODE = '42501';
  END IF;
  IF _modo IS NULL OR _modo NOT IN ('imobiliaria', 'conta_propria') THEN
    RAISE EXCEPTION 'Escolha como vai receber' USING ERRCODE = '22023';
  END IF;

  IF _modo = 'conta_propria' THEN
    IF coalesce(_usar_cadastro, false) THEN
      SELECT * INTO _cad FROM public.corretor_dados_pagamento c WHERE c.organization_id = _org AND c.user_id = _me;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ainda não há conta salva no seu cadastro' USING ERRCODE = '22023';
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
    tipo_conta, banco, agencia, conta, pix_tipo, pix_chave)
  VALUES (_org, _sale_id, _me, _modo, _titular, _documento, _tipo_conta, _banco, _agencia, _conta, _pix_tipo, _pix_chave)
  ON CONFLICT (sale_id, user_id) DO UPDATE SET
    modo = EXCLUDED.modo, titular = EXCLUDED.titular, documento = EXCLUDED.documento,
    tipo_conta = EXCLUDED.tipo_conta, banco = EXCLUDED.banco, agencia = EXCLUDED.agencia,
    conta = EXCLUDED.conta, pix_tipo = EXCLUDED.pix_tipo, pix_chave = EXCLUDED.pix_chave;
END $function$;
REVOKE ALL ON FUNCTION public.salvar_meus_dados_pagamento_venda(uuid, text, boolean, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_meus_dados_pagamento_venda(uuid, text, boolean, jsonb, boolean)
  TO authenticated, service_role;

-- 5) Leitura por venda (mascarada conforme o perfil) -----------------------------------------------
-- origem: 'venda' (cópia gravada nesta venda), 'cadastro' (ainda sem cópia: usa o cadastro atual) ou
-- 'nenhum'. completo = titular + (PIX ou banco+agência+conta), calculado sobre o dado real.
CREATE OR REPLACE FUNCTION public.venda_dados_pagamento(_sale_id uuid)
RETURNS TABLE(user_id uuid, nome text, origem text, modo text, completo boolean, tem_cadastro boolean,
              dados_completos boolean, titular text, documento text, tipo_conta text, banco text,
              agencia text, conta text, pix_tipo text, pix_chave text)
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
           CASE WHEN v.id IS NOT NULL THEN v.pix_chave ELSE c.pix_chave END AS pix_chave
      FROM eq
      LEFT JOIN public.profiles pr ON pr.id = eq.user_id
      LEFT JOIN public.sale_dados_pagamento v ON v.sale_id = _sale_id AND v.user_id = eq.user_id
                                              AND v.organization_id = _org
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
         CASE WHEN b.ve_tudo THEN b.pix_chave ELSE public.pagamento_mascarar(b.pix_chave) END
    FROM base b
   ORDER BY b.nome;
END $function$;
REVOKE ALL ON FUNCTION public.venda_dados_pagamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venda_dados_pagamento(uuid) TO authenticated, service_role;

COMMIT;
