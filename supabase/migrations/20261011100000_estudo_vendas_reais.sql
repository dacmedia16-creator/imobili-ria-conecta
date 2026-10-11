-- Vendas reais do ADM MAX como comparáveis no Estudo de Mercado MAX (pedido de Denis, 11/10/2026,
-- tópico 6238, t_3a52d15a). SOMENTE LEITURA, consumida apenas pela Edge Function estudo-vendas-reais.
--
-- Decisões de Denis (fechadas):
--  1. Mostra a RUA, nunca o número, complemento, unidade, apto, bloco, lote ou CEP. Nenhuma coordenada
--     sai daqui (só rua + bairro + cidade), então o ponto exato do imóvel não é exposto.
--  2. Só vendas com assinatura nos últimos 12 meses (data da assinatura em America/Sao_Paulo, a mesma
--     base canônica dos relatórios: vendas_comerciais_canonicas().data_fechamento).
--  3. Só vendas ASSINADAS: contrato_assinado em diante. Rascunho, revisão, contrato em elaboração,
--     aguardando assinatura, canceladas e arquivadas ficam fora (regra de vendas_comerciais_canonicas).
--
-- Nunca sai: comprador, vendedor, corretor, comissão, documentos, código/ID da venda ou do imóvel,
-- número/complemento, data exata (só o mês) e coordenadas.
-- Multiempresa: cada imobiliária tem a PRÓPRIA chave (só o hash SHA-256 fica no banco). A organização
-- vem da chave, nunca de parâmetro do chamador: a chave da imobiliária A só devolve vendas de A.
-- Rollback: supabase/rollback/20261011100000_estudo_vendas_reais.sql
BEGIN;

-- 1) Chaves por imobiliária (só hash) --------------------------------------------------------------
CREATE TABLE public.estudo_vendas_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX estudo_vendas_api_keys_org_idx ON public.estudo_vendas_api_keys (organization_id, revoked_at);
COMMENT ON TABLE public.estudo_vendas_api_keys IS
  'Chave do Estudo de Mercado por imobiliária (SHA-256 hex do token; o token fica só no cofre/Worker do Estudo).';
ALTER TABLE public.estudo_vendas_api_keys ENABLE ROW LEVEL SECURITY;
-- service_role também perde o ALL dado pelos default privileges do Supabase: só lê.
REVOKE ALL ON public.estudo_vendas_api_keys FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.estudo_vendas_api_keys TO service_role;

