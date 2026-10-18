// Imports relativos: este módulo também é carregado pela task do Nitro (server/tasks).
import { normalizePhone, whatsappText } from "./room-reservation-reminders";

/**
 * WhatsApp dos avisos de status da Clicksign (cartão t_f8dc8b99). O banco decide QUEM recebe e QUANDO
 * (gatilho em clicksign_envelopes + lembrete de prazo) e grava numa fila; esta rotina, rodando na
 * agenda de 5 minutos que o ADM MAX já tem, só envia pela mesma chave ZionTalk das outras
 * notificações. Só 4 eventos vão para o WhatsApp: enviado, finalizado (todos assinaram), recusado e
 * prazo perto de vencer. Texto sem CPF, e-mail ou nome de cliente.
 */
export type EventoWhats = "enviado" | "finalizado" | "recusado" | "prazo_perto";

export type PendenteWhats = {
  id: number;
  evento: EventoWhats;
  origem: "captacao" | "venda";
  ref_id: string;
  rotulo: string;
  prazo: string | null;
  env_status: string;
  telefone: string | null;
  ativo: boolean;
  quer_whatsapp: boolean;
  is_test: boolean;
};

/** Texto exato do WhatsApp (antes da limpeza para ASCII exigida pelo ZionTalk). */
export function textoWhatsClicksign(
  p: Pick<PendenteWhats, "evento" | "origem" | "ref_id" | "rotulo" | "prazo" | "is_test">,
  appUrl: string,
): string {
  const link = `${appUrl}/${p.origem === "venda" ? "vendas" : "exclusividades"}/${p.ref_id}`;
  const teste = p.is_test ? " (TESTE)" : "";
  const corpo = (titulo: string, linhas: string[]) =>
    `*${titulo}*${teste}\n\n${p.rotulo}\n${linhas.join("\n")}\n\nAcesse: ${link}`;
  switch (p.evento) {
    case "enviado":
      return corpo("Contrato enviado para assinatura", [
        `Enviado pela Clicksign.${p.prazo ? ` Prazo para assinar: ${p.prazo}.` : ""}`,
      ]);
    case "finalizado":
      return corpo(
        "Contrato assinado por todos",
        p.origem === "venda"
          ? ["O contrato assinado foi anexado à venda e já está disponível para baixar."]
          : [
              "O contrato assinado já está disponível para baixar no sistema.",
              "O gestor precisa aprovar a captação.",
            ],
      );
    case "recusado":
      return corpo("Assinatura recusada", [
        "Um signatário recusou a assinatura na Clicksign e o envio foi cancelado.",
        "Confira e envie o contrato de novo.",
      ]);
    case "prazo_perto":
      return corpo("Prazo da assinatura perto de vencer", [
        `O prazo na Clicksign vence em ${p.prazo ?? "breve"} e ainda falta assinatura.`,
      ]);
  }
}

export type AvisosDb = {
  /** clicksign_lembrete_prazo(): cria os lembretes de prazo (3 dias antes, 9h–20h de Brasília). */
  lembretePrazo(): Promise<number>;
  pendentes(limite: number): Promise<PendenteWhats[]>;
  marcar(id: number, resultado: "ok" | "ignorado" | "erro", erro?: string): Promise<void>;
};
export type WhatsSender = (phone: string, message: string) => Promise<boolean>;

/** Roda uma vez: lembretes de prazo + envio da fila. Nunca lança por causa de um envio. */
export async function runClicksignAvisos(
  db: AvisosDb,
  send: WhatsSender,
  appUrl: string,
): Promise<{ lembretes: number; enviados: number; ignorados: number; falhas: number }> {
  const out = { lembretes: 0, enviados: 0, ignorados: 0, falhas: 0 };
  try {
    out.lembretes = await db.lembretePrazo();
  } catch {
    // Lembrete é melhor esforço: a fila dos outros avisos segue.
  }
  const lista = await db.pendentes(50);
  const usados = new Set<string>();
  for (const p of lista) {
    const phone = p.ativo && p.quer_whatsapp ? normalizePhone(p.telefone) : null;
    // Prazo perto de vencer: se o envelope já fechou ou foi cancelado, não manda.
    const resolvido = p.evento === "prazo_perto" && p.env_status !== "running";
    const chave = `${phone}|${p.ref_id}|${p.evento}`;
    if (!phone || resolvido || usados.has(chave)) {
      out.ignorados++;
      await db.marcar(p.id, "ignorado", resolvido ? "prazo_resolvido" : phone ? "duplicado" : "sem_whatsapp");
      continue;
    }
    usados.add(chave);
    let erro: string | null = null;
    try {
      if (!(await send(phone, whatsappText(textoWhatsClicksign(p, appUrl))))) erro = "ziontalk_send_failed";
    } catch {
      erro = "ziontalk_request_failed";
    }
    if (erro) out.falhas++;
    else out.enviados++;
    await db.marcar(p.id, erro ? "erro" : "ok", erro ?? undefined);
  }
  return out;
}
