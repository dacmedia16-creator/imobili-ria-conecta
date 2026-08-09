-- Achado testando a RPC sync_occurrence_commissions (migration anterior): o FK sale_commission_extra_id
-- estava ON DELETE SET NULL. Ao apagar um extra (outro captador/vendedor/gestor/team_leader) no
-- Resumo, a linha órfã em occurrence_commissions perdia a referência IMEDIATAMENTE (antes do RPC
-- rodar), virando indistinguível de uma linha fixa (sale_commission_extra_id IS NULL) — colidia
-- com o match de papel fixo (corretor_captador/vendedor) e virava uma duplicata fantasma em vez de
-- ser removida. CASCADE remove a linha junto com o extra, na hora, sem depender de nenhum sync
-- rodar depois — resolve a causa raiz em vez de só o sintoma.
alter table public.occurrence_commissions
  drop constraint occurrence_commissions_sale_commission_extra_id_fkey,
  add constraint occurrence_commissions_sale_commission_extra_id_fkey
    foreign key (sale_commission_extra_id) references public.sale_commission_extras(id) on delete cascade;
