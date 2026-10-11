-- "+Outro captador"/"+Outro vendedor" só tinham um campo de texto livre pro nome — sem jeito de
-- vincular a um corretor cadastrado (diferente do captador/vendedor principal, que já usa
-- corretor_captador_id/vendedor_id, e do gestor/team leader extra, que usa coordenador_id/
-- team_leader_id em sales). Adiciona user_id aqui pra guardar esse vínculo quando o "outro"
-- corretor for selecionado da lista, ao em vez de digitado.
ALTER TABLE public.sale_commission_extras ADD COLUMN user_id uuid REFERENCES public.profiles(id);
