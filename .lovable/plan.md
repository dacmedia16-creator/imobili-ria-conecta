# Testar todos os fluxos do sistema

Sua conta `dacmedia16@gmail.com` está como **corretor**. Para testar todos os papéis (Gestor, Jurídico, Financeiro, Admin), precisamos te promover e opcionalmente criar usuários fictícios para simular o fluxo completo.

## 1. Promoção da sua conta

Adicionar os papéis na sua conta para que você consiga abrir todas as telas:
- `admin` (acesso total + tela de Admin/Usuários)
- `financeiro` (finalizar ocorrência de comissão)
- `juridico` (revisar contratos)
- `coordenador` (aprovar vendas da equipe)
- mantém `corretor` (cadastrar vendas)

Assim, com um único login você percorre todo o pipeline.

## 2. Usuários de demonstração (opcional)

Para testar a regra "gestor vê só sua equipe" e "corretor vê só o dele", posso criar 3 usuários fictícios já confirmados:

- `corretor.demo@imob.test` (corretor, vinculado a você como líder)
- `gestor.demo@imob.test` (coordenador)
- `juridico.demo@imob.test` (jurídico)

Senha padrão: `Demo@2026!`. Você pode logar com qualquer um deles em janela anônima para validar as permissões.

## 3. Roteiro de teste sugerido

Sequência para validar o pipeline ponta a ponta usando sua conta com todos os papéis:

1. **Nova Venda** → criar rascunho com dados do imóvel e partes.
2. **Upload de documentos** em pelo menos 2 das 10 seções (PDF/JPG).
3. **Mudar status** Rascunho → Enviada para gestor.
4. **Aprovar como Gestor** → status vai para Jurídico.
5. **Aprovar como Jurídico** → Contrato assinado.
6. **Preencher Ocorrência** (Financeiro) com valores e comissões → Ocorrência concluída.
7. **Dashboard**: conferir KPIs atualizados.
8. **Admin → Usuários**: validar troca de papéis e vínculo de equipe.

## O que preciso confirmar

- Posso **promover sua conta** com os 5 papéis acima? (sim/não)
- Quer que eu **crie os 3 usuários demo** para testar isolamento por RLS? (sim/não)

Depois que aprovar, eu executo as duas ações e te entrego o roteiro pronto para clicar.