-- 2) Rua sem número --------------------------------------------------------------------------------
-- "Rua das Acácias, 412 - Apto 31" -> "Rua das Acácias"; "Rua X 375 Quadra Bl 1 Lote" -> "Rua X";
-- "Rua: José Guerra Quadra: J Lote ..." -> "Rua José Guerra". Preserva nomes com número: "Rua 02",
-- "Rua 17 Vivalegro", "Avenida 31 de Março". Trava final: se o número ou um número do complemento
-- ainda aparecer como palavra, devolve NULL (o estudo mostra só bairro/cidade).
CREATE FUNCTION public.estudo_rua_sem_numero(_logradouro text, _numero text DEFAULT NULL,
  _complemento text DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $function$
DECLARE r text := btrim(coalesce(_logradouro, '')); w text[]; out text[] := ARRAY[]::text[];
        i int; via boolean; d text;
BEGIN
  IF r = '' THEN RETURN NULL; END IF;
  r := regexp_replace(r, '\d{5}-?\d{3}', ' ', 'g');                          -- CEP
  r := regexp_replace(r, '\ms\s*/\s*n\M\.?', ' ', 'gi');                     -- S/N
  r := regexp_replace(r, '\s*(,|;|\(|/|#|\s[-–—]\s).*$', '');                 -- tudo depois de , ; ( / # " - "
  r := regexp_replace(r, '[:]', ' ', 'g');
  r := btrim(regexp_replace(r, '\s+', ' ', 'g'));
  -- marcador de número/unidade e tudo o que vem depois (nunca a 1ª palavra)
  r := regexp_replace(r,
    '\s(n[º°]|no\.|nr\.?|n\.|numero|número|s\.?/?n\.?|aptos?|apt|ap\.|apartamento|bloco|bl|casa|lotes?|lt|quadra|qd'
    || '|sala|salas|unidade|un|conj|conjunto|torre|km|fundos|frente|edif[ií]cio|ed\.|cond|condom[ií]nio)(?=[\s.:º°\d]|$).*$',
    '', 'i');
  -- número solto: corta nele e no que vem depois, exceto "Rua 02" (logo após o tipo da via) e "31 de"
  w := regexp_split_to_array(btrim(r), '\s+');
  FOR i IN 1 .. coalesce(array_length(w, 1), 0) LOOP
    IF w[i] ~ '^\d+[A-Za-z]?\.?$' OR w[i] ~ '^[A-Za-z]?\d+$' THEN
      via := i = 2 AND lower(w[1]) ~ '^(rua|r\.|avenida|av\.?|travessa|tv\.?|alameda|al\.?|estrada|est\.?|rodovia|rod\.?|viela|vila|praça|praca|pç\.?|largo|beco|via)$';
      IF NOT (via OR lower(coalesce(w[i + 1], '')) IN ('de', 'da', 'do')) THEN EXIT; END IF;
    END IF;
    out := out || w[i];
  END LOOP;
  r := regexp_replace(array_to_string(out, ' '), '[\s.,;:\-–—]+$', '');
  IF r = '' THEN RETURN NULL; END IF;
  -- trava: número da casa ou números do complemento não podem sobrar como palavra
  FOR d IN SELECT m[1] FROM regexp_matches(coalesce(_numero, '') || ' ' || coalesce(_complemento, ''), '(\d+)', 'g') m LOOP
    IF r ~ ('(^|\D)0*' || ltrim(d, '0') || '($|\D)') AND ltrim(d, '0') <> '' THEN RETURN NULL; END IF;
  END LOOP;
  RETURN r;
END $function$;
COMMENT ON FUNCTION public.estudo_rua_sem_numero(text, text, text) IS
  'Rua sem número/complemento/unidade para o Estudo de Mercado. NULL quando não dá para garantir.';

-- 3) Vendas reais da imobiliária dona da chave ----------------------------------------------------
-- Área: Terreno usa a área do terreno (como no estudo); demais, a área útil. Sem área -> preco_m2 NULL
-- (a venda aparece, mas fica fora do cálculo de R$/m²). Sem cidade -> fora (não serve de comparável).
CREATE FUNCTION public.estudo_vendas_reais(_key_hash text)
 RETURNS TABLE (
  tipo_imovel text,
  area_m2 numeric,
  valor_venda numeric,
  preco_m2 numeric,
  mes_assinatura text,
  rua text,
  bairro text,
  cidade text,
  uf text,
  quartos smallint,
  suites smallint,
  banheiros smallint,
  vagas smallint,
  modalidade text
 )
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $function$
DECLARE _org uuid; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _key_hash IS NULL OR _key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'chave inválida' USING ERRCODE = '28000';
  END IF;
  SELECT k.organization_id INTO _org
    FROM public.estudo_vendas_api_keys k
    JOIN public.organizations o ON o.id = k.organization_id AND o.status = 'ativa'
   WHERE k.key_hash = _key_hash AND k.revoked_at IS NULL;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'chave inválida' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT s.tipo_imovel,
         a.area,
         s.valor_negociado,
         CASE WHEN a.area > 0 THEN round(s.valor_negociado / a.area, 2) END,
         to_char(c.data_fechamento, 'YYYY-MM'),
         public.estudo_rua_sem_numero(s.imovel_logradouro, s.imovel_numero, s.imovel_complemento),
         nullif(btrim(s.imovel_bairro), ''),
         btrim(s.imovel_cidade),
         nullif(upper(btrim(s.imovel_uf)), ''),
         s.quartos, s.suites, s.banheiros, s.vagas,
         c.modalidade
    FROM public.vendas_comerciais_canonicas() c
    JOIN public.sales s ON s.id = c.sale_id AND s.organization_id = _org
    CROSS JOIN LATERAL (SELECT CASE WHEN s.tipo_imovel = 'Terreno' THEN s.area_terreno_m2
                                    ELSE s.area_util_m2 END AS area) a
   WHERE c.data_fechamento >= (_hoje - interval '12 months')::date
     AND c.data_fechamento <= _hoje
     AND s.valor_negociado > 0
     AND nullif(btrim(s.imovel_cidade), '') IS NOT NULL
   ORDER BY c.data_fechamento DESC, s.imovel_bairro;
END $function$;
COMMENT ON FUNCTION public.estudo_vendas_reais(text) IS
  'Somente leitura, só service_role (Edge Function estudo-vendas-reais). Vendas assinadas dos últimos 12 meses da imobiliária dona da chave, sem dados pessoais, número ou coordenada.';

REVOKE ALL ON FUNCTION public.estudo_rua_sem_numero(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estudo_rua_sem_numero(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.estudo_vendas_reais(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estudo_vendas_reais(text) TO service_role;

COMMIT;
