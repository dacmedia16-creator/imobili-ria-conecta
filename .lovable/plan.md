## Excluir venda

Adicionar exclusão de venda com regras por papel.

### Matriz de permissão
| Papel | Pode excluir |
|---|---|
| Super Admin | qualquer venda |
| Financeiro | qualquer venda |
| Admin | qualquer venda (mesmo nível operacional dos acima) |
| Gestor | vendas cujo `corretor_id` seja membro da sua equipe (`team_members.lider_id = auth.uid()`) ou dele próprio |
| Corretor | apenas vendas onde `corretor_id = auth.uid()` |
| Jurídico | não pode excluir |

Observação: incluo **admin** junto de super_admin/financeiro porque hoje admin já tem visão total. Se preferir que admin NÃO exclua, me avisa antes de aprovar.

### Backend

1. **Migração** — política RLS de DELETE em `public.sales`:
   ```sql
   CREATE POLICY "delete_sales_por_papel" ON public.sales
   FOR DELETE TO authenticated
   USING (
     has_any_role(auth.uid(), ARRAY['super_admin','admin','financeiro']::app_role[])
     OR corretor_id = auth.uid()
     OR (has_role(auth.uid(),'gestor') AND is_lead_of(auth.uid(), corretor_id))
   );
   ```
   As tabelas filhas (`sale_parties`, `sale_payment`, `sale_documents`, `sale_comments`, `sale_status_history`, `sale_bank_accounts`, `occurrences` + filhos, `notifications`, `activity_logs`) precisam de `ON DELETE CASCADE` no FK para `sales(id)`. Vou revisar cada FK e adicionar `CASCADE` onde faltar (drop + recreate constraint).
   - Documentos no storage bucket `sale-documents`: registro em `sale_documents` some via cascade, mas o arquivo físico fica. Vou remover os arquivos do bucket **antes** do delete no client (listar `sale_documents.storage_path` da venda e chamar `supabase.storage.from('sale-documents').remove([...])`).

2. **Nada de nova server function** — o delete vai direto pelo client Supabase (RLS garante a regra). Se algum cascade não puder ser adicionado por dependência de negócio, aí sim faço um `deleteSale` server fn.

### Frontend

1. **`src/routes/_authenticated/vendas.$id.tsx`**: botão "Excluir venda" (variante `destructive`, ícone lixeira) no cabeçalho, ao lado das ações existentes. Só aparece se o usuário tem permissão (checagem client-side espelhando a matriz — a autoridade final é a RLS).
   - Abre `AlertDialog` de confirmação mostrando código/matrícula da venda e aviso "Esta ação não pode ser desfeita. Todos os documentos, partes, pagamentos, comentários e ocorrências serão removidos."
   - Ao confirmar: lista storage_paths → `storage.remove(...)` → `delete().eq('id', saleId)` → toast → `router.navigate({ to: "/vendas" })`.

2. **`src/routes/_authenticated/vendas.index.tsx`**: ícone de lixeira em cada linha da lista (mesma checagem de permissão), com o mesmo `AlertDialog`. Após excluir, refetch da lista.

3. Helper `canDeleteSale(user, roles, sale, teamMemberIds)` em `src/lib/status.ts` (ou novo `src/lib/permissions.ts`) para não duplicar a lógica entre as duas telas.

### O que NÃO muda
- Fluxo de status, ocorrências, notificações, dashboards.
- Políticas de SELECT/INSERT/UPDATE existentes.
- Nenhuma outra tabela ou role.
