-- Captação exclusiva: unidades por imobiliária + contrato-base RE/MAX único.
-- * Cada imobiliária cadastra as próprias unidades (RLS por organization_id).
-- * Nova captação escolhe uma unidade da organização do usuário (exclusive_create_unit).
-- * A Única Escolha continua com os PDFs atuais pela chave contrato_antigo = true; trocar para
--   false passa a unidade para o contrato-base (e vice-versa) sem tocar nas captações.
--   A troca vale para a PRÓXIMA geração de PDF (o app decide pela unidade na hora de gerar).
-- * Captações existentes NÃO mudam: unit_id fica NULL e template continua 'campolim'/'barao-de-tatui'.
-- Rollback: docs/sql/rollback/20261004210000_exclusividade_unidades_org.rollback.sql
BEGIN;

CREATE TABLE public.exclusive_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 2 AND 80),
  creci text NOT NULL CHECK (length(trim(creci)) BETWEEN 3 AND 30),
  razao_social text NOT NULL CHECK (length(trim(razao_social)) BETWEEN 2 AND 120),
  endereco text NOT NULL CHECK (length(trim(endereco)) BETWEEN 3 AND 160),
  cidade text NOT NULL CHECK (length(trim(cidade)) BETWEEN 2 AND 80),
  estado text NOT NULL CHECK (length(trim(estado)) BETWEEN 2 AND 40),
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{2}[.]?[0-9]{3}[.]?[0-9]{3}/?[0-9]{4}-?[0-9]{2}$'),
  nome_comercial text NOT NULL CHECK (length(trim(nome_comercial)) BETWEEN 2 AND 80),
  -- Qual PDF antigo corresponde à unidade (só Única Escolha; identidade, não muda).
  legacy_template text CHECK (legacy_template IN ('campolim','barao-de-tatui')),
  -- Chave de reversão: true = gera o PDF antigo; false = contrato-base RE/MAX.
  contrato_antigo boolean NOT NULL DEFAULT false CHECK (NOT contrato_antigo OR legacy_template IS NOT NULL),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, nome),
  UNIQUE (organization_id, legacy_template)
);
CREATE INDEX exclusive_units_org_idx ON public.exclusive_units (organization_id, ativo, nome);
ALTER TABLE public.exclusive_units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exclusive_units FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exclusive_units TO authenticated;
GRANT ALL ON public.exclusive_units TO service_role;
-- Dono das RPCs (padrão multiempresa 1b: papel sem BYPASSRLS, com policy própria).
GRANT ALL ON public.exclusive_units TO mt_1b_definer;
CREATE POLICY mt_1b_definer_access ON public.exclusive_units FOR ALL TO mt_1b_definer
  USING (true) WITH CHECK (true);
-- Leitura: só unidades da imobiliária atual, para os papéis do módulo. Escrita só por RPC.
CREATE POLICY exclusive_units_read ON public.exclusive_units FOR SELECT TO authenticated USING (
  organization_id = (SELECT public.current_org_id())
  AND (SELECT public.has_any_role((SELECT auth.uid()),
    ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[]))
);
CREATE TRIGGER trg_zz_pc_audit AFTER INSERT OR DELETE OR UPDATE ON public.exclusive_units
  FOR EACH ROW EXECUTE FUNCTION public.mt_pc_audit_write();

-- Unidades atuais da Única Escolha (agência histórica), já ligadas aos PDFs antigos.
INSERT INTO public.exclusive_units (organization_id, nome, creci, razao_social, endereco, cidade,
  estado, cnpj, nome_comercial, legacy_template, contrato_antigo)
SELECT o, v.nome, v.creci, v.razao, v.endereco, 'Sorocaba', 'São Paulo', v.cnpj,
  'RE/MAX ÚNICA ESCOLHA', v.tpl, true
FROM (SELECT public.legacy_default_org_id() AS o) org
CROSS JOIN (VALUES
  ('Única Escolha I', '38086-J', 'BDG NEGÓCIOS IMOBILIÁRIOS LTDA',
   'Rua Francisco Neves, 93 - Loja 03 - Parque Campolim', '42.619.260/0001-90', 'campolim'),
  ('Única Escolha II', '22375-J', 'CEV NEGÓCIOS IMOBILIÁRIOS LTDA',
   'Avenida Barão de Tatuí, 520 - Jardim Vergueiro', '13.662.631/0001-18', 'barao-de-tatui')
) AS v(nome, creci, razao, endereco, cnpj, tpl)
WHERE org.o IS NOT NULL
ON CONFLICT DO NOTHING;

