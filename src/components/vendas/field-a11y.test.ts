import { describe, it, expect } from "vitest";
import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Field } from "@/components/vendas/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";

describe("Field liga o rótulo ao campo (acessibilidade)", () => {
  it("input, textarea e select recebem aria-labelledby; aria-label manual é preservado", () => {
    const html = renderToStaticMarkup(
      h(
        Fragment,
        null,
        h(Field, { label: "Matrícula" }, h(Input)),
        h(Field, { label: "Obs" }, h(Textarea)),
        h(Field, { label: "Mídia" }, h(Select, null, h(SelectTrigger, null, h(SelectValue)))),
        h(Input),
        h(Field, { label: "X" }, h(Input, { "aria-label": "Manual" })),
      ),
    );
    const ids = [...html.matchAll(/<label[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(4);
    expect(html).toContain(`<input aria-labelledby="${ids[0]}"`);
    expect(html).toContain(`<textarea aria-labelledby="${ids[1]}"`);
    expect(html).toContain(`aria-labelledby="${ids[2]} `);
    expect(html).toContain('aria-label="Manual"');
    expect((html.match(/aria-labelledby/g) || []).length).toBe(3);
  });
});
