-- PROBLEMA (item 5 da 2ª rodada de auditoria): managed_by_sale dependia inteiramente da disciplina
-- do front-end e da RPC — nada no banco impedia um cliente com acesso de escrita legítimo em
-- occurrence_commissions (financeiro/gestor/admin/team_leader, via a policy occ_comm_write já
-- existente) de marcar managed_by_sale=true numa linha sem origem válida nenhuma (nem
-- sale_commission_extra_id, nem um papel fixo reconhecido), contornando a proteção.
--
-- Optei por uma CHECK constraint estrutural em vez de SECURITY DEFINER/REVOKE de coluna: um RPC
-- SECURITY DEFINER precisaria reimplementar sozinho a checagem de papel (financeiro/gestor/admin/
-- team_leader) que a RLS já faz, sob risco de abrir uma brecha se a checagem replicada divergir da
-- policy real — exatamente o tipo de risco que "SECURITY DEFINER sem revisão explícita de
-- autorização" deveria evitar. Um REVOKE de coluna quebraria sync_occurrence_commissions (hoje
-- SECURITY INVOKER, roda com o privilégio de quem chama). A CHECK constraint não depende de papel
-- nem de contexto de chamada — só garante a invariante estrutural, sempre, pra qualquer caminho de
-- escrita: managed_by_sale=true só é válido se a linha tiver uma origem real (sale_commission_extra_id
-- preenchido, ou um papel fixo reconhecido do conjunto captador/vendedor/indicador/líder).
--
-- 0 linhas violam hoje (conferido antes de aplicar).
alter table public.occurrence_commissions
  add constraint occurrence_commissions_managed_by_sale_origem_valida
  check (
    managed_by_sale = false
    or sale_commission_extra_id is not null
    or papel in ('corretor_captador', 'corretor_vendedor', 'indicador_captador', 'indicador_vendedor', 'lider_captador', 'lider_vendedor')
  );
