## Regras de criação de usuários

| Quem cria | Papéis que pode conceder |
|---|---|
| **Super Admin** | qualquer papel (corretor, gestor, jurídico, financeiro, admin, super_admin) |
| **Admin** | corretor, gestor, jurídico, financeiro (não pode criar admin nem super_admin) |
| **Gestor** | apenas corretor (e o novo corretor entra automaticamente como membro da sua equipe) |
| Qualquer outro | não pode criar |

Cadastro público em `/auth` fica **desativado** — só login.

## Mudanças

### 1. Backend
- `supabase--configure_auth` → `disable_signup: true` (mantém login por senha).
- Nova server function `createUser` em `src/lib/admin-users.functions.ts`:
  - `.middleware([requireSupabaseAuth])`
  - Valida com Zod: `nome`, `email`, `password (≥8)`, `role` (enum).
  - Lê papéis do chamador via `context.supabase.rpc("has_role", ...)`.
  - Aplica matriz acima; nega com mensagem clara se violar.
  - `await import("@/integrations/supabase/client.server")` → `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nome } })`.
  - Trigger `handle_new_user` já cria profile + role `corretor`. A função então:
    - Se `role !== "corretor"`: remove role `corretor` e insere a role pedida.
    - Se chamador for **gestor** criando corretor: insere em `team_members (lider_id = caller, membro_id = novo)`.
  - Retorna `{ id }` ou erro. Trata "email já existe" com mensagem amigável.

### 2. Frontend
- `src/routes/auth.tsx`: remover aba/toggle de cadastro; mostrar só login. Um aviso pequeno: "Cadastro apenas por convite do administrador."
- `src/routes/_authenticated/admin.usuarios.tsx`:
  - Permitir a rota também para `gestor` (hoje só admin/super_admin).
  - Se for **gestor**: mostra somente o botão "Novo corretor" e esconde a matriz de edição de papéis dos outros (mantém apenas visualização dos corretores da própria equipe).
  - Se for **admin/super_admin**: comportamento atual + botão "Novo usuário" (dialog com select de papel filtrado pelas regras acima).
  - Dialog: Nome, E-mail, Senha (com botão "gerar 12 chars"), Papel (select filtrado). Ao confirmar chama `useServerFn(createUser)`, mostra toast com senha copiável e recarrega a lista.
- Novo item no menu para gestor não é necessário — link "Usuários" na sidebar passa a aparecer também para `gestor` (via `hasAny(["admin","super_admin","gestor"])`).

### 3. RLS
- Não muda RLS de `user_roles`/`profiles`/`team_members`. A função roda como service role para inserir; a autorização é feita no handler pela matriz acima. Isso é seguro porque `requireSupabaseAuth` garante identidade e o handler valida papel antes de tocar em `supabaseAdmin`.

## O que NÃO muda
- Nenhuma tabela, trigger ou política existente.
- Fluxo de vendas, ocorrência, notificações, dashboards.
- `super_admin` já promovido continua o mesmo.

Confirma que posso implementar assim?