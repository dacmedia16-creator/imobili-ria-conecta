import { describe, expect, it } from "vitest";
import { dataAssinaturaClicksign, motivoSemData, textoDoPdf } from "./clicksign-data-assinatura";

// Trechos no formato real do log da Clicksign (nomes fictícios).
const CAB =
  "Datas e horários em GMT -03:00 Brasilia Log gerado em 09 de outubro de 2026. Versão v1.51.0.";
const FIM =
  "09 out 2026, 12:07:00 Processo de assinatura finalizado automaticamente. Motivo: finalização automática após a última assinatura habilitada. Processo de assinatura concluído para o documento número 6931540b. Documento assinado com validade jurídica. Clicksign";

const log = (...linhas: string[]) => [CAB, ...linhas, FIM].join("\n");

describe("data de assinatura lida do PDF da Clicksign", () => {
  it("várias assinaturas: usa a ÚLTIMA (o contrato só vale com todas)", () => {
    const t = log(
      "08 out 2026, 10:28:13 Operador com email op@x.com na Conta 22b9 adicionou à Lista de Assinatura: a@x.com para assinar como contratante, via E-mail.",
      "08 out 2026, 11:27:13 Fulano Corretor assinou como contratada. Pontos de autenticação: Token via E-mail",
      "08 out 2026, 21:26:14 FULANA PROPRIETÁRIA assinou como contratante. Pontos de autenticação: Token",
      "09 out 2026, 12:06:51 Ciclano Gestor assinou como testemunha. Pontos de autenticação: Token via E-mail",
    );
    expect(dataAssinaturaClicksign(t, "2026-10-29")).toEqual({
      ok: true,
      data: "2026-10-09",
      assinaturas: 3,
    });
  });

  it("assinaturas fora de ordem e virada de ano", () => {
    const t = log(
      "02 jan 2026, 09:00:00 B assinou. Pontos de autenticação",
      "30 dez 2025, 18:00:00 A assinou. Pontos de autenticação",
    );
    const r = dataAssinaturaClicksign(t, "2026-10-29");
    expect(r.ok && r.data).toBe("2026-01-02");
  });

  it("página de assinaturas sozinha (Assinou como ... em DD mmm AAAA às HH:MM:SS)", () => {
    const t = [
      CAB,
      "Assinou como contratante em 08 out 2026 às 21:26:14",
      "Assinou como testemunha em 10 out 2026 às 08:00:00",
      FIM,
    ].join("\n");
    const r = dataAssinaturaClicksign(t, "2026-10-29");
    expect(r.ok && r.data).toBe("2026-10-10");
  });

  it("sem página de log da Clicksign => sem data", () => {
    const t =
      "CONTRATO DE EXCLUSIVIDADE. As partes assinam o presente em 03/08/2026. Assinante Fulano fez a leitura e assinatura no documento 20/01/2023 09:39:51";
    const r = dataAssinaturaClicksign(t, "2026-10-29");
    expect(r).toMatchObject({ ok: false, motivo: "sem_clicksign" });
    expect(motivoSemData(r)).toMatch(/Informe a data/);
  });

  it("PDF escaneado (sem texto) => sem data", () => {
    expect(dataAssinaturaClicksign("", "2026-10-29")).toMatchObject({
      ok: false,
      motivo: "sem_texto",
    });
    expect(dataAssinaturaClicksign("  \n \f ", "2026-10-29")).toMatchObject({
      ok: false,
      motivo: "sem_texto",
    });
  });

  it("documento com marca Clicksign mas sem nenhuma assinatura => sem data", () => {
    const t = "Clicksign 052978d0-86bd Conta de Energia Elétrica Data de Emissão: 23/06/2025";
    expect(dataAssinaturaClicksign(t, "2026-10-29")).toMatchObject({
      ok: false,
      motivo: "sem_assinaturas",
    });
  });

  it("envelope expirado por data limite (faltou assinatura) => sem data", () => {
    const t = [
      CAB,
      "24 jun 2025, 16:43:55 A assinou. Pontos de autenticação",
      "26 jun 2025, 15:55:35 B assinou. Pontos de autenticação",
      "23 jul 2025, 16:57:18 Processo de assinatura finalizado automaticamente. Motivo: data limite para assinatura foi atingida. Processo de assinatura concluído para o documento número e412. Clicksign",
    ].join("\n");
    expect(dataAssinaturaClicksign(t, "2026-10-29")).toMatchObject({
      ok: false,
      motivo: "nao_finalizado",
      ultimaVista: "2025-06-26",
    });
  });

  it("envelope ainda em andamento (sem 'processo finalizado') => sem data", () => {
    const t = [CAB, "08 out 2026, 11:27:13 A assinou. Pontos de autenticação Clicksign"].join("\n");
    expect(dataAssinaturaClicksign(t, "2026-10-29")).toMatchObject({
      ok: false,
      motivo: "nao_finalizado",
    });
  });

  it("recusa não conta como assinatura", () => {
    const t = log(
      "08 out 2026, 11:27:13 A assinou. Pontos de autenticação",
      "08 out 2026, 12:00:00 B recusou assinar. Motivo: não assinou",
    );
    const r = dataAssinaturaClicksign(t, "2026-10-29");
    expect(r.ok && r.data).toBe("2026-10-08");
  });

  it("data futura ou impossível é descartada", () => {
    expect(
      dataAssinaturaClicksign(log("05 nov 2026, 10:00:00 A assinou. Pontos"), "2026-10-29"),
    ).toMatchObject({ ok: false, motivo: "data_invalida" });
    expect(
      dataAssinaturaClicksign(log("31 fev 2026, 10:00:00 A assinou. Pontos"), "2026-10-29"),
    ).toMatchObject({ ok: false, motivo: "sem_assinaturas" });
  });

  it("textoDoPdf junta as páginas e quebra linha no fim de cada item", async () => {
    const paginas = [
      [{ str: "Clicksign", hasEOL: true }],
      [{ str: "08 out 2026, 11:27:13 A assinou.", hasEOL: true }, { str: FIM }],
    ];
    const fake = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: async (n: number) => ({
            getTextContent: async () => ({ items: paginas[n - 1] }),
            cleanup: () => {},
          }),
        }),
        destroy: async () => {},
      }),
    };
    const texto = await textoDoPdf(fake, new Uint8Array([1]));
    expect(dataAssinaturaClicksign(texto, "2026-10-29")).toMatchObject({
      ok: true,
      data: "2026-10-08",
    });
  });
});
