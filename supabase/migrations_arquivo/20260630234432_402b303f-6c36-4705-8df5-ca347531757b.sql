
-- Helper trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL DEFAULT '',
  email TEXT,
  telefone TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM ('corretor','coordenador','gestor','juridico','financeiro','admin');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;

-- ============ TEAM ============
CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'coordenador',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(membro_id, lider_id)
);
GRANT SELECT ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_lead_of(_lider UUID, _membro UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE lider_id = _lider AND membro_id = _membro)
$$;

-- Profiles policies
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['coordenador','gestor','juridico','financeiro','admin']::public.app_role[]));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- user_roles policies
CREATE POLICY "user_roles_self_select" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- team_members policies
CREATE POLICY "team_view" ON public.team_members FOR SELECT TO authenticated USING (membro_id = auth.uid() OR lider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "team_admin_write" ON public.team_members FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Auto create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email,'@',1)), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'corretor');
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ SALES ============
CREATE TYPE public.sale_status AS ENUM (
  'rascunho','enviada_revisao','devolvida_ajuste','aprovada_gestor',
  'enviada_juridico','em_elaboracao_contrato','aguardando_assinatura',
  'contrato_assinado','ocorrencia_pendente','ocorrencia_concluida','arquivada','cancelada'
);

CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corretor_id UUID NOT NULL REFERENCES auth.users(id),
  status public.sale_status NOT NULL DEFAULT 'rascunho',

  -- Imóvel
  imovel_id TEXT,
  matricula TEXT,
  iptu TEXT,
  codigo_interno TEXT,
  imovel_observacoes TEXT,

  -- Equipe
  coordenador_id UUID REFERENCES auth.users(id),
  team_leader_id UUID REFERENCES auth.users(id),
  corretor_captador TEXT,
  corretor_vendedor TEXT,
  indicador TEXT,

  -- Valores
  valor_anunciado NUMERIC(14,2),
  valor_negociado NUMERIC(14,2),
  percentual_comissao NUMERIC(6,3),
  valor_total_comissao NUMERIC(14,2),
  forma_pagamento TEXT,
  negociacao_observacoes TEXT,

  -- Posse
  posse_data DATE,
  posse_observacoes TEXT,

  -- Comissão
  comissao_valor NUMERIC(14,2),
  comissao_quando TEXT,
  comissao_observacoes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_sales_updated BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_sales_corretor ON public.sales(corretor_id);
CREATE INDEX idx_sales_status ON public.sales(status);

-- Helper: can user view this sale?
CREATE OR REPLACE FUNCTION public.can_view_sale(_user UUID, _sale_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
      s.corretor_id = _user
      OR public.has_any_role(_user, ARRAY['financeiro','admin']::public.app_role[])
      OR (public.has_any_role(_user, ARRAY['coordenador','gestor']::public.app_role[]) AND public.is_lead_of(_user, s.corretor_id))
      OR (public.has_role(_user,'juridico') AND s.status::text = ANY (ARRAY['aprovada_gestor','enviada_juridico','em_elaboracao_contrato','aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_concluida']))
    )
  )
$$;

CREATE POLICY "sales_select" ON public.sales FOR SELECT TO authenticated USING (
  corretor_id = auth.uid()
  OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin']::public.app_role[])
  OR (public.has_any_role(auth.uid(), ARRAY['coordenador','gestor']::public.app_role[]) AND public.is_lead_of(auth.uid(), corretor_id))
  OR (public.has_role(auth.uid(),'juridico') AND status::text = ANY (ARRAY['aprovada_gestor','enviada_juridico','em_elaboracao_contrato','aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_concluida']))
);
CREATE POLICY "sales_insert_corretor" ON public.sales FOR INSERT TO authenticated WITH CHECK (corretor_id = auth.uid());
CREATE POLICY "sales_update_owner_draft" ON public.sales FOR UPDATE TO authenticated USING (
  (corretor_id = auth.uid() AND status IN ('rascunho','devolvida_ajuste'))
  OR public.has_any_role(auth.uid(), ARRAY['coordenador','gestor','juridico','financeiro','admin']::public.app_role[])
) WITH CHECK (
  (corretor_id = auth.uid())
  OR public.has_any_role(auth.uid(), ARRAY['coordenador','gestor','juridico','financeiro','admin']::public.app_role[])
);
CREATE POLICY "sales_delete_admin" ON public.sales FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============ SALE PARTIES (vendedores + compradores) ============
CREATE TABLE public.sale_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  papel TEXT NOT NULL, -- vendedor_1, vendedor_2, comprador_1, comprador_2
  nome TEXT,
  rg TEXT,
  cpf_cnpj TEXT,
  profissao TEXT,
  email TEXT,
  telefone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sale_id, papel)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_parties TO authenticated;
