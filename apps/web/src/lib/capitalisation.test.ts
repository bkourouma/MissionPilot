import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminRecherche,
  cheminRetours,
  hrefRetours,
  lireCurseurRetours,
  droitsConnaissances,
  hrefResultat,
  libelleNature,
  libelleNiveauCompetence,
  libelleNiveauEstimation,
  libelleOrigine,
  libelleSection,
  libelleStatutContenu,
  libelleTypeResultat,
  lireCodes,
  lireCompetence,
  lireCritereRecherche,
  lireEstimation,
  lireNiveau,
  lireVersionRetour,
  messageCapitalisation,
  PERMISSIONS_RUBRIQUE,
  segmentsSurlignes,
  sousPagesConnaissances,
  tonaliteStatutRetour,
} from "./capitalisation";

describe("rubrique Connaissances : sous-pages et droits", () => {
  it("consultant : recherche, retours, estimation, compétences ; pas le comité méthode", () => {
    expect(sousPagesConnaissances(["consultant"]).map((p) => p.id)).toEqual([
      "recherche",
      "retours",
      "estimation",
      "competences",
    ]);
    expect(sousPagesConnaissances(["expert_metier"]).map((p) => p.id)).toContain("derogations");
    // Estimation : des jours, donc budget.lire_jours en plus (l'expert métier ne l'a pas).
    expect(sousPagesConnaissances(["expert_metier"]).map((p) => p.id)).not.toContain("estimation");
    expect(sousPagesConnaissances(["chef_mission"]).map((p) => p.id)).toContain("estimation");
    expect(sousPagesConnaissances(["gestionnaire"]).map((p) => p.id)).toEqual(["competences"]);
    // La rubrique ne s'ouvre plus par `collaborateurs.lire` (chef, gestionnaire) : la matrice de
    // tous exige `competence.lire`.
    expect(PERMISSIONS_RUBRIQUE).not.toContain("collaborateurs.lire");
    expect(droitsConnaissances(["gestionnaire"]).matrice).toBe(false);
    expect(droitsConnaissances(["chef_mission"]).matrice).toBe(false);
    expect(droitsConnaissances(["ressources"])).toMatchObject({
      lire: false,
      matrice: true,
      matriceJours: true,
      gererCompetences: true,
      comiteMethode: false,
    });
    expect(droitsConnaissances(["chef_mission"])).toMatchObject({
      lire: true,
      rediger: true,
      ia: true,
    });
  });
});

describe("recherche", () => {
  it("surligne les mots de la requête sans accents ni casse, en segments de texte", () => {
    expect(segmentsSurlignes("Plan stratégique Kora", "strategique")).toEqual([
      { texte: "Plan ", surligne: false },
      { texte: "stratégique", surligne: true },
      { texte: " Kora", surligne: false },
    ]);
    expect(segmentsSurlignes("Relances clients", "relance CLIENT")).toEqual([
      { texte: "Relances", surligne: true },
      { texte: " ", surligne: false },
      { texte: "clients", surligne: true },
    ]);
    expect(segmentsSurlignes("Texte", "")).toEqual([{ texte: "Texte", surligne: false }]);
    expect(segmentsSurlignes("", "kora")).toEqual([]);
    expect(segmentsSurlignes("<b>kora</b>", "kora")[1]).toEqual({ texte: "kora", surligne: true });
  });

  it("liens et critères", () => {
    expect(hrefResultat({ type: "connaissance", id: "r1", mission_id: "m1" })).toBe(
      "/connaissances/retours/r1",
    );
    expect(hrefResultat({ type: "preuve", id: "p1", mission_id: "m1" })).toBe("/missions/m1");
    // Un rapport mène à l'onglet « Rapports » de sa mission, pas à la fiche mission.
    expect(hrefResultat({ type: "rapport", id: "r1", mission_id: "m1" })).toBe(
      "/missions/m1/rapports",
    );
    expect(hrefResultat({ type: "rapport", id: "r1", mission_id: "m 1" })).toBe(
      "/missions/m%201/rapports",
    );
    expect(lireCritereRecherche({ q: " k ", types: "mission,inconnu" })).toEqual({
      q: "",
      types: ["mission"],
    });
    expect(lireCritereRecherche({ q: ["a", "b"] })).toEqual({ q: "", types: [] });
    expect(lireCritereRecherche({ q: "ab", types: ["preuve", "mission"] }).types).toEqual([
      "mission",
      "preuve",
    ]);
    const c = lireCritereRecherche({ q: "atelier unique", types: "preuve" });
    expect(cheminRecherche(c)).toBe(
      "/api/capitalisation/recherche?q=atelier+unique&limite=10&types=preuve",
    );
    expect(cheminRecherche({ q: "ab", types: [] }, 5)).toBe(
      "/api/capitalisation/recherche?q=ab&limite=5",
    );
  });
});

