import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ download: vi.fn(), orgPath: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ download: mocks.download }) } },
}));
vi.mock("./storage-org", () => ({ storageOrganizationPath: mocks.orgPath }));

import { downloadCaptureTemplate } from "./exclusive-captures-db";

const blob = (bytes: number[]) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer });
const ORG = "00000000-0000-4000-8000-000000000001";

describe("downloadCaptureTemplate (modelo antigo)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.orgPath.mockImplementation(async (p: string) => `${ORG}/${p}`);
  });

  it("usa o modelo da raiz quando a pasta da organização não tem o arquivo (chamado #1030)", async () => {
    mocks.download.mockImplementation(async (path: string) =>
      path.startsWith(`${ORG}/`)
        ? { data: null, error: { message: "Object not found" } }
        : { data: blob([1, 2, 3]), error: null },
    );
    await expect(downloadCaptureTemplate("barao-de-tatui")).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(mocks.download).toHaveBeenNthCalledWith(1, `${ORG}/barao-de-tatui.pdf`);
    expect(mocks.download).toHaveBeenNthCalledWith(2, "barao-de-tatui.pdf");
  });

  it("prefere o modelo da pasta da organização quando existe", async () => {
    mocks.download.mockResolvedValue({ data: blob([9]), error: null });
    await expect(downloadCaptureTemplate("campolim")).resolves.toEqual(new Uint8Array([9]));
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it("continua falhando quando nenhum dos dois caminhos é legível (RLS de outra organização)", async () => {
    mocks.download.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    await expect(downloadCaptureTemplate("campolim")).rejects.toThrow("Object not found");
  });
});
