-- Cadastro de cliente centralizado: até aqui, comprador/vendedor era 100% texto solto por venda
-- em sale_parties, sem link entre eles — o mesmo CPF em duas vendas diferentes virava duas pessoas
-- diferentes pro sistema. clientes.cpf_cnpj_normalizado (dígitos, sem pontuação) é a chave de busca;
-- sale_parties.cliente_id linka a parte ao cliente quando o CPF bate com um já cadastrado.
-- Visibilidade é pra imobiliária inteira (decisão explícita) — um corretor de outra equipe também
-- reconhece um cliente que já negociou com time diferente, é o objetivo do recurso.
CREATE TABLE public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_pessoa text NOT NULL DEFAULT 'fisica' CHECK (tipo_pessoa = ANY (ARRAY['fisica','juridica'])),
  nome text,
  razao_social text,
  cnpj text,
  cpf_cnpj text,
  cpf_cnpj_normalizado text GENERATED ALWAYS AS (regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g')) STORED,
  rg text,
  profissao text,
  email text,
  telefone text,
  endereco text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX clientes_cpf_cnpj_normalizado_key ON public.clientes (cpf_cnpj_normalizado) WHERE cpf_cnpj_normalizado <> '';

CREATE TRIGGER trg_clientes_updated BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY clientes_select ON public.clientes
  FOR SELECT USING (public.is_active_user(auth.uid()));

CREATE POLICY clientes_write ON public.clientes
  FOR ALL USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

ALTER TABLE public.sale_parties ADD COLUMN cliente_id uuid REFERENCES public.clientes(id);

-- Histórico de negócios do cliente pra tela de reconhecimento — SECURITY DEFINER de propósito:
-- a visibilidade de cliente é pra empresa toda (não fica presa ao RLS de can_view_sale, que
-- restringe sale_parties/sales por equipe). Só devolve o resumo necessário pro histórico (papel,
-- endereço, data), nada de valor financeiro da venda.
CREATE OR REPLACE FUNCTION public.cliente_historico(_cliente_id uuid, _excluir_sale_id uuid DEFAULT NULL)
 RETURNS TABLE(sale_id uuid, papel text, imovel_endereco text, imovel_id text, data timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT sp.sale_id, sp.papel, s.imovel_endereco, s.imovel_id, s.created_at
  FROM sale_parties sp
  JOIN sales s ON s.id = sp.sale_id
  WHERE sp.cliente_id = _cliente_id
    AND (_excluir_sale_id IS NULL OR sp.sale_id <> _excluir_sale_id)
    AND public.is_active_user(auth.uid())
  ORDER BY s.created_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.cliente_historico(uuid, uuid) TO authenticated;