describe("pagination des retours", () => {
  it("curseur borné, chemins", () => {
    expect(lireCurseurRetours("abc")).toBe("abc");
    expect(lireCurseurRetours(["a"])).toBeNull();
    expect(lireCurseurRetours("x".repeat(501))).toBeNull();
    expect(cheminRetours(null)).toBe("/api/capitalisation/retours?limite=30");
    expect(cheminRetours("c=1", 5)).toBe("/api/capitalisation/retours?limite=5&curseur=c%3D1");
    expect(hrefRetours(null)).toBe("/connaissances/retours");
    expect(hrefRetours("a b")).toBe("/connaissances/retours?curseur=a%20b");
  });
});

describe("libellés", () => {
  it("couvre les valeurs de l'API", () => {
    expect(libelleTypeResultat("connaissance")).toBe("Retour d'expérience");
    expect(libelleOrigine("gabarit")).toBe("Brouillon automatique");
    expect(libelleStatutContenu("valide")).toBe("Validé");
    expect(tonaliteStatutRetour("valide")).toBe("succes");
    expect(tonaliteStatutRetour("brouillon")).toBe("attention");
    expect(libelleSection("lecons")).toBe("Leçons");
    expect(libelleNiveauEstimation("insuffisant")).toBe("Historique insuffisant");
    expect(libelleNature("retirer_brique")).toBe("Retrait");
    expect(libelleNature("autre")).toBe("autre");
    expect(libelleNiveauCompetence(3)).toBe("3 · Maîtrise");
    expect(libelleNiveauCompetence(null)).toBe("—");
  });
});

describe("lecture des saisies", () => {
  it("version du retour : quatre sections obligatoires", () => {
    const r = lireVersionRetour({ contexte: " a ", methode: "b", ecarts: "", lecons: "d" });
    expect(r).toEqual({ ok: false, erreurs: { ecarts: "Cette section est obligatoire." } });
    const long = lireVersionRetour({
      contexte: "x".repeat(8001),
      methode: "b",
      ecarts: "c",
      lecons: "d",
    });
    expect(long.ok).toBe(false);
    expect(lireVersionRetour({ contexte: " a ", methode: "b", ecarts: "c", lecons: "d" })).toEqual({
      ok: true,
      charge: { contexte: "a", methode: "b", ecarts: "c", lecons: "d" },
    });
  });

  it("codes, estimation, compétence, niveau", () => {
    expect(lireCodes("a, b ; a  C")).toEqual({ codes: ["a", "b"], invalides: ["C"] });
    expect(lireEstimation({ briques: "", effectif: "" }).ok).toBe(false);
    expect(lireEstimation({ briques: "X", effectif: "" }).ok).toBe(false);
    for (const n of ["1", "2", "21"]) {
      expect(lireEstimation({ briques: "a", effectif: n })).toEqual({
        ok: false,
        erreurs: { effectif: "Un entier de 3 à 20." },
      });
    }
    expect(lireEstimation({ briques: "a b", effectif: "4" })).toEqual({
      ok: true,
      charge: { briques: ["a", "b"], effectif_minimum: 4 },
    });
    expect(lireEstimation({ briques: "a", effectif: " " })).toEqual({
      ok: true,
      charge: { briques: ["a"] },
    });
    expect(
      lireEstimation({
        briques: Array.from({ length: 101 }, (_, i) => `b${i}`).join(","),
        effectif: "",
      }).ok,
    ).toBe(false);
    expect(lireCompetence({ code: "Mauvais", libelle: "", briques: "OK" }).ok).toBe(false);
    expect(lireCompetence({ code: "entretiens", libelle: "Entretiens", briques: "a,b" })).toEqual({
      ok: true,
      charge: { code: "entretiens", libelle: "Entretiens", briques: ["a", "b"] },
    });
    expect(
      lireCompetence({
        code: "c",
        libelle: "L",
        briques: Array.from({ length: 51 }, (_, i) => `b${i}`).join(","),
      }).ok,
    ).toBe(false);
    expect(lireNiveau("3")).toEqual({ ok: true, charge: { niveau: 3 } });
    expect(lireNiveau("5").ok).toBe(false);
  });

  it("messages d'erreur propres au lot", () => {
    expect(messageCapitalisation(new ErreurApi("RETOUR_VALIDE", "x", 409))).toContain("validé");
    for (const code of [
      "DECLARATION_EN_ATTENTE",
      "PLAFOND_DECLARATIONS",
      "VALIDATION_RESERVEE",
      "TROP_DE_RECHERCHES",
    ]) {
      expect(messageCapitalisation(new ErreurApi(code, "x", 409))).not.toBe("x");
    }
    expect(messageCapitalisation(new ErreurApi("AUTRE", "Message de l'API", 409))).toBe(
      "Message de l'API",
    );
  });
});
