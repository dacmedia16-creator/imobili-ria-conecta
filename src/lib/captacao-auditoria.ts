/**
 * Correções da auditoria t_874f3f48 no fluxo da captação exclusiva (aprovado por Denis em 08/10/2026):
 * regras da tela (iguais às do banco), faixa da devolução e avisos (sino + WhatsApp).
 * Nada aqui fala com o banco ou com o ZionTalk diretamente: quem chama injeta o que precisa,
 * para os testes rodarem sem envio real.
 */
import type { CaptureDocument, CaptureEvent } from "./exclusive-captures";

/** Motivo pelo qual o botão "Aprovar captação" fica travado (mesma regra de exclusive_transition). */
export function aprovarBloqueio(p: {
  manual: boolean;
  docs: Pick<CaptureDocument, "kind">[];
  dossieMissing: boolean;
}): string | null {
  if (!p.manual && !p.docs.some((d) => d.kind === "gerado"))
    return "Gere o PDF para assinatura pelo sistema antes de aprovar.";
  if (!p.docs.some((d) => d.kind === "assinado")) return "Anexe o contrato assinado antes de aprovar.";
  if (p.dossieMissing)
    return "O Plano de Marketing está sem ações marcadas. Devolva ao corretor para marcar antes de aprovar.";
  return null;
}

/** Gestor/TL/admin pode devolver uma captação aprovada só sem venda ativa ligada (o banco confere). */
export function podeDevolverAprovada(p: {
  manager: boolean;
  status: string;
  archived: boolean;
  temVendaAtiva: boolean;
}): boolean {
  return p.manager && p.status === "aprovada" && !p.archived && !p.temVendaAtiva;
}

/** Aviso do Clicksign ao devolver uma captação que já estava em assinatura (BAIXO-2). */
export const AVISO_CLICKSIGN = "Se o contrato já foi enviado ao Clicksign, cancele o envelope lá.";

export type Devolucao = { motivo: string; quem: string; quando: string };

/** Última devolução registrada (para a faixa no topo da captação devolvida). Nome, nunca UUID. */
export function ultimaDevolucao(
  history: Pick<CaptureEvent, "action" | "detail" | "created_at" | "actor_nome">[],
): Devolucao | null {
  const ultima = [...history]
    .filter((h) => h.action === "devolver")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!ultima) return null;
  return {
    motivo: ultima.detail?.trim() || "Motivo não informado",
    quem: ultima.actor_nome?.trim() || "Gestor",
    quando: new Date(ultima.created_at).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    }),
  };
}

/** Quem agiu, no histórico: "você", o nome ou um rótulo neutro (nunca o UUID). */
export function autorDoHistorico(
  h: Pick<CaptureEvent, "actor_id" | "actor_nome">,
  meuId: string | undefined,
): string {
  if (meuId && h.actor_id === meuId) return "você";
  return h.actor_nome?.trim() || "usuário";
}

// ------------------------------------------------------------------------------------------------
// Avisos (sino + WhatsApp)
// ------------------------------------------------------------------------------------------------

export type EventoCaptacao = "enviada" | "devolvida" | "aprovada";

/** Ação da tela → aviso. 'assinatura' não avisa ninguém. */
export function eventoDaAcao(acao: string): EventoCaptacao | null {
  if (acao === "enviar") return "enviada";
  if (acao === "devolver") return "devolvida";
  if (acao === "aprovar") return "aprovada";
  return null;
}

/**
 * Dispara o aviso depois que a transição JÁ foi gravada. Nunca lança: falha do aviso não desfaz nem
 * trava a ação (a transição vale e o erro fica registrado no servidor).
 */
export async function avisarTransicao(
  acao: string,
  captureId: string,
  notify: (input: { data: { captureId: string; evento: EventoCaptacao } }) => Promise<unknown>,
): Promise<boolean> {
  const evento = eventoDaAcao(acao);
  if (!evento) return false;
  try {
    await notify({ data: { captureId, evento } });
    return true;
  } catch {
    return false;
  }
}

