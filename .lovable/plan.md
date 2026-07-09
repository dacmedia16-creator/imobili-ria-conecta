## Erro ao anexar contrato (usuário Jurídico) — correção

### Causa
A política de leitura `sales_select` do Jurídico só inclui alguns status (`aprovada_gestor`, `enviada_juridico`, `em_elaboracao_contrato`, `aguardando_assinatura`, `contrato_assinado`, `ocorrencia_pendente`, `ocorrencia_concluida`). Faltam os intermediários que o próprio fluxo criou:

- `contrato_conferencia_gestor`
- `contrato_conferencia_corretor`
- `contrato_ok_corretor`
- `ocorrencia_analise_financeiro`
- `ocorrencia_devolvida_gestor`

Quando o Jurídico clica em **"Anexar contrato e enviar ao gestor"**, o front faz `UPDATE sales SET status='contrato_conferencia_gestor'`. Com `return=representation` (padrão do Supabase JS), o PostgREST relê a linha já com o novo status — que o Jurídico não pode mais ver — e devolve `42501 / new row violates row-level security policy`. O mesmo problema derruba as demais transições intermediárias (voltar do gestor para o jurídico, etc.).

Como bônus, `sales_select` e `sales_update_owner_draft` ainda referenciam a role `coordenador` (removida) e não incluem `super_admin` no bypass.

### O que vou fazer

**1. Migração em `public.sales` (uma migração só):**
- Recriar `sales_select` para Jurídico com a lista completa de status do fluxo de contrato + ocorrência.
- Adicionar `super_admin` ao bypass admin/financeiro em `sales_select`.
- Remover referências à role `coordenador` em `sales_select` e `sales_update_owner_draft`.
- Atualizar `public.can_view_sale` incluindo `super_admin` e removendo `coordenador`.
- Manter `sales_update_owner_draft` com a mesma semântica (USING + WITH CHECK via `can_view_sale` + trava do financeiro), agora coerente com a SELECT expandida.

**2. Frontend — `src/routes/_authenticated/vendas.$id.tsx`:**
- Trocar `.update({ status }).eq('id', id)` por `.update(...).eq('id', id).select('id').maybeSingle()` (projeção mínima) para reduzir sensibilidade a policies de leitura e melhorar a mensagem de erro exibida.
- Renderizar os botões de ação apenas quando `!loading` do `useAuth`, evitando cliques com papéis ainda não carregados.

### Verificação
- Como **Jurídico**, avançar `em_elaboracao_contrato` → `contrato_conferencia_gestor` deve funcionar e a venda continua visível na lista do Jurídico.
- Como **Gestor**, devolver ao jurídico e mandar ao corretor devem funcionar.
- Como **Corretor** puro, botões de Jurídico/Gestor/Financeiro não aparecem.
- Rodar `supabase--linter` depois da migração.

Confirma que aplico?
