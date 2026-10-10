import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  analyserImportCsv,
  CHEMIN_PERSONNES_ASSIGNABLES,
  cellulesCsv,
  cheminFiches,
  droitsAppelsOffres,
  estOuverte,
  formaterPointsDeBase,
  hrefAppelsOffres,
  hrefFiche,
  hrefGoNoGo,
  hrefMatrice,
  hrefRetroplanning,
  libelleCategorie,
  libelleConformite,
  libelleRecommandation,
  libelleStatutAo,
  lireFiltresAo,
  messageAo,
  pourCentVersPointsDeBase,
  regrouperParStatut,
  SAISIE_EVALUATION_VIDE,
  SAISIE_FICHE_VIDE,
  statutsManuels,
  texteAlerte,
  texteJoursRestants,
  tonaliteAlerte,
  tonaliteConformite,
  tonaliteRecommandation,
  tonaliteStatutAo,
  validerEvaluation,
  validerExigence,
  validerFiche,
  validerMotif,
  validerTexteDossier,
  type FicheAo,
} from "./appels-offres";

describe("droits d'affichage", () => {
  it("associé : tout ; chef : gère et confie ; gestionnaire : lit avec la marge ; ressources : rien", () => {
    expect(droitsAppelsOffres(["associe"])).toEqual({
      lire: true,
      gerer: true,
      decider: true,
      finance: true,
      assigner: true,
      ia: true,
    });
    expect(droitsAppelsOffres(["chef_mission"])).toMatchObject({
      gerer: true,
      decider: false,
      finance: false,
      assigner: true,
    });
    expect(droitsAppelsOffres(["gestionnaire"])).toMatchObject({
      lire: true,
      gerer: false,
      finance: true,
    });
    expect(droitsAppelsOffres(["ressources"]).lire).toBe(false);
  });
});

describe("libellés, tonalités, chemins", () => {
  it("libellés et tonalités", () => {
    expect(libelleStatutAo("go_no_go")).toBe("Go/no-go");
    expect(
      ["gagne", "perdu", "go_no_go", "detecte"].map((s) => tonaliteStatutAo(s as never)),
    ).toEqual(["succes", "danger", "attention", "neutre"]);
    expect(libelleRecommandation("a_examiner")).toBe("À examiner");
    expect(["go", "no_go", "a_examiner"].map((r) => tonaliteRecommandation(r as never))).toEqual([
      "succes",
      "danger",
      "attention",
    ]);
    expect(libelleConformite("sans_objet")).toBe("Sans objet");
    expect(
      ["conforme", "non_conforme", "partiel", "a_traiter"].map((s) =>
        tonaliteConformite(s as never),
      ),
    ).toEqual(["succes", "danger", "attention", "neutre"]);
    expect(libelleCategorie("personnel")).toBe("Personnel clé");
    expect(tonaliteAlerte(1)).toBe("danger");
    expect(tonaliteAlerte(5)).toBe("attention");
  });

  it("jours restants et alertes", () => {
    expect([0, 1, 4, -1, -3].map(texteJoursRestants)).toEqual([
      "aujourd'hui",
      "demain",
      "dans 4 jours",
      "dépassée d'un jour",
      "dépassée de 3 jours",
    ]);
    expect(texteAlerte({ type: "date_limite", joursRestants: 2 })).toBe("Date limite dans 2 jours");
    expect(texteAlerte({ type: "etape_du_jour", joursRestants: 0, etapeLibelle: "Dépôt" })).toBe(
      "Dépôt : prévue aujourd'hui",
    );
    expect(texteAlerte({ type: "etape_en_retard", joursRestants: -2 })).toBe(
      "Étape : en retard (dépassée de 2 jours)",
    );
  });

  it("filtres et chemins", () => {
    expect(lireFiltresAo({ statut: "depose", q: ["  santé ", "x"], curseur: "abc_-1" })).toEqual({
      statut: "depose",
      q: "santé",
      curseur: "abc_-1",
    });
    expect(lireFiltresAo({ statut: "inconnu", curseur: "<script>" })).toEqual({
      statut: "",
      q: "",
      curseur: "",
    });
    expect(cheminFiches({ statut: "detecte", q: "a b", curseur: "c" })).toBe(
      "/api/appels-offres?limite=50&statut=detecte&q=a+b&curseur=c",
    );
    expect(hrefAppelsOffres()).toBe("/appels-offres");
    expect(hrefAppelsOffres({ statut: "gagne", q: "x", curseur: "y" })).toBe(
      "/appels-offres?statut=gagne&q=x&curseur=y",
    );
    expect(hrefFiche("a/b")).toBe("/appels-offres/a%2Fb");
    expect(hrefGoNoGo("1")).toBe("/appels-offres/1/go-no-go");
    expect(hrefMatrice("1")).toBe("/appels-offres/1/matrice");
    expect(hrefRetroplanning("1")).toBe("/appels-offres/1/retroplanning");
    // Liste dédiée (utilisateurs avec ao.lire) : ne dépend plus de la pagination des collaborateurs.
    expect(CHEMIN_PERSONNES_ASSIGNABLES).toBe("/api/appels-offres/assignables");
  });

  it("pipeline par statut, statuts manuels, fiche ouverte", () => {
    const f = (id: string, statut: string) => ({ id, statut }) as unknown as FicheAo;
    const g = regrouperParStatut([f("1", "depose"), f("2", "detecte"), f("3", "depose")]);
    expect(g.map((c) => c.statut)[0]).toBe("detecte");
    expect(g.find((c) => c.statut === "depose")?.fiches.map((x) => x.id)).toEqual(["1", "3"]);
    expect(statutsManuels("en_reponse")).toEqual(["depose"]);
    expect(statutsManuels("depose")).toEqual(["gagne", "perdu"]);
    expect(statutsManuels("detecte")).toEqual([]);
    expect(estOuverte("en_reponse")).toBe(true);
    expect(estOuverte("no_go")).toBe(false);
  });

  it("messages d'erreur", () => {
    expect(messageAo(new ErreurApi("AO_MATRICE_NON_CONFORME", "Dépôt refusé.", 409))).toBe(
      "Dépôt refusé.",
    );
    expect(messageAo(new ErreurApi("INTROUVABLE", "x", 404))).toBe(
      "Cet appel d'offres n'existe pas ou plus.",
    );
    expect(messageAo(new ErreurApi("CONFLIT", "Conflit.", 409))).toBe("Conflit.");
    expect(typeof messageAo(new Error("x"))).toBe("string");
  });
});