/** Código curto da captação (o mesmo padrão das vendas: 8 primeiros caracteres). */
export function codigoCaptacao(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export type TextoAviso = { titulo: string; mensagem: string; whatsapp: string };

/**
 * Texto dos avisos. Curto, em português, com link. Sem dados do proprietário e sem valores de
 * comissão: só o código, o corretor (para o gestor) e o motivo (escrito pelo gestor).
 */
export function textoAvisoCaptacao(p: {
  evento: EventoCaptacao;
  captureId: string;
  corretor: string | null;
  motivo: string | null;
  appUrl: string;
}): TextoAviso {
  const codigo = codigoCaptacao(p.captureId);
  const link = `${p.appUrl}/exclusividades/${p.captureId}`;
  const motivo = (p.motivo ?? "").trim().slice(0, 300);
  if (p.evento === "devolvida")
    return {
      titulo: `Captação #${codigo} devolvida para ajuste`,
      mensagem: motivo ? `Motivo: ${motivo}` : "Abra a captação para ver o motivo.",
      whatsapp: `*Captação devolvida para ajuste*\n\nCaptação: #${codigo}\nMotivo: ${motivo || "abra a captação para ver"}\n\nAcesse: ${link}`,
    };
  if (p.evento === "aprovada")
    return {
      titulo: `Captação #${codigo} aprovada`,
      mensagem: "A exclusividade foi aprovada pelo gestor.",
      whatsapp: `*Captação aprovada!*\n\nCaptação: #${codigo}\nA exclusividade foi aprovada pelo gestor.\n\nAcesse: ${link}`,
    };
  const corretor = p.corretor?.trim() || "corretor";
  return {
    titulo: `Nova captação #${codigo} para aprovar`,
    mensagem: `Enviada por ${corretor}.`,
    whatsapp: `*Nova captação para aprovar*\n\nCaptação: #${codigo}\nCorretor: ${corretor}\n\nAcesse: ${link}`,
  };
}

export type DestinoAviso = {
  id: string;
  telefone: string | null;
  ativo: boolean | null;
  /** Preferência notificar_whatsapp do papel (padrão de vendas): false = só sino. */
  querWhatsapp: boolean;
};

export type ResultadoAviso = {
  notificados: number;
  enviados: number;
  falhas: number;
  ignorados: number;
  erros: { status: number | null; corpo: string }[];
};

/**
 * Núcleo do aviso: grava o sino de todos os destinatários e manda WhatsApp (ZionTalk) a quem tem
 * telefone, está ativo e não desligou o WhatsApp. Mesmo padrão de sale-notifications: timeout de
 * 10 s por envio, erro sem dados pessoais e registro do resultado. Nunca lança.
 */
export async function enviarAvisosCaptacao(p: {
  texto: TextoAviso;
  destinos: DestinoAviso[];
  gravarSino: (rows: { user_id: string; titulo: string; mensagem: string }[]) => Promise<void>;
  registrar: (r: ResultadoAviso) => Promise<void>;
  apiKey: string | undefined;
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  normalizePhone: (raw: string | null | undefined) => string | null;
  paraWhatsapp: (t: string) => string;
  semDadosPessoais: (t: string) => string;
}): Promise<ResultadoAviso> {
  const r: ResultadoAviso = { notificados: 0, enviados: 0, falhas: 0, ignorados: 0, erros: [] };
  if (!p.destinos.length) return r;
  try {
    await p.gravarSino(
      p.destinos.map((d) => ({ user_id: d.id, titulo: p.texto.titulo, mensagem: p.texto.mensagem })),
    );
    r.notificados = p.destinos.length;
  } catch (e) {
    r.erros.push({ status: null, corpo: `sino: ${p.semDadosPessoais(String(e))}` });
  }
  const erro = (status: number | null, corpo: string) => {
    r.falhas++;
    if (r.erros.length < 10) r.erros.push({ status, corpo });
  };
  for (const d of p.destinos) {
    const phone = d.ativo === false || !d.querWhatsapp ? null : p.normalizePhone(d.telefone);
    // Sem telefone, inativo ou WhatsApp desligado: fica só o sino, sem erro.
    if (!phone || !p.apiKey) {
      r.ignorados++;
      continue;
    }
    try {
      const res = await p.fetchImpl(p.url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${p.apiKey}:`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          msg: p.paraWhatsapp(p.texto.whatsapp),
          mobile_phone: phone,
        }).toString(),
        signal: AbortSignal.timeout(p.timeoutMs),
      });
      if (res.status === 201) r.enviados++;
      else erro(res.status, p.semDadosPessoais(await res.text().catch(() => "")));
    } catch (e) {
      const timeout = e instanceof Error && e.name === "TimeoutError";
      erro(
        null,
        timeout
          ? `timeout ${p.timeoutMs / 1000}s`
          : p.semDadosPessoais(e instanceof Error ? e.message : String(e)),
      );
    }
  }
  try {
    await p.registrar(r);
  } catch {
    // registro é melhor esforço: nunca derruba a ação
  }
  return r;
}
