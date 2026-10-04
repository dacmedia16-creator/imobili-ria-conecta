-- Fixture FICTÍCIA para homologação: vendas efetivadas (contrato assinado) nas agências A e B,
-- com endereços públicos conhecidos, para o mapa de "Vendas por região" ter pinos.
-- Só para homologação/clone. Marcadas com codigo_interno 'QA-MAPA-%'. Limpeza:
-- supabase/tests/fixture_vendas_regiao_mapa_cleanup.sql
-- Idempotente: não duplica se já existir.
DO $fx$
DECLARE
  _a uuid := '00000000-0000-4000-8000-000000000001';
  _b uuid := '2a000000-0000-4000-8000-0000000000b0';
  _ca uuid; _cb uuid; _id uuid; r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales WHERE codigo_interno LIKE 'QA-MAPA-%') THEN
    RAISE NOTICE 'fixture QA-MAPA já existe'; RETURN;
  END IF;
  SELECT ur.user_id INTO STRICT _ca FROM public.user_roles ur JOIN public.profiles p ON p.id=ur.user_id AND p.ativo
    WHERE ur.organization_id=_a AND ur.role='admin' ORDER BY 1 LIMIT 1;
  SELECT ur.user_id INTO STRICT _cb FROM public.user_roles ur JOIN public.profiles p ON p.id=ur.user_id AND p.ativo
    WHERE ur.organization_id=_b AND ur.role='admin' ORDER BY 1 LIMIT 1;
  FOR r IN SELECT * FROM (VALUES
    (_a,_ca,'QA-MAPA-A1','padrao','Rua da Penha','620','Centro','Sorocaba','SP',450000::numeric,'2026-09-05'::date),
    (_a,_ca,'QA-MAPA-A2','padrao','Avenida Antônio Carlos Comitre','1000','Parque Campolim','Sorocaba','SP',820000,'2026-09-18'),
    (_a,_ca,'QA-MAPA-A3','lancamento','Avenida Itavuvu','1500','Jardim Santa Cecília','Sorocaba','SP',310000,'2026-10-01'),
    (_a,_ca,'QA-MAPA-A4','padrao','Rua Inexistente QA Mapa','S/N','Bairro Fantasma QA','Cidade Fantasma QA','SP',200000,'2026-10-02'),
    (_b,_cb,'QA-MAPA-B1','padrao','Avenida Norte-Sul','500','Cambuí','Campinas','SP',600000,'2026-09-10'),
    (_b,_cb,'QA-MAPA-B2','padrao','Rua Barão de Jaguara','900','Centro','Campinas','SP',380000,'2026-09-25')
  ) v(org,cor,cod,modal,rua,num,bairro,cidade,uf,vgv,dt) LOOP
    INSERT INTO public.sales (organization_id, corretor_id, status, modalidade, codigo_interno, imovel_id,
      imovel_endereco, imovel_logradouro, imovel_numero, imovel_bairro, imovel_cidade, imovel_uf,
      valor_negociado, valor_total_comissao, data_assinatura)
    VALUES (r.org, r.cor, 'contrato_assinado', r.modal, r.cod, r.cod,
      r.rua || ', ' || r.num, r.rua, r.num, r.bairro, r.cidade, r.uf, r.vgv, r.vgv * 0.06, r.dt)
    RETURNING id INTO _id;
    INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
    VALUES (_id, r.org, 'contrato_assinado', (r.dt::timestamp + time '15:00') AT TIME ZONE 'America/Sao_Paulo');
    IF r.modal = 'lancamento' THEN
      INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
      VALUES (_id, r.org, 'ocorrencia_analise_financeiro', (r.dt::timestamp + time '16:00') AT TIME ZONE 'America/Sao_Paulo');
    END IF;
  END LOOP;
END $fx$;
