import { describe, expect, it } from "vitest";
import { visibleOccurrenceCommissions } from "./occurrence-commissions";

type Row = {
  id: string;
  papel: string;
  valor: number;
  managed_by_sale: boolean;
  sale_commission_extra_id: string | null;
};

describe("visibleOccurrenceCommissions", () => {
  it("oculta linhas fixas legadas quando já existe uma linha sincronizada do mesmo papel", () => {
    const rows: Row[] = [
      {
        id: "captador-legado",
        papel: "corretor_captador",
        valor: 5332.5,
        managed_by_sale: false,
        sale_commission_extra_id: null,
      },
      {
        id: "captador-atual",
        papel: "corretor_captador",
        valor: 4740,
        managed_by_sale: true,
        sale_commission_extra_id: null,
      },
      {
        id: "lider-legado-1",
        papel: "lider_vendedor",
        valor: 2370,
        managed_by_sale: false,
        sale_commission_extra_id: null,
      },
      {
        id: "lider-legado-2",
        papel: "lider_vendedor",
        valor: 592.5,
        managed_by_sale: false,
        sale_commission_extra_id: null,
      },
      {
        id: "lider-atual",
        papel: "lider_vendedor",
        valor: 2370,
        managed_by_sale: true,
        sale_commission_extra_id: null,
      },
    ];

    expect(visibleOccurrenceCommissions(rows).map((row) => row.id)).toEqual([
      "captador-atual",
      "lider-atual",
    ]);
  });

  it("preserva comissões extras e papéis sem substituto sincronizado", () => {
    const rows: Row[] = [
      {
        id: "extra-vendedor",
        papel: "corretor_vendedor",
        valor: 1000,
        managed_by_sale: false,
        sale_commission_extra_id: "extra-1",
      },
      {
        id: "outro-legado-valido",
        papel: "outro",
        valor: 500,
        managed_by_sale: false,
        sale_commission_extra_id: null,
      },
      {
        id: "vendedor-atual",
        papel: "corretor_vendedor",
        valor: 4740,
        managed_by_sale: true,
        sale_commission_extra_id: null,
      },
    ];

    expect(visibleOccurrenceCommissions(rows).map((row) => row.id)).toEqual([
      "extra-vendedor",
      "outro-legado-valido",
      "vendedor-atual",
    ]);
  });
});
