import { describe, expect, it } from "vitest";
import { entetesDocumentSignature } from "../src/routes/signatures.js";

describe("en-têtes de lecture du document de signature (inline pour un PDF)", () => {
  it("PDF : inline, CSP sans sandbox, nosniff, no-store, pas de référent", () => {
    const h = entetesDocumentSignature({
      nom: "Lettre de mission.pdf",
      type_mime: "application/pdf",
      taille: 1234,
    });
    expect(h["Content-Type"]).toBe("application/pdf");
    expect(h["Content-Length"]).toBe("1234");
    expect(h["Content-Disposition"]).toMatch(/^inline; filename="Lettre de mission\.pdf"/);
    expect(h["Content-Security-Policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).not.toContain("sandbox");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Cache-Control"]).toBe("private, no-store");
  });

  it("autre type : pièce jointe sous CSP sandbox, nosniff et no-store conservés", () => {
    const h = entetesDocumentSignature({
      nom: "document.bin",
      type_mime: "application/octet-stream",
      taille: "10",
    });
    expect(h["Content-Disposition"]).toMatch(/^attachment; /);
    expect(h["Content-Security-Policy"]).toBe("sandbox; default-src 'none'");
    expect(h["Content-Type"]).toBe("application/octet-stream");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Cache-Control"]).toBe("private, no-store");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
  });
});