-- Captação passa a apontar para a unidade (mesma organização garantida pela FK composta).
ALTER TABLE public.exclusive_captures ADD COLUMN unit_id uuid;
ALTER TABLE public.exclusive_captures ADD CONSTRAINT exclusive_captures_unit_org_fk
  FOREIGN KEY (unit_id, organization_id) REFERENCES public.exclusive_units(id, organization_id);
CREATE INDEX exclusive_captures_unit_idx ON public.exclusive_captures (organization_id, unit_id);
-- Legado continua válido (template antigo sem unidade); novas linhas exigem unidade.
ALTER TABLE public.exclusive_captures DROP CONSTRAINT exclusive_captures_template_check;
ALTER TABLE public.exclusive_captures ADD CONSTRAINT exclusive_captures_template_check CHECK (
  template IN ('campolim','barao-de-tatui','remax-padrao')
  AND (unit_id IS NOT NULL OR template IN ('campolim','barao-de-tatui'))
);

-- Criação por unidade. Mesmas checagens de exclusive_create, com a unidade da organização atual.
CREATE FUNCTION public.exclusive_create_unit(_unit_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _id uuid; _p public.profiles%ROWTYPE; _u public.exclusive_units%ROWTYPE;
BEGIN
  IF NOT public.exclusive_capture_enabled() OR auth.uid() IS NULL OR
    NOT public.has_any_role(auth.uid(), ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[])
  THEN RAISE EXCEPTION 'Captação exclusiva indisponível'; END IF;
  SELECT * INTO _u FROM public.exclusive_units
    WHERE id = _unit_id AND organization_id = public.current_org_id() AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unidade inválida'; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = auth.uid() AND ativo;
  IF NOT FOUND AND public.platform_current_org() IS NOT NULL THEN RAISE EXCEPTION 'A captação deve ser criada por um corretor desta imobiliária'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil inativo'; END IF;
  IF nullif(trim(_p.nome),'') IS NULL THEN RAISE EXCEPTION 'Preencha seu nome no perfil antes de criar'; END IF;
  INSERT INTO public.exclusive_captures(captor_id,created_by,template,unit_id,broker_name,broker_cpf,broker_creci)
  VALUES (auth.uid(),auth.uid(),
    CASE WHEN _u.contrato_antigo THEN _u.legacy_template ELSE 'remax-padrao' END,_u.id,
    _p.nome,coalesce(_p.cpf,''),coalesce(_p.creci,'')) RETURNING id INTO _id;
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'criada',nullif(concat_ws(',',
      CASE WHEN _p.cpf IS NOT NULL THEN 'CPF:perfil' END,
      CASE WHEN _p.creci IS NOT NULL THEN 'CRECI:perfil' END),''));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_create_unit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_create_unit(uuid) TO authenticated;

