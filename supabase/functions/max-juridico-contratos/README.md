# MAX Jurídico — consulta de contratos

Endpoint somente leitura para o MAX Jurídico consultar contratos do Portal Interno.

## Segredos da função

Configurar no projeto Supabase, fora do repositório:

- `SUPABASE_SERVICE_ROLE_KEY`: segredo nativo do projeto.
- `MAX_JURIDICO_API_TOKEN`: token exclusivo, aleatório, com pelo menos 32 caracteres, guardado no cofre do agente.

O `SUPABASE_SERVICE_ROLE_KEY` nunca deve ser entregue ao agente ou incluído em uma requisição.

## Requisição

`POST /functions/v1/max-juridico-contratos`

Header:

```text
Authorization: Bearer <MAX_JURIDICO_API_TOKEN>
```

Busca:

```json
{
  "action": "search",
  "sale_id": "uuid-opcional",
  "types": ["contrato", "contrato_assinado"],
  "status": "enviado",
  "limit": 20,
  "offset": 0
}
```

Documento específico:

```json
{
  "action": "get",
  "document_id": "uuid-do-documento"
}
```

A resposta contém os metadados permitidos e `signed_url`, válido por 300 segundos. A função aceita apenas os tipos `contrato`, `contrato_assinado`, `aditivo` e `distrato`; a consulta padrão usa somente contrato e contrato assinado.

## Implantação

1. Aplicar a migration `20260919050000_max_juridico_contract_read_api.sql`.
2. Configurar os dois segredos pelo canal protegido do Supabase.
3. Publicar a função `max-juridico-contratos` com JWT da borda desativado, pois a função valida `MAX_JURIDICO_API_TOKEN` internamente.
4. Executar os testes de autenticação, escopo, link temporário e bloqueio de escrita.
5. Entregar ao MAX Jurídico somente `MAX_JURIDICO_API_TOKEN` pelo cofre.
