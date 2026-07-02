# Checklist de Teste de Acesso por Perfil

Rode antes de liberar o sistema para a equipe. Use pelo menos um usuário de cada papel + dois corretores diferentes (A e B) e dois gestores diferentes (G1 e G2), onde G1 é líder do Corretor A.

## 1. Corretor só vê as próprias vendas
- Entrar como **Corretor A**. Ir em **Vendas**.
- Deve listar somente vendas cujo `corretor_id = A`.
- Abrir a URL de uma venda do **Corretor B** manualmente (`/vendas/<id>`).
- **Esperado**: "Carregando..." seguido de venda vazia / não encontrada; nada da venda de B deve aparecer.

## 2. Gestor sem equipe não vê nada
- Entrar como **G2** (sem vínculo com nenhum corretor).
- Ir em **Vendas**.
- **Esperado**: mensagem "Nenhuma venda visível. Peça ao administrador para vincular corretores à sua equipe."
- Conferir em **Meu acesso** → "Corretores da minha equipe" listado vazio.

## 3. Gestor vê equipe
- Entrar como **G1** (líder de A).
- **Esperado**: enxerga as vendas do Corretor A, não enxerga as de B.

## 4. Jurídico não vê rascunho
- Como Corretor A, criar uma venda em **rascunho**.
- Entrar como **Jurídico**.
- **Esperado**: essa venda não aparece na lista nem abre por URL direta.
- Enviar a venda até "aprovada pelo gestor". Recarregar como Jurídico.
- **Esperado**: agora a venda aparece.

## 5. Financeiro trava a venda
- Levar uma venda até "ocorrência pendente".
- Entrar como **Financeiro**, abrir a ocorrência e clicar **Aceitar e travar**.
- Entrar como **Corretor A** (dono da venda), abrir a mesma venda.
- **Esperado**: banner verde "Venda travada pelo Financeiro"; todos os campos ficam em modo leitura; upload de documento bloqueado.
- Voltar como **Financeiro** e clicar **Liberar edições**.
- **Esperado**: corretor volta a editar.

## 6. Admin não pode se autopromover / não pode dar Admin
- Entrar como **Admin** (não super admin) em `/admin/usuarios`.
- **Esperado**: botão do próprio usuário fica desabilitado; papéis "Admin" e "Super Admin" retornam erro ao tentar aplicar a outro usuário.

## 7. Super Admin gerencia Admins
- Entrar como **Super Admin** em `/admin/usuarios`.
- Conceder e revogar o papel Admin a outro usuário.
- **Esperado**: ação funciona e aparece em `activity_logs` (`role_granted` / `role_revoked`).

## 8. Log de visualização de venda de terceiros
- Como **Gestor G1**, abrir uma venda do Corretor A.
- Consultar `activity_logs` filtrando por `acao = 'sale_viewed'`.
- **Esperado**: registro com `autor_id = G1` e `sale_id` da venda aberta.
- Repetir como **Corretor A** abrindo a própria venda.
- **Esperado**: **não** deve gerar `sale_viewed` (só quando o dono é outro).

---

## Como conferir no banco
Use o painel de backend do Lovable Cloud e execute SELECTs em:
- `user_roles` — papéis por usuário
- `team_members` — vínculo gestor → corretor
- `activity_logs` — auditoria (`role_granted`, `role_revoked`, `sale_viewed`, `occurrence_locked`, `occurrence_unlocked`, `occurrence_reopened`)
