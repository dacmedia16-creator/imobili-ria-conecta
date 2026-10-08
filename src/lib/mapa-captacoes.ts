/**
 * Mapa das captações no topo de "Vendas por região". Os dados vêm de mapa_captacoes(), que já corta
 * no banco o que cada perfil pode ver: nunca há dado do proprietário, valor do imóvel ou comissão.
 * Quem não é gestor/admin (nem captador/líder da captação) recebe só código, tipo, bairro, cidade,
 * captador e uma localização aproximada (~100 m).
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

export type CaptacaoMapaRow = {
  id: string;
  codigo: string;
  tipo_imovel: string | null;
  bairro: string | null;
  cidade: string | null;
  captador: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  /** true = recebe endereço, situação e localização exata. */
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

/** Linhas do balão do pino. Sem detalhe: código, tipo, bairro/cidade e captador — nada além. */
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
  if (r.detalhe && r.endereco) linhas.push({ text: r.endereco });
  linhas.push({ text: local });
  linhas.push({ text: `Captador: ${r.captador || "—"}` });
  if (r.detalhe) {
    const { s, v } = situacao(r, hoje);
    linhas.push({ text: `${SITUATION_LABEL[s]}${v ? " · " + validityText(v) : ""}` });
  } else {
    linhas.push({ text: "Localização aproximada" });
  }
  return linhas;
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
      actionLabel: r.pode_abrir ? "Abrir captação →" : undefined,
    });
  }
  return out;
}
