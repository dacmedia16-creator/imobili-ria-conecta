// Documentos finais da Locação (t_dfc8daf2): regras puras usadas pelo servidor e pelos testes.

export type TipoFinal = "contrato_locacao" | "contrato_adm" | "laudo";

/**
 * Trava própria do envio automático/reenvio aos CLIENTES (locatário e proprietário), separada dos avisos internos
 * (LOCACAO_AVISOS_WHATSAPP). Só o valor exato "on" liga; ausente ou qualquer outro valor = desligado.
 * Ligar depende de teste controlado e de autorização do Denis.
 */
export function docsFinaisWhatsappLigado(valor: string | undefined | null): boolean {
  return valor === "on";
}

/** Mensagem curta e SEM dados pessoais (sem nome, endereço, valor ou código da locação). Só ASCII (ZionTalk). */
export function mensagemFinal(tipo: TipoFinal): string {
  const nome =
    tipo === "laudo"
      ? "laudo de vistoria"
      : tipo === "contrato_adm"
        ? "contrato de administracao"
        : "contrato de locacao";
  return `Ola! Segue, em anexo, o ${nome} assinado. Guarde este arquivo para consulta.`;
}

/** Nome genérico do anexo enviado ao cliente: não expõe o nome original do arquivo (pode ter nome/CPF). */
export function nomeAnexoFinal(tipo: TipoFinal): string {
  return `${tipo}.pdf`;
}

/** Quem recebe cada documento: o contrato de administração é só do proprietário com a imobiliária. */
export function destinosFinal(tipo: TipoFinal): ("locatario" | "proprietario")[] {
  return tipo === "contrato_adm" ? ["proprietario"] : ["locatario", "proprietario"];
}