GRANT ALL ON public.sale_parties TO service_role;
ALTER TABLE public.sale_parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_parties_rw" ON public.sale_parties FOR ALL TO authenticated USING (public.can_view_sale(auth.uid(), sale_id)) WITH CHECK (public.can_view_sale(auth.uid(), sale_id));

-- ============ SALE PAYMENT ============
CREATE TABLE public.sale_payment (
  sale_id UUID PRIMARY KEY REFERENCES public.sales(id) ON DELETE CASCADE,
  entrada_valor NUMERIC(14,2),
  entrada_data DATE,
  parcela1_valor NUMERIC(14,2),
  parcela1_data DATE,
  parcela2_valor NUMERIC(14,2),
  parcela2_data DATE,
  fgts BOOLEAN DEFAULT false,
  fgts_valor NUMERIC(14,2),
  fgts_observacao TEXT,
  financiamento BOOLEAN DEFAULT false,
  financiamento_valor NUMERIC(14,2),
  financiamento_observacao TEXT,
  observacoes TEXT
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_payment TO authenticated;
GRANT ALL ON public.sale_payment TO service_role;
ALTER TABLE public.sale_payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_payment_rw" ON public.sale_payment FOR ALL TO authenticated USING (public.can_view_sale(auth.uid(), sale_id)) WITH CHECK (public.can_view_sale(auth.uid(), sale_id));

-- ============ BANK ACCOUNTS ============
CREATE TABLE public.sale_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  titular TEXT,
  banco TEXT,
  agencia TEXT,
  conta TEXT,
  pix TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_bank_accounts TO authenticated;
GRANT ALL ON public.sale_bank_accounts TO service_role;
ALTER TABLE public.sale_bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_bank_rw" ON public.sale_bank_accounts FOR ALL TO authenticated USING (public.can_view_sale(auth.uid(), sale_id)) WITH CHECK (public.can_view_sale(auth.uid(), sale_id));

-- ============ DOCUMENTS ============
CREATE TYPE public.doc_status AS ENUM ('pendente','enviado','aprovado','recusado');

CREATE TABLE public.sale_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- rg, cpf, certidao, comprovante_endereco, matricula, iptu, cnd_condominio
  storage_path TEXT,
  file_name TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  status public.doc_status NOT NULL DEFAULT 'pendente',
  motivo_recusa TEXT,
  versao INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_documents TO authenticated;
GRANT ALL ON public.sale_documents TO service_role;
ALTER TABLE public.sale_documents ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_docs_updated BEFORE UPDATE ON public.sale_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "sale_docs_select" ON public.sale_documents FOR SELECT TO authenticated USING (public.can_view_sale(auth.uid(), sale_id));
CREATE POLICY "sale_docs_insert" ON public.sale_documents FOR INSERT TO authenticated WITH CHECK (public.can_view_sale(auth.uid(), sale_id));
CREATE POLICY "sale_docs_update" ON public.sale_documents FOR UPDATE TO authenticated USING (public.can_view_sale(auth.uid(), sale_id)) WITH CHECK (public.can_view_sale(auth.uid(), sale_id));
CREATE POLICY "sale_docs_delete" ON public.sale_documents FOR DELETE TO authenticated USING (public.can_view_sale(auth.uid(), sale_id));

-- ============ COMMENTS ============
CREATE TABLE public.sale_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  autor_id UUID NOT NULL REFERENCES auth.users(id),
  escopo TEXT NOT NULL DEFAULT 'revisao', -- revisao, juridico, interno
  texto TEXT NOT NULL,
  doc_id UUID REFERENCES public.sale_documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sale_comments TO authenticated;
GRANT ALL ON public.sale_comments TO service_role;
ALTER TABLE public.sale_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_comments_view" ON public.sale_comments FOR SELECT TO authenticated USING (public.can_view_sale(auth.uid(), sale_id));
CREATE POLICY "sale_comments_insert" ON public.sale_comments FOR INSERT TO authenticated WITH CHECK (public.can_view_sale(auth.uid(), sale_id) AND autor_id = auth.uid());

-- ============ STATUS HISTORY ============
CREATE TABLE public.sale_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  de public.sale_status,
  para public.sale_status NOT NULL,
  autor_id UUID REFERENCES auth.users(id),
  motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.sale_status_history TO authenticated;
GRANT ALL ON public.sale_status_history TO service_role;
ALTER TABLE public.sale_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history_view" ON public.sale_status_history FOR SELECT TO authenticated USING (public.can_view_sale(auth.uid(), sale_id));
CREATE POLICY "history_insert" ON public.sale_status_history FOR INSERT TO authenticated WITH CHECK (public.can_view_sale(auth.uid(), sale_id));

-- ============ OCCURRENCES ============
CREATE TABLE public.occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE CASCADE,
  codigo_imovel TEXT,
  tempo_venda TEXT,
  data_assinatura DATE,
  nota_fiscal_obrigatoria BOOLEAN DEFAULT false,
  midia TEXT,
  valor_anunciado NUMERIC(14,2),
  valor_negociado NUMERIC(14,2),
  percentual_comissao NUMERIC(6,3),
  valor_comissao NUMERIC(14,2),
  financiamento BOOLEAN DEFAULT false,
  financiamento_valor NUMERIC(14,2),
  financiamento_banco TEXT,
  financiamento_correspondente TEXT,
  financiamento_previsao DATE,
  prev_recebimento_valor NUMERIC(14,2),
  prev_recebimento_data DATE,
  prev_recebimento_forma TEXT,
  observacoes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente, concluida
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrences TO authenticated;
GRANT ALL ON public.occurrences TO service_role;
ALTER TABLE public.occurrences ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_occ_updated BEFORE UPDATE ON public.occurrences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "occ_view" ON public.occurrences FOR SELECT TO authenticated USING (public.can_view_sale(auth.uid(), sale_id));
CREATE POLICY "occ_write" ON public.occurrences FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['financeiro','admin','gestor','coordenador']::public.app_role[]) AND public.can_view_sale(auth.uid(), sale_id)) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['financeiro','admin','gestor','coordenador']::public.app_role[]) AND public.can_view_sale(auth.uid(), sale_id));

