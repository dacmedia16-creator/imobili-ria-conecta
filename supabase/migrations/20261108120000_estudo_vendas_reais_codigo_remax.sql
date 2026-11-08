-- Vendas reais para o Estudo de Mercado: devolver também o código RE/MAX do anúncio (sales.imovel_id).
-- Pedido aprovado por Denis em 08/11/2026 ("2 sim"), tópico 6238, cartão t_caa2f4a0.
-- Motivo: o Estudo cruza as vendas do ADM com as vendas do site RE/MAX; com o código o cruzamento é
-- exato (sem duplicar a mesma venda) e o Estudo consegue montar o link do anúncio.
--
-- ÚNICA mudança: 1 coluna nova no FIM da saída (codigo_remax). Filtros (12 meses, só assinadas, só a
-- imobiliária da chave), demais colunas, permissões e SECURITY INVOKER ficam idênticos à
-- 20261011100000. O código só sai quando bate o formato público RE/MAX (9 dígitos-N, ex. 630590123-45);
-- qualquer outro texto do campo sai NULL. Mudar o tipo de retorno exige DROP + CREATE (mesma transação).
-- Rollback: supabase/rollback/20261108120000_estudo_vendas_reais_codigo_remax.sql
BEGIN;

DROP FUNCTION public.estudo_vendas_reais(text);

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
  modalidade text,
  area_fonte text,
  codigo_remax text
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
         c.modalidade,
         CASE WHEN a.area > 0 THEN a.fonte END,
         -- Código RE/MAX do anúncio (ex.: 630590123-45). Fora desse formato (texto livre, endereço,
         -- nota) sai NULL: só o código público do anúncio pode sair, nunca outro texto do campo.
         CASE WHEN btrim(s.imovel_id) ~ '^[0-9]{9}-[0-9]{1,6}$' THEN btrim(s.imovel_id) END
    FROM public.vendas_comerciais_canonicas() c
    JOIN public.sales s ON s.id = c.sale_id AND s.organization_id = _org
    CROSS JOIN LATERAL (SELECT CASE WHEN s.tipo_imovel = 'Terreno' THEN s.area_terreno_m2
                                    ELSE s.area_util_m2 END AS area_bruta,
                               CASE WHEN s.area_confirmada_em IS NOT NULL THEN 'confirmada'
                                    WHEN s.area_origem = 'documento' THEN 'documento' END AS fonte) f
    -- Área só entra se confirmada pelo corretor ou lida do documento (matrícula/IPTU) — Denis, 11/10/2026.
    -- Outra origem sem confirmação (ex.: sugestão da captação) sai sem área e fica fora do R$/m².
    CROSS JOIN LATERAL (SELECT CASE WHEN f.fonte IS NOT NULL THEN f.area_bruta END AS area,
                               f.fonte) a
   WHERE c.data_fechamento >= (_hoje - interval '12 months')::date
     AND c.data_fechamento <= _hoje
     AND s.valor_negociado > 0
     AND nullif(btrim(s.imovel_cidade), '') IS NOT NULL
   ORDER BY c.data_fechamento DESC, s.imovel_bairro;
END $function$;
COMMENT ON FUNCTION public.estudo_vendas_reais(text) IS
  'Somente leitura, só service_role (Edge Function estudo-vendas-reais). Vendas assinadas dos últimos 12 meses da imobiliária dona da chave, sem dados pessoais, número ou coordenada. codigo_remax = código público do anúncio RE/MAX (9 dígitos-N) ou NULL.';


REVOKE ALL ON FUNCTION public.estudo_vendas_reais(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estudo_vendas_reais(text) TO service_role;

COMMIT;