-- Chamada antiga (frontend anterior): o modelo agora precisa ser uma unidade legada DA PRÓPRIA
-- organização; outra imobiliária não cria mais captação da Única Escolha.
CREATE OR REPLACE FUNCTION public.exclusive_create(_template text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _unit uuid;
BEGIN
  IF NOT public.exclusive_capture_enabled() OR auth.uid() IS NULL OR
    NOT public.has_any_role(auth.uid(), ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[])
  THEN RAISE EXCEPTION 'Captação exclusiva indisponível'; END IF;
  IF _template NOT IN ('campolim','barao-de-tatui') THEN RAISE EXCEPTION 'Modelo inválido'; END IF;
  SELECT id INTO _unit FROM public.exclusive_units
    WHERE organization_id = public.current_org_id() AND legacy_template = _template AND ativo;
  IF _unit IS NULL THEN RAISE EXCEPTION 'Modelo inválido'; END IF;
  RETURN public.exclusive_create_unit(_unit);
END $$;
REVOKE ALL ON FUNCTION public.exclusive_create(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_create(text) TO authenticated;

-- Cadastro/edição pelo admin da imobiliária. legacy_template não é editável aqui (só operação).
CREATE FUNCTION public.exclusive_unit_save(_id uuid, _data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _out uuid;
  _t text[] := ARRAY['nome','creci','razao_social','endereco','cidade','estado','cnpj','nome_comercial'];
  _k text;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.mt_1b_gate(_org) OR
    NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[])
  THEN RAISE EXCEPTION 'Sem permissão para cadastrar unidades' USING ERRCODE = '42501'; END IF;
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  FOREACH _k IN ARRAY _t LOOP
    IF nullif(trim(coalesce(_data->>_k,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Preencha todos os dados da unidade'; END IF;
  END LOOP;
  IF _id IS NULL THEN
    INSERT INTO public.exclusive_units(organization_id,nome,creci,razao_social,endereco,cidade,estado,cnpj,nome_comercial,ativo)
    VALUES (_org,trim(_data->>'nome'),trim(_data->>'creci'),trim(_data->>'razao_social'),
      trim(_data->>'endereco'),trim(_data->>'cidade'),trim(_data->>'estado'),trim(_data->>'cnpj'),
      trim(_data->>'nome_comercial'),coalesce((_data->>'ativo')::boolean,true))
    RETURNING id INTO _out;
  ELSE
    UPDATE public.exclusive_units SET nome=trim(_data->>'nome'),creci=trim(_data->>'creci'),
      razao_social=trim(_data->>'razao_social'),endereco=trim(_data->>'endereco'),
      cidade=trim(_data->>'cidade'),estado=trim(_data->>'estado'),cnpj=trim(_data->>'cnpj'),
      nome_comercial=trim(_data->>'nome_comercial'),
      ativo=coalesce((_data->>'ativo')::boolean,ativo),updated_at=now()
    WHERE id=_id AND organization_id=_org RETURNING id INTO _out;
    IF _out IS NULL THEN RAISE EXCEPTION 'Unidade não encontrada'; END IF;
  END IF;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_unit_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_unit_save(uuid, jsonb) TO authenticated;

-- Mesmo dono das demais RPCs da captação (ALTER OWNER exige CREATE no schema: temporário).
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_create_unit(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_unit_save(uuid, jsonb) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;

-- Contrato-base comum: caminho fixo sem prefixo de organização, só leitura, para qualquer
-- imobiliária com o módulo ligado. Os PDFs antigos seguem restritos à agência histórica.
CREATE OR REPLACE FUNCTION public.mt_1c_storage_scope(_bucket text, _name text, _new_only boolean DEFAULT false)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $function$
  SELECT COALESCE(public.current_org_id() IS NOT NULL AND _bucket IN
    ('sale-documents','exclusive-captures','exclusive-templates','avatars')
    AND CASE WHEN _bucket='exclusive-templates' AND _name='base/remax-padrao.pdf' THEN NOT _new_only
      WHEN split_part(_name,'/',1)=public.current_org_id()::text
      THEN public.mt_1c_relative_path(_name) <> ''
      ELSE NOT _new_only AND public.current_org_id()=public.legacy_default_org_id()
        AND CASE _bucket
          WHEN 'sale-documents' THEN EXISTS (SELECT 1 FROM public.sales s
            WHERE s.id::text=split_part(_name,'/',1) AND s.organization_id=public.current_org_id())
          WHEN 'exclusive-captures' THEN EXISTS (SELECT 1 FROM public.exclusive_captures c
            WHERE c.id::text=split_part(_name,'/',1) AND c.organization_id=public.current_org_id())
          WHEN 'avatars' THEN EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id::text=split_part(_name,'/',1) AND p.organization_id=public.current_org_id())
          WHEN 'exclusive-templates' THEN _name IN ('campolim.pdf','barao-de-tatui.pdf')
          ELSE false END END,false)
$function$;

DROP POLICY exclusive_templates_read ON storage.objects;
CREATE POLICY exclusive_templates_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'exclusive-templates'
  AND (public.mt_1c_relative_path(name) IN ('campolim.pdf','barao-de-tatui.pdf')
       OR name = 'base/remax-padrao.pdf')
  AND public.exclusive_capture_enabled() AND public.exclusive_actor_active(auth.uid())
  AND public.has_any_role(auth.uid(),
    ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[])
);

COMMIT;
