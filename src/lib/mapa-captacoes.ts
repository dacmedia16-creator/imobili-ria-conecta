/**
 * Tela "Mapa de captações". Os dados vêm de mapa_captacoes_v2(), que já corta no banco o que cada
 * perfil pode ver: só captações com contrato assinado (status 'aprovada') e nunca dado do
 * proprietário ou comissão. Preço do imóvel e contato do corretor captador aparecem para todos
 * (Denis, 08/10/2026). Quem não é gestor/admin (nem captador/líder da captação) não recebe endereço
 * por escrito, situação nem botão de abrir.
 */
import {
  geoKey,
  SITUATION_COLOR,
  SITUATION_LABEL,
  type Situation,
} from "@/lib/exclusive-captures-dashboard";
import {
  captureValidity,
  validityText,
  type Capture,
  type Validity,
} from "@/lib/exclusive-captures";
import { nomeExibicao } from "@/lib/vendas-por-regiao";
import type { MapPin } from "@/components/mapa/PinsMap";
import { precoTexto, whatsappLink } from "@/lib/mapa-captacoes-filtros";

export type CaptacaoMapaRow = {
  id: string;
  codigo: string;
  tipo_imovel: string | null;
  bairro: string | null;
  cidade: string | null;
  captador: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  /** true = recebe endereço por escrito e situação/vigência. */
  detalhe: boolean;
  /** true = pode abrir a captação (captador, líder da equipe, admin). */
  pode_abrir: boolean;
  endereco: string | null;
  status: string | null;
  signed_on: string | null;
  prazo_dias: string | null;
  /** Só quando pode_abrir: usados para localizar no mapa as captações ainda sem coordenada. */
  estado: string | null;
  geo_key: string | null;
  /** Valor do imóvel informado na captação — para todos (Denis, 08/10/2026). */
  valor_imovel?: string | null;
  /** Contato do CORRETOR captador (nunca do proprietário). */
  captador_id?: string | null;
  captador_telefone?: string | null;
  captador_email?: string | null;
  equipe?: string | null;
};

/** Captação mínima no formato do painel, para reaproveitar geoKey/geoQueries de lá (mesma chave). */
export function comoCapture(r: CaptacaoMapaRow): Capture {
  return {
    id: r.id,
    geo_key: r.geo_key,
    geo_lat: r.geo_lat,
    geo_lon: r.geo_lon,
    form_data: {
      imovel: {
        endereco: r.endereco ?? "",
        bairro: r.bairro ?? "",
        municipio: r.cidade ?? "",
        estado: r.estado ?? "",
      },
    },
  } as unknown as Capture;
}

/** Captações que a pessoa pode abrir, com endereço, ainda sem coordenada (ou com endereço alterado). */
export function captacoesPendentesGeo(rows: CaptacaoMapaRow[]): CaptacaoMapaRow[] {
  return rows.filter((r) => {
    if (!r.pode_abrir || !r.detalhe) return false;
    const k = geoKey(comoCapture(r));
    return k !== "" && r.geo_key !== k;
  });
}

/** Cor única para quem não vê a situação (não dá para deduzir vigência pela cor). */
export const COR_CAPTACAO = "#7c3aed";

function situacao(r: CaptacaoMapaRow, hoje: string): { s: Situation; v: Validity | null } {
  const v = captureValidity(
    {
      signed_on: r.signed_on,
      form_data: { condicoes: { prazo_dias_numero: r.prazo_dias ?? "" } },
    } as Parameters<typeof captureValidity>[0],
    hoje,
  );
  if (r.status === "aprovada") {
    if (!v) return { s: "em_vigor", v };
    return { s: v.daysLeft < 0 ? "vencida" : v.daysLeft <= 30 ? "vencendo" : "em_vigor", v };
  }
  if (r.status === "enviada" || r.status === "em_assinatura") return { s: "em_andamento", v };
  return { s: "rascunho", v };
}

/** Linhas do balão do pino. Sem detalhe: código, tipo, preço, bairro/cidade e contato do captador. */
export function linhasCaptacao(r: CaptacaoMapaRow, hoje: string): MapPin["lines"] {
  const local = [
    r.bairro ? nomeExibicao(r.bairro) : "Sem bairro",
    r.cidade ? nomeExibicao(r.cidade) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const linhas: MapPin["lines"] = [
    { text: `Captação ${r.codigo} · ${r.tipo_imovel || "Imóvel"}`, bold: true },
  ];
  if (r.valor_imovel !== undefined) linhas.push({ text: precoTexto(r.valor_imovel), bold: true });
  if (r.detalhe && r.endereco) linhas.push({ text: r.endereco });
  linhas.push({ text: local });
  linhas.push({ text: `Captador: ${r.captador || "—"}${r.equipe ? ` (${r.equipe})` : ""}` });
  if (r.captador_telefone) linhas.push({ text: `Tel.: ${r.captador_telefone}` });
  if (r.captador_email) linhas.push({ text: `E-mail: ${r.captador_email}` });
  if (r.detalhe) {
    const { s, v } = situacao(r, hoje);
    linhas.push({ text: `${SITUATION_LABEL[s]}${v ? " · " + validityText(v) : ""}` });
  }
  return linhas;
}

/** Botões de contato do corretor captador (WhatsApp e e-mail), quando houver no cadastro. */
export function linksCaptador(r: CaptacaoMapaRow): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  const wa = whatsappLink(r.captador_telefone, r.codigo);
  if (wa) out.push({ text: "WhatsApp do captador", href: wa });
  if (r.captador_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.captador_email))
    out.push({ text: "E-mail", href: `mailto:${r.captador_email}` });
  return out;
}

export function pinosCaptacoes(rows: CaptacaoMapaRow[], hoje: string): MapPin[] {
  const out: MapPin[] = [];
  for (const r of rows) {
    if (r.geo_lat == null || r.geo_lon == null) continue;
    out.push({
      id: r.id,
      lat: r.geo_lat,
      lon: r.geo_lon,
      color: r.detalhe ? SITUATION_COLOR[situacao(r, hoje).s] : COR_CAPTACAO,
      lines: linhasCaptacao(r, hoje),
      links: linksCaptador(r),
      actionLabel: r.pode_abrir ? "Abrir captação →" : undefined,
    });
  }
  return out;
}
