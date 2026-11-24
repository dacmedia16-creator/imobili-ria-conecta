// t_b3a9ed4f — remover proprietário que já tem documentos. Dados 100% fictícios.
import { describe, expect, it } from "vitest";
import {
  canRemoveOwner,
  captureOwners,
  emptyForm,
  emptyOwner,
  ownerRemovalDocs,
  ownerRemovalMessage,
  withOwners,
  type CaptureDocument,
} from "./exclusive-captures";

const formWith = (n: number) =>
  withOwners(
    emptyForm(),
    Array.from({ length: n }, (_, i) => ({ ...emptyOwner(), nome_completo: `Dono ${i + 1}` })),
  );
const doc = (kind: CaptureDocument["kind"], owner_index: number): CaptureDocument => ({
  id: `${kind}-${owner_index}`,
  capture_id: "c",
  kind,
  owner_index,
  storage_path: `p/${kind}-${owner_index}.pdf`,
  file_name: `${kind}-${owner_index}.pdf`,
});

describe("remover proprietário com documentos (t_b3a9ed4f)", () => {
  it("libera a lixeira do proprietário do meio mesmo com documentos dele e dos seguintes", () => {
    const f = formWith(4);
    const docs = [doc("cnh", 2), doc("rg", 3), doc("cpf", 3), doc("cnh", 4)];
    expect(canRemoveOwner(f, docs, 2).ok).toBe(true);
    expect(canRemoveOwner(f, docs, 3).ok).toBe(true);
    // O 1º continua obrigatório.
    expect(canRemoveOwner(f, docs, 1).ok).toBe(false);
  });

  it("remove o 2º: docs dele saem e os dos seguintes sobem 1 número sem trocar de pessoa", () => {
    const docs = [
      doc("matricula", 0),
      doc("residencia", 0),
      doc("cnh", 1),
      doc("cnh", 2),
      doc("residencia", 2),
      doc("rg", 3),
      doc("cpf", 3),
      doc("cnh", 4),
    ];
    const r = ownerRemovalDocs(docs, 2);
    expect(r.removed.map((d) => d.id).sort()).toEqual(["cnh-2", "residencia-2"]);
    // Cada documento segue o mesmo arquivo (mesma pessoa), só com o número novo.
    const byPath = new Map(r.kept.map((d) => [d.storage_path, d.owner_index]));
    expect(byPath.get("p/matricula-0.pdf")).toBe(0);
    expect(byPath.get("p/residencia-0.pdf")).toBe(0);
    expect(byPath.get("p/cnh-1.pdf")).toBe(1);
    expect(byPath.get("p/rg-3.pdf")).toBe(2);
    expect(byPath.get("p/cpf-3.pdf")).toBe(2);
    expect(byPath.get("p/cnh-4.pdf")).toBe(3);
    expect(r.kept).toHaveLength(6);
  });

  it("formulário e documentos continuam alinhados depois da remoção", () => {
    const f = formWith(4);
    const owners = captureOwners(f).filter((_, i) => i !== 1);
    const r = ownerRemovalDocs([doc("cnh", 3), doc("cnh", 4)], 2);
    // O antigo 3º (Dono 3) vira o 2º e o documento dele também vira owner_index 2.
    expect(owners[1].nome_completo).toBe("Dono 3");
    expect(r.kept.find((d) => d.storage_path === "p/cnh-3.pdf")?.owner_index).toBe(2);
    expect(owners[2].nome_completo).toBe("Dono 4");
    expect(r.kept.find((d) => d.storage_path === "p/cnh-4.pdf")?.owner_index).toBe(3);
  });

  it("confirmação avisa que os documentos dele também serão excluídos", () => {
    expect(ownerRemovalMessage([doc("cnh", 3)], 3)).toBe(
      "Remover o proprietário 3? Os documentos anexados dele também serão excluídos.",
    );
    expect(ownerRemovalMessage([doc("cnh", 4)], 3)).toBe("Remover o proprietário 3?");
  });
});