CREATE TABLE public.occurrence_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID NOT NULL REFERENCES public.occurrences(id) ON DELETE CASCADE,
  papel TEXT NOT NULL, -- corretor_captador, indicador_captador, coordenador_captador, corretor_vendedor, indicador_vendedor, coordenador_vendedor
  nome TEXT,
  percentual NUMERIC(6,3),
  valor NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrence_commissions TO authenticated;
GRANT ALL ON public.occurrence_commissions TO service_role;
ALTER TABLE public.occurrence_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "occ_comm_view" ON public.occurrence_commissions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.can_view_sale(auth.uid(), o.sale_id)));
CREATE POLICY "occ_comm_write" ON public.occurrence_commissions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.has_any_role(auth.uid(), ARRAY['financeiro','admin','gestor','coordenador']::public.app_role[]))) WITH CHECK (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.has_any_role(auth.uid(), ARRAY['financeiro','admin','gestor','coordenador']::public.app_role[])));

CREATE TABLE public.occurrence_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID NOT NULL REFERENCES public.occurrences(id) ON DELETE CASCADE,
  nome TEXT,
  cpf_cnpj TEXT,
  percentual NUMERIC(6,3),
  valor NUMERIC(14,2),
  banco TEXT,
  agencia TEXT,
  conta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrence_partners TO authenticated;
GRANT ALL ON public.occurrence_partners TO service_role;
ALTER TABLE public.occurrence_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "occ_part_view" ON public.occurrence_partners FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.can_view_sale(auth.uid(), o.sale_id)));
CREATE POLICY "occ_part_write" ON public.occurrence_partners FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.has_any_role(auth.uid(), ARRAY['financeiro','admin','gestor','coordenador']::public.app_role[]))) WITH CHECK (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.has_any_role(auth.uid(), ARRAY['financeiro','admin','gestor','coordenador']::public.app_role[])));

-- ============ NOTIFICATIONS ============
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES public.sales(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensagem TEXT,
  lida BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_self" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif_update_self" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

-- ============ ACTIVITY LOG ============
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  autor_id UUID REFERENCES auth.users(id),
  sale_id UUID REFERENCES public.sales(id) ON DELETE CASCADE,
  acao TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "log_view" ON public.activity_logs FOR SELECT TO authenticated USING (sale_id IS NULL AND public.has_role(auth.uid(),'admin') OR (sale_id IS NOT NULL AND public.can_view_sale(auth.uid(), sale_id)));
CREATE POLICY "log_insert" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (autor_id = auth.uid());

-- ============ STORAGE POLICIES (bucket sale-documents) ============
-- bucket created via tool; policies on storage.objects
CREATE POLICY "docs_select" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'sale-documents' AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name,'/',1) AND public.can_view_sale(auth.uid(), s.id)
  )
);
CREATE POLICY "docs_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'sale-documents' AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name,'/',1) AND public.can_view_sale(auth.uid(), s.id)
  )
);
CREATE POLICY "docs_update" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'sale-documents' AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name,'/',1) AND public.can_view_sale(auth.uid(), s.id)
  )
);
CREATE POLICY "docs_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'sale-documents' AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name,'/',1) AND public.can_view_sale(auth.uid(), s.id)
  )
);
