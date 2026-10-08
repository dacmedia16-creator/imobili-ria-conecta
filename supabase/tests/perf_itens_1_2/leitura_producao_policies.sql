select tablename, policyname, cmd, permissive, roles::text roles, qual, with_check
from pg_policies where schemaname='public'
 and ((coalesce(qual,'')||coalesce(with_check,'')) ~ '(can_view_sale|can_read_principal_sale_as_co_leader|can_manage_sale_as_co_leader|can_read_sale_juridico_certidao|can_edit_sale_as_co_leader)\('
      or (tablename='sales' and policyname='sales_select'))
order by 1,2
