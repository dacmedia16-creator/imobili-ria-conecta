# Checklist de testes manuais — Sistema Imobiliário

Antes de subir para produção, executar cada cenário abaixo. Para os testes de
isolamento (9 e 10), abra janelas anônimas distintas e use contas de perfis
diferentes. Ideal ter 4 contas: um `corretor A`, um `corretor B` (sem vínculo
com o líder do A), um `gestor` (líder de A apenas) e um `financeiro`.

## Fluxo positivo

1. **Corretor A cria rascunho**
   - Login como corretor A → `Nova Venda`.
   - Preencher ID do imóvel, matrícula, um vendedor completo, um comprador completo, valor negociado, percentual de comissão e forma de pagamento.
   - Enviar RG, CPF e matrícula (upload em Documentos).
   - Verificar barra de progresso subindo.

2. **Envio para revisão**
   - Clicar "Enviar para revisão" → modal de conferência aparece com checklist verde.
   - Confirmar → status muda para **Enviada para revisão**.

3. **Gestor devolve para ajuste**
   - Login como gestor → abrir a venda → "Devolver para ajuste" com motivo.
   - Status vai para **Devolvida para ajuste**. Comentário fica visível.

4. **Corretor corrige e reenvia**
   - Corretor A vê a devolução, edita o campo pedido e reenvia.
   - Status volta para **Enviada para revisão**.

5. **Gestor aprova**
   - Gestor aprova → status **Aprovada pelo gestor** e visível ao jurídico.

6. **Jurídico conduz contrato**
   - Login como jurídico → "Iniciar contrato" → "Aguardando assinatura" → "Contrato assinado".
   - Ao marcar contrato assinado, o sistema automaticamente muda para **Ocorrência pendente** e cria notificação para o financeiro.

7. **Financeiro cria e finaliza ocorrência**
   - Login como financeiro → abrir a venda → aba **Ocorrência** → "Criar ocorrência a partir dos dados da venda".
   - Conferir preenchimento automático (código imóvel, valores, % comissão, financiamento).
   - Adicionar comissões nos 6 papéis. Verificar que ao preencher o percentual, o valor é calculado automaticamente.
   - Adicionar uma parceria com CPF/CNPJ e banco.
   - Se a soma das comissões ultrapassar o valor total, aparece alerta.
   - Clicar "Finalizar ocorrência" → status da venda vira **Ocorrência concluída**.
   - Histórico e log de atividade devem registrar a mudança.

8. **Reabertura (opcional)**
   - Financeiro/admin abre a ocorrência concluída → botão "Reabrir" com motivo obrigatório.
   - Status volta para **Ocorrência pendente**.

## Testes de segurança (obrigatórios)

9. **Isolamento por corretor**
   - Login como corretor B → abrir `/vendas`.
   - **Não deve** ver a venda do corretor A.
   - Tentar acessar diretamente `/vendas/<id-da-venda-do-A>` → tela mostra "Carregando..." e não carrega dados (RLS bloqueia).

10. **Isolamento de documentos**
    - Copiar o `storage_path` de um documento da venda do corretor A (via banco).
    - Como corretor B, tentar `supabase.storage.from('sale-documents').createSignedUrl(...)` no console → deve falhar.
    - Alternativa: tentar acessar o link assinado do corretor A após ele expirar (5 min) → deve retornar 404.

11. **Isolamento por equipe**
    - Login como o gestor (líder apenas do corretor A) → `/vendas` mostra as vendas do A e não as do B.

12. **Escalada de privilégio**
    - Como corretor A, no console: `await supabase.from('user_roles').insert({ user_id: '<meu-id>', role: 'admin' })`.
    - Deve retornar erro de RLS (`user_roles_admin_all` restringe escrita a admin).

## Regressões

- Progresso do checklist reflete campos + documentos aprovados.
- Barra de botões só mostra ações permitidas pelo perfil e status atuais.
- Notificações do próprio usuário aparecem no menu (se implementado) ou no banco.
- `activity_logs` recebe registro em cada mudança de status e finalização de ocorrência.
