import { describe, expect, it } from "vitest";
import { HUB_DESCRIPTION, HUB_DESCRIPTION_MAX, HUB_TITLE, HUB_TITLE_MAX } from "@/lib/seo-publico";

describe("SEO do Hub (t_881aad7e)", () => {
  it("título cabe em 60 caracteres", () => {
    expect(HUB_TITLE.length).toBeLessThanOrEqual(HUB_TITLE_MAX);
  });
  it("descrição cabe em 155 caracteres", () => {
    expect(HUB_DESCRIPTION.length).toBeLessThanOrEqual(HUB_DESCRIPTION_MAX);
  });
  it("usa 'em minutos' (não '5 minutos', decisão de Denis 25/11)", () => {
    expect(HUB_TITLE).toContain("em minutos");
    expect(HUB_DESCRIPTION).toContain("em minutos");
    expect(`${HUB_TITLE} ${HUB_DESCRIPTION}`).not.toMatch(/5 minutos/);
  });
});
