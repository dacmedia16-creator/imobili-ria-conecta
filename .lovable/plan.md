## Excluir documento e reenviar

Hoje em `DocumentsPanel` (`src/routes/_authenticated/vendas.$id.tsx`) cada arquivo listado mostra apenas download, badge de IA, aprovar/recusar. Não há como remover um arquivo errado — só dá para enviar outro por cima. O botão de re-leitura da IA (ícone Sparkles) já existe e continua funcionando.

### O que fazer

1. **Botão excluir por arquivo** (linha ~942, dentro do `list.map((d) => ...)`):
   - Novo `Button` ícone `Trash2`, variant `ghost`, com `title="Excluir documento"`.
   - Aparece somente quando `editable` for true e (o dono do upload `d.uploaded_by === user.id` OU `canModerate`) — evita corretor apagar doc de outro.
   - Ao clicar, abre `AlertDialog` de confirmação (usar o padrão shadcn já presente no arquivo para exclusão de venda) com o nome do arquivo.

2. **Handler `remove(doc)`** dentro de `DocumentsPanel`:
   - `supabase.storage.from("sale-documents").remove([doc.storage_path])` (ignora erro se o arquivo já sumiu, mas loga).
   - `supabase.from("document_extractions").delete().eq("document_id", doc.id)` para não deixar dados órfãos que a IA aplicaria depois.
   - `supabase.from("sale_documents").delete().eq("id", doc.id)`.
   - `activity_logs` com `acao: "document_deleted"`, payload `{ doc_id, tipo, parte, file_name }`.
   - `toast.success("Documento excluído")` + `onChange()`.

3. **Reupload + re-leitura** já funcionam: o input file existente insere novo `sale_documents` e chama `runExtraction`. Depois de excluir, o mesmo botão "Enviar" volta a aparecer naturalmente. Nenhum ajuste extra.

### Segurança / RLS

A policy DELETE em `public.sale_documents` precisa permitir dono do upload, gestor da equipe, jurídico, financeiro, admin, super_admin. Verificar via `supabase--read_query` antes de implementar; se estiver restrita demais, adicionar migração com policy `USING (uploaded_by = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['gestor','juridico','financeiro','admin','super_admin']::app_role[]))` (gestor limitado a `is_lead_of`). Igualmente checar policy DELETE em `storage.objects` para o bucket `sale-documents`.

### Fora de escopo

- Não mexer no fluxo do Wizard, extração da IA, ou outras etapas.
- Não adicionar undo/lixeira — exclusão é definitiva.
