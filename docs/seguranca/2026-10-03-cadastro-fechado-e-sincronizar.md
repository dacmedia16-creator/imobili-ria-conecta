# Spec — fechar cadastro público e EXECUTE das funções sincronizar_* (03/10/2026)

Origem: revisão t_f9022dc6 (achados C1 e M1). Autorização de Denis em 03/10/2026, somente achados 1 e 3.
O achado 2 (list_public_specialists) está fora deste escopo.

## Achado 1 — cadastro público aberto

Problema: `disable_signup=false` no Auth. Qualquer pessoa chamava `/auth/v1/signup`. O gatilho
`handle_new_user` coloca usuário sem `organization_id` no app_metadata na organização padrão como
corretor ativo, que pode ler clientes.

Como um corretor entra hoje:
- pela tela Usuários (`createUser` → `auth.admin.createUser` no servidor, com `app_metadata.organization_id`);
- pelo primeiro admin de agência (`platform-organizations.server.ts`: `createUser` + `generateLink` recovery);
- pela ponte Conta MAX (`conta-max-bridge`: `generateLink` magiclink, só para usuário já vinculado);
- a tela `/auth` só tem login por e-mail e senha e já diz "Cadastro apenas por convite";
- o único provedor ativo é e-mail (sem Google).

Decisão: `disable_signup=true`. Pela documentação do Supabase Auth, com o signup desligado a criação
de usuário fica restrita ao admin/convite. `admin.createUser`, `generateLink` e o login de quem já
existe continuam funcionando.

Verificação: `POST /auth/v1/signup` com a chave pública passa a responder `signup_disabled`. O login de
um usuário existente continua funcionando.
Rollback: `PATCH /v1/projects/<ref>/config/auth {"disable_signup": false}`.

## Achado 3 — EXECUTE das funções sincronizar_*

Problema: `sincronizar_base_financeira_ocorrencia(uuid)` e `sincronizar_previsao_ocorrencia_pendente(uuid)`
são SECURITY DEFINER, não checam papel e tinham EXECUTE para `authenticated`.

Chamadores: nenhum no frontend, nas edge functions ou no cron. No banco, só a função de trigger
`trg_sincronizar_previsao_ocorrencia_pendente()` (dono postgres, que mantém o privilégio).
A sincronização real usa `sincronizar_ocorrencia_antes_financeiro`, que não muda.

Mudança: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` e manter o EXECUTE de `service_role`.
Rollback: `supabase/rollback/20261003110000_revoga_execute_sincronizar_authenticated.sql`.