describe("saisies", () => {
  it("fiche : corps nettoyé, montant en unités mineures, mots-clés découpés", () => {
    const r = validerFiche({
      ...SAISIE_FICHE_VIDE,
      titre: "  Audit  ",
      pays: "ci",
      montant: "1 500 000",
      date_limite: "2026-12-01",
      mots_cles: "gouvernance | risques, gouvernance",
      url: "https://avis.test/1",
    });
    expect(r).toEqual({
      ok: true,
      charge: {
        reference: null,
        titre: "Audit",
        objet: null,
        bailleur: null,
        pays: "CI",
        secteur: null,
        montant_estime: 1_500_000,
        devise: "XOF",
        date_limite: "2026-12-01",
        url: "https://avis.test/1",
        mots_cles: ["gouvernance", "risques"],
      },
    });
    const ko = validerFiche({
      ...SAISIE_FICHE_VIDE,
      pays: "CIV",
      montant: "abc",
      date_limite: "01/12/2026",
      url: "javascript:alert(1)",
    });
    expect(ko.ok).toBe(false);
    if (!ko.ok) {
      expect(Object.keys(ko.erreurs).sort()).toEqual([
        "date_limite",
        "montant",
        "pays",
        "titre",
        "url",
      ]);
    }
    expect(validerFiche({ ...SAISIE_FICHE_VIDE, titre: "x".repeat(301) }).ok).toBe(false);
  });

  it("CSV : cellules entre guillemets, séparateur détecté, erreurs par ligne", () => {
    expect(cellulesCsv('a;"b;c";"d ""e"""', ";")).toEqual(["a", "b;c", 'd "e"']);
    const r = analyserImportCsv(
      [
        "\uFEFFRéférence;Titre;Bailleur;Pays;Montant;Date_limite;Mots_cles",
        "AO-1;Audit santé;BAD;sn;2 000 000;2026-12-31;santé|audit",
        "",
        "AO-2;;BAD;SN;;;",
        "AO-3;Étude;KfW;SN;;2026-13-45;",
      ].join("\r\n"),
    );
    expect(r.fiches).toHaveLength(1);
    expect(r.fiches[0]).toMatchObject({
      reference: "AO-1",
      titre: "Audit santé",
      pays: "SN",
      montant_estime: 2_000_000,
      mots_cles: ["santé", "audit"],
    });
    expect(r.erreurs.map((e) => e.ligne)).toEqual([4, 5]);
    const virgules = analyserImportCsv("titre,bailleur\nAudit,BM");
    expect(virgules.fiches[0]).toMatchObject({ titre: "Audit", bailleur: "BM" });
    expect(analyserImportCsv("reference;bailleur\nx;y").erreurs[0]?.ligne).toBe(1);
    const trop = analyserImportCsv(
      ["titre", ...Array.from({ length: 201 }, (_, i) => `T${i}`)].join("\n"),
    );
    expect(trop.fiches).toHaveLength(200);
    expect(trop.erreurs[0]?.message).toMatch(/200/);
  });

  it("pourcentages en points de base, sans flottant", () => {
    expect(["", "15", "15,5", "-2,25", "0,07", "100 %"].map(pourCentVersPointsDeBase)).toEqual([
      null,
      1500,
      1550,
      -225,
      7,
      10000,
    ]);
    expect(Number.isNaN(pourCentVersPointsDeBase("1,234"))).toBe(true);
    expect(Number.isNaN(pourCentVersPointsDeBase("abc"))).toBe(true);
    expect([1550, -225, 7, 2000, null].map(formaterPointsDeBase)).toEqual([
      "15,5 %",
      "−2,25 %",
      "0,07 %",
      "20 %",
      "—",
    ]);
  });

  it("évaluation : entiers bornés, marge seulement avec finance.lire", () => {
    const s = {
      ...SAISIE_EVALUATION_VIDE,
      jours_disponibles: "30",
      jours_requis: "40",
      marge: "15",
      concurrents_connus: "2",
      concurrents_forts: "1",
    };
    expect(validerEvaluation(s, false)).toEqual({
      ok: true,
      charge: {
        references_exigees: 0,
        jours_disponibles: 30,
        jours_requis: 40,
        concurrents_connus: 2,
        concurrents_forts: 1,
      },
    });
    const f = validerEvaluation({ ...s, adequation: "70" }, true);
    expect(f.ok && f.charge).toMatchObject({
      adequation: 70,
      marge_estimee_bp: 1500,
      marge_cible_bp: 2000,
    });
    const ko = validerEvaluation(
      {
        ...s,
        jours_requis: "",
        adequation: "101",
        concurrents_forts: "3",
        marge: "200",
        marge_cible: "0",
      },
      true,
    );
    expect(ko.ok).toBe(false);
    if (!ko.ok) {
      expect(Object.keys(ko.erreurs).sort()).toEqual([
        "adequation",
        "concurrents_forts",
        "jours_requis",
        "marge",
        "marge_cible",
      ]);
    }
    expect(validerEvaluation({ ...s, jours_disponibles: "2,5" }, false).ok).toBe(false);
  });

  it("motif, dossier, exigence", () => {
    expect(validerMotif("court").ok).toBe(false);
    expect(validerMotif("x".repeat(2001)).ok).toBe(false);
    expect(validerMotif("  Motif suffisant  ")).toEqual({ ok: true, charge: "Motif suffisant" });
    expect(validerTexteDossier("trop court").ok).toBe(false);
    expect(validerTexteDossier("x".repeat(200_001)).ok).toBe(false);
    expect(validerTexteDossier("x".repeat(60)).ok).toBe(true);
    expect(
      validerExigence({
        libelle: " Caution ",
        categorie: "administrative",
        obligatoire: true,
        reference: "",
      }),
    ).toEqual({
      ok: true,
      charge: {
        libelle: "Caution",
        categorie: "administrative",
        obligatoire: true,
        reference: null,
      },
    });
    const ko = validerExigence({
      libelle: "",
      categorie: "x",
      obligatoire: false,
      reference: "r".repeat(61),
    });
    expect(ko.ok).toBe(false);
    if (!ko.ok)
      expect(Object.keys(ko.erreurs).sort()).toEqual(["categorie", "libelle", "reference"]);
    expect(
      validerExigence({
        libelle: "x".repeat(1001),
        categorie: "autre",
        obligatoire: true,
        reference: "",
      }).ok,
    ).toBe(false);
  });
});
