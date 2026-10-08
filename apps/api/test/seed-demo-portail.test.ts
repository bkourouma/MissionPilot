import { describe, expect, it } from "vitest";
import { configDemo, emailAbidjan } from "../src/db/seed-demo.js";
import { CLIENT_PORTAIL_DEMO, pdfDemo } from "../src/db/seed-demo-portail.js";
import { detecterType } from "../src/stockage/detection.js";
import { DOMAINE_DEMO } from "../src/routes/connexion-demo.js";

/*
 * Seed du portail de démonstration (db/seed-demo-portail.ts) : le déroulé complet passe par les
 * vraies routes et dure environ une minute (hachage des mots de passe) ; il est vérifié à la main
 * sur une base dédiée (RUNBOOK), pas ici. Ces tests couvrent ce qui est rapide et sans base : le
 * PDF produit passe la détection de contenu du stockage, les gardes du seed, l'alignement avec la
 * connexion rapide.
 */

describe("seed du portail de démonstration", () => {
  it("le PDF produit est valide pour le stockage (type détecté, aucun contenu actif)", () => {
    const pdf = pdfDemo("Livrable (démonstration)", ["Ligne un", "Ligne (deux) \\ trois"]);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(detecterType(pdf, "pdf").type).toBe("application/pdf");
  });

  it("mêmes gardes que le seed de démonstration : jamais en production, base locale, sans SMTP", () => {
    const base = {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://u:p@127.0.0.1:55440/missionpilot_demo",
      DATABASE_OWNER_URL: "postgres://u:p@127.0.0.1:55440/missionpilot_demo",
    };
    expect(() => configDemo({ ...base, NODE_ENV: "production" })).toThrow(/interdit/);
    expect(() => configDemo({ ...base, DATABASE_URL: "postgres://u:p@db.exemple.com/x" })).toThrow(
      /locale/,
    );
    expect(() => configDemo({ ...base, SMTP_HOST: "smtp.exemple.com" })).toThrow(/SMTP_HOST/);
  });

  it("les adresses des comptes du portail sont dans le périmètre de la connexion rapide", () => {
    for (const cle of ["dirigeant.client", "contributeur.client", "investisseur.client"]) {
      expect(emailAbidjan(cle).endsWith(DOMAINE_DEMO)).toBe(true);
    }
    expect(CLIENT_PORTAIL_DEMO).toBe("Cacao Savane Export (fictif)");
  });
});
