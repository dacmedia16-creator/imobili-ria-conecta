// Envio individual do link + código da proposta de compra (t_4cff61a6). Só no servidor.
// Canal: o MESMO WhatsApp dos avisos de venda e captação (avisos-canais.server.ts, chave ZIONTALK_API_KEY).
// NUNCA ZIONTALK_LEADS_IA_API_KEY, ZIONTALK_MAX_API_KEY nem nada do Visita MAX.
//
// Padrão = SIMULAÇÃO (dry-run): monta a mensagem e não envia nada. Envio real só com
// PROPOSTA_WHATSAPP_REAL=1 e, em teste, PROPOSTA_WHATSAPP_SO_PARA=<número> recusa qualquer outro destino.
// O código e o telefone nunca vão para log nem para o retorno.
import { enviarWhatsappZiontalk } from "./avisos-canais.server";
import { normalizePhone, paraWhatsapp } from "./sale-notifications.functions";
import { CODIGO_RE, TOKEN_RE, montarMensagem, propostaLinkUrl } from "./proposta-compra";

/** Linha de proposta_envio_dados (service_role). */
export type ItemEnvio = {
  codigo_id: string;
  codigo: string;
  telefone: string | null;
  token: string;
  parte_nome: string | null;
  papel: string;
  ordem: number;
  imobiliaria: string;
  endereco: string | null;
  corretor_nome: string | null;
  corretor_telefone: string | null;
};

export type Enviar = (telefone: string, texto: string) => Promise<boolean>;
export type Canal = { modo: "simulacao" | "real"; enviar: Enviar };
export type ResultadoItem = {
  codigo_id: string;
  papel: string;
  ordem: number;
  status: "enviado" | "falhou" | "simulado" | "bloqueado";
};
export type EnvEnvio = Record<string, string | undefined>;

/** A ÚNICA chave aceita. Outras chaves no ambiente são ignoradas de propósito. */
export function chaveDoEnvio(env: EnvEnvio): string | null {
  const k = env.ZIONTALK_API_KEY?.trim();
  return k ? k : null;
}

/** Simulação por padrão. Real só com PROPOSTA_WHATSAPP_REAL=1 e a chave dos avisos configurada. */
export function canalDoAmbiente(
  env: EnvEnvio,
  enviarReal: (chave: string, telefone: string, texto: string) => Promise<boolean> = enviarWhatsappZiontalk,
): Canal {
  const chave = chaveDoEnvio(env);
  if (env.PROPOSTA_WHATSAPP_REAL !== "1" || !chave) return { modo: "simulacao", enviar: async () => false };
  const soPara = normalizePhone(env.PROPOSTA_WHATSAPP_SO_PARA ?? null);
  return {
    modo: "real",
    enviar: async (tel, texto) => (soPara && tel !== soPara ? false : enviarReal(chave, tel, texto)),
  };
}

export function textoDoItem(item: ItemEnvio, origin: string): string {
  if (!TOKEN_RE.test(item.token) || !CODIGO_RE.test(item.codigo)) throw new Error("Item de envio inválido");
  return paraWhatsapp(
    montarMensagem({
      imobiliaria: item.imobiliaria,
      endereco: item.endereco,
      link: propostaLinkUrl(origin, item.token),
      codigo: item.codigo,
      parteNome: item.parte_nome,
      corretorNome: item.corretor_nome,
      corretorTelefone: item.corretor_telefone,
    }),
  );
}

/**
 * Uma mensagem por parte, em série (nada em massa). `registrar` grava o resultado no banco
 * (proposta_envio_resultado); na simulação nada é gravado, para o código continuar "não enviado".
 */
export async function enviarCodigos(
  itens: readonly ItemEnvio[],
  opts: {
    origin: string;
    canal: Canal;
    registrar?: (codigoId: string, ok: boolean, erro: string | null) => Promise<void>;
    soPara?: string | null;
  },
): Promise<ResultadoItem[]> {
  const out: ResultadoItem[] = [];
  for (const item of itens) {
    const base = { codigo_id: item.codigo_id, papel: item.papel, ordem: item.ordem };
    const tel = normalizePhone(item.telefone);
    let texto: string;
    try {
      texto = textoDoItem(item, opts.origin);
    } catch {
      out.push({ ...base, status: "falhou" });
      continue;
    }
    if (!tel) {
      out.push({ ...base, status: "falhou" });
      if (opts.canal.modo === "real") await opts.registrar?.(item.codigo_id, false, "sem telefone");
      continue;
    }
    if (opts.canal.modo === "simulacao") {
      out.push({ ...base, status: "simulado" });
      continue;
    }
    if (opts.soPara && tel !== normalizePhone(opts.soPara)) {
      out.push({ ...base, status: "bloqueado" });
      continue;
    }
    let ok = false;
    try {
      ok = await opts.canal.enviar(tel, texto);
    } catch {
      ok = false;
    }
    await opts.registrar?.(item.codigo_id, ok, ok ? null : "falha no envio");
    out.push({ ...base, status: ok ? "enviado" : "falhou" });
  }
  return out;
}
