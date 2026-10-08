import { describe, expect, it } from "vitest";
import { ErreurApi } from "../../lib/api";
import { MESSAGE_LIMITE_RAPPORTS } from "../../lib/rapports";
import {
  cheminGenerationLivrable,
  cheminListeLivrables,
  estFormatLivrable,
  hrefFacturePdf,
  libelleFormatLivrable,
  libelleStatutLivrable,
  LIVRABLES_AFFICHES,
  messageLivrable,
  messageLivrableCree,
  type LivrableCree,
} from "./livrables";

const ID = "3f2c9a4e-8d1b-4c6a-9e0f-1a2b3c4d5e6f";

describe("chemins des rapports de service", () => {
  it("génération : format, version entière positive seulement, identifiant encodé", () => {
    expect(cheminGenerationLivrable("notation", ID, "pdf")).toBe(
      `/api/notations/${ID}/rapports?format=pdf`,
    );
    expect(cheminGenerationLivrable("plan", ID, "docx", 3)).toBe(
      `/api/plans/${ID}/rapports?format=docx&version=3`,
    );
    for (const v of [0, -1, 1.5, Number.NaN, null, undefined]) {
      expect(cheminGenerationLivrable("plan", ID, "pdf", v)).toBe(
        `/api/plans/${ID}/rapports?format=pdf`,
      );
    }
    expect(cheminGenerationLivrable("plan", "a/../b", "pdf")).toBe(
      "/api/plans/a%2F..%2Fb/rapports?format=pdf",
    );
  });

  it("liste et PDF de facture", () => {
    expect(cheminListeLivrables("notation", ID)).toBe(
      `/api/notations/${ID}/rapports?limite=${LIVRABLES_AFFICHES}`,
    );
    expect(cheminListeLivrables("plan", ID)).toContain(`/api/plans/${ID}/rapports`);
    expect(hrefFacturePdf("x y")).toBe("/api/factures/x%20y/pdf");
  });
});

describe("libellés", () => {
  it("formats et statuts, repli neutre", () => {
    expect(estFormatLivrable("pdf")).toBe(true);
    expect(estFormatLivrable("pptx")).toBe(false);
    expect(libelleFormatLivrable("docx")).toBe("Word (.docx)");
    expect(libelleFormatLivrable("xls")).toBe("Fichier");
    expect(libelleStatutLivrable("valide")).toBe("Validé");
    expect(libelleStatutLivrable("brouillon")).toBe("Brouillon");
    expect(libelleStatutLivrable("autre")).toBe("Statut non reconnu");
  });

  it("succès : statut validé ou brouillon annoncé", () => {
    const cree = (statut: string, format = "pdf") =>
      ({ rapport: { statut, format }, fichier: {} }) as unknown as LivrableCree;
    expect(messageLivrableCree("notation", cree("valide"))).toBe(
      "Rapport de notation au format PDF, au statut « Validé ».",
    );
    expect(messageLivrableCree("plan", cree("brouillon", "docx"))).toContain("« Brouillon »");
  });
});

describe("erreurs de génération", () => {
  const e = (code: string, statut: number) => new ErreurApi(code, "x", statut);

  it("notation non publiée, droits, introuvable, puis messages communs", () => {
    expect(messageLivrable("notation", e("NOTATION_NON_PUBLIEE", 409))).toContain("publiée");
    expect(messageLivrable("notation", e("INTERDIT", 403))).toContain("cette notation");
    expect(messageLivrable("plan", e("INTERDIT", 403))).toContain("ce plan");
    expect(messageLivrable("plan", e("INTROUVABLE", 404))).toContain("modèle");
    expect(messageLivrable("plan", e("TROP_DE_RAPPORTS", 429))).toBe(MESSAGE_LIMITE_RAPPORTS);
    expect(messageLivrable("notation", e("RENDU_OCCUPE", 503))).toContain("rendu");
  });
});
