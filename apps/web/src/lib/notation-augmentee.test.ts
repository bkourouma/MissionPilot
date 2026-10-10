import { describe, expect, it } from "vitest";
import type { ItemBanqueDonnees, Role } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  AIDE_ANCRAGES_LONGUEUR_MAX,
  ANCRAGE_LONGUEUR_MAX,
  CAPACITE_DEFAUT,
  FORMULATION_LONGUEUR_MAX,
  anomaliesErreur,
  cheminBanque,
  cheminCalibration,
  cheminCalibrations,
  cheminCloture,
  cheminConfiance,
  cheminCotations,
  cheminExplication,
  cheminItemBanque,
  cheminPropositionPlan,
  cheminValiderItem,
  codeCas,
  compteurCaracteres,
  droitsCalibration,
  droitsItemBanque,
  droitsParametres,
  etatNotationAugmenteeChange,
  formaterPointsSignes,
  formaterRatio,
  formaterSeuil,
  hrefAnalyseNotation,
  hrefCalibration,
  hrefItemBanque,
  hrefNouvelleVersionItem,
  libelleAccord,
  libelleCheminAnomalie,
  lireCapacite,
  lireCible,
  lireStatutBanque,
  messageNotationAugmentee,
  niveauxEchelle,
  phraseBiais,
  phraseSimulation,
  saisieCalibrationVide,
  saisieDepuisItem,
  saisieItemVide,
  saisieParametres,
  validerCapacite,
  validerConclusion,
  validerCotation,
  validerParametres,
  validerSaisieCalibration,
  validerSaisieItem,
  type SaisieItemBanque,
  type SimulationPassage,
} from "./notation-augmentee";

describe("notation augmentée : chemins et paramètres", () => {
  it("construit les chemins de l'API et de la page d'analyse", () => {
    expect(cheminConfiance("n/1", 2)).toBe("/api/notations/n%2F1/confiance?version=2");
    expect(cheminExplication("n", 1, null)).toBe("/api/notations/n/explication?version=1");
    expect(cheminExplication("n", 1, "B")).toBe("/api/notations/n/explication?version=1&cible=B");
    expect(cheminPropositionPlan("n", 3, 4)).toBe(
      "/api/notations/n/plan-action/proposition?version=3&capacite=4",
    );
    expect(cheminBanque("", null)).toBe("/api/notation/banque?limite=50");
    expect(cheminBanque("abc", "valide")).toBe(
      "/api/notation/banque?limite=50&curseur=abc&statut=valide",
    );
    expect(cheminCalibrations("")).toBe("/api/notation/calibrations?limite=50");
    expect(cheminCalibrations("a b")).toBe("/api/notation/calibrations?limite=50&curseur=a%20b");
    expect(hrefAnalyseNotation("m")).toBe("/missions/m/notation/analyse");
    expect(hrefAnalyseNotation("m", 2)).toBe("/missions/m/notation/analyse?version=2");
  });

  it("lit la classe visée, la capacité et le statut de filtre sans faire confiance à l'URL", () => {
    expect(lireCible("B")).toBe("B");
    expect(lireCible(["A", "B"])).toBe("A");
    expect(lireCible("E")).toBeNull();
    expect(lireCible(undefined)).toBeNull();
    expect(lireCapacite("4")).toBe(4);
    expect(lireCapacite("0")).toBe(CAPACITE_DEFAUT);
    expect(lireCapacite("2.5")).toBe(CAPACITE_DEFAUT);
    expect(lireStatutBanque("valide")).toBe("valide");
    expect(lireStatutBanque("autre")).toBeNull();
  });

  it("valide la capacité saisie", () => {
    expect(validerCapacite(" 12 ")).toEqual({ ok: true, charge: { capacite: 12 } });
    expect(validerCapacite("").ok).toBe(false);
    expect(validerCapacite("101").ok).toBe(false);
  });
});

describe("notation augmentée : présentation", () => {
  it("formate ratios et points signés", () => {
    expect(formaterRatio(0.8125)).toBe("81 %");
    expect(formaterRatio(null)).toBe("—");
    expect(formaterPointsSignes(3.5)).toMatch(/^\+3,50$/);
    expect(formaterPointsSignes(-1.2)).toMatch(/^−1,20$/);
    expect(formaterPointsSignes(0)).toMatch(/^0,00$/);
    // Arrondi d'abord, signe ensuite : jamais « −0,00 » ni « +0,00 ».
    expect(formaterPointsSignes(-0.004)).toMatch(/^0,00$/);
    expect(formaterPointsSignes(0.004)).toMatch(/^0,00$/);
    expect(formaterPointsSignes(-0.005)).toMatch(/^−0,01$/);
    expect(formaterPointsSignes(-0)).toMatch(/^0,00$/);
  });

  it("résume la simulation", () => {
    const base: SimulationPassage = {
      classe_actuelle: "C",
      score_actuel: 63.5,
      cible: "B",
      seuil: 65,
      deja_atteinte: false,
      atteignable: true,
      gain_necessaire: 1.5,
      score_projete: 71,
      classe_projetee: "B",
      etapes: [
        {
          dimension: "d",
          libelle: "D",
          indicateur: "i",
          question: "q",
          points_avant: 50,
          points_apres: 75,
          paliers: 1,
          gain: 7.5,
        },
      ],
    };
    expect(phraseSimulation(base)).toBe(
      "Pour passer de C à B (seuil 65), relever 1 pratique : score projeté 71 (classe B).",
    );
    expect(phraseSimulation({ ...base, etapes: [base.etapes[0]!, base.etapes[0]!] })).toContain(
      "2 pratiques",
    );
    expect(phraseSimulation({ ...base, deja_atteinte: true })).toBe(
      "La classe B est déjà atteinte.",
    );
    expect(
      phraseSimulation({ ...base, atteignable: false, tronquee: true, score_projete: 63.5 }),
    ).toContain("interrompue");
    expect(phraseSimulation({ ...base, atteignable: false, score_projete: 63.5 })).toContain(
      "n'est pas atteignable",
    );
  });
});

/* ===== NOT-09 : banque d'items ===== */

/** Saisie valide à 3 niveaux : sert de base aux cas d'erreur. */
function saisieValide(): SaisieItemBanque {
  return {
    ...saisieItemVide(),
    code: "pilotage_revue",
    dimension: "pilotage",
    pratique: "pil.revue",
    intitule: "Revue périodique de la performance",
    niveaux: "3",
    libelles: ["Absente", "Ponctuelle", "Régulière", "", "", "", "", "", "", ""],
    ancrages: [
      "Aucune revue.",
      "Revue sans suite.",
      "Revue mensuelle suivie.",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    formulations: {
      tous: "Revoyez-vous votre performance chaque mois ?",
      dirigeant: "",
      manager: "",
      equipe: "",
      externe: "",
    },
  };
}

function erreursItem(s: SaisieItemBanque, base: ItemBanqueDonnees | null = null) {
  const r = validerSaisieItem(s, base);
  return r.ok ? {} : r.erreurs;
}

describe("banque d'items : chemins et saisie", () => {
  it("construit les chemins de l'API et des pages", () => {
    expect(cheminItemBanque("a/b")).toBe("/api/notation/banque/a%2Fb");
    expect(cheminValiderItem("i")).toBe("/api/notation/banque/i/valider");
    expect(hrefItemBanque("i")).toBe("/notation/banque/i");
    expect(hrefNouvelleVersionItem("i")).toBe("/notation/banque/nouveau?depuis=i");
    expect(cheminCalibration("c")).toBe("/api/notation/calibrations/c");
    expect(cheminCotations("c")).toBe("/api/notation/calibrations/c/cotations");
    expect(cheminCloture("c")).toBe("/api/notation/calibrations/c/cloturer");
    expect(hrefCalibration("c")).toBe("/notation/calibrations/c");
  });

  it("compte les caractères utiles d'une saisie", () => {
    expect(compteurCaracteres("  abc  ", 500)).toBe("3 / 500 caractères");
  });

  it("accepte une saisie complète et construit le contenu attendu par l'API", () => {
    const r = validerSaisieItem(saisieValide());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charge.contenu).toEqual({
      code: "pilotage_revue",
      dimension: "pilotage",
      pratique: "pil.revue",
      intitule: "Revue périodique de la performance",
      echelle: { niveaux: 3, libelles: ["Absente", "Ponctuelle", "Régulière"] },
      ancrages: [
        { niveau: 1, comportement: "Aucune revue." },
        { niveau: 2, comportement: "Revue sans suite." },
        { niveau: 3, comportement: "Revue mensuelle suivie." },
      ],
      formulations: [{ public: "tous", texte: "Revoyez-vous votre performance chaque mois ?" }],
      poids: 1,
      priorite: 5,
      dureeSecondes: 30,
    });
  });

  it("lit le poids à la française et ne garde que les formulations renseignées", () => {
    const s = saisieValide();
    s.poids = "2,5";
    s.formulations.manager = "  Votre équipe revoit-elle sa performance ?  ";
    const r = validerSaisieItem(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charge.contenu.poids).toBe(2.5);
    expect(r.charge.contenu.formulations).toEqual([
      { public: "tous", texte: "Revoyez-vous votre performance chaque mois ?" },
      { public: "manager", texte: "Votre équipe revoit-elle sa performance ?" },
    ]);
  });

  it("refuse les identifiants hors format et les champs vides", () => {
    const s = {
      ...saisieValide(),
      code: "Pilotage Revue",
      dimension: "",
      pratique: "é",
      intitule: " ",
    };
    expect(Object.keys(erreursItem(s)).sort()).toEqual([
      "code",
      "dimension",
      "intitule",
      "pratique",
    ]);
  });

  it("limite la formulation à 500 caractères et l'ancrage à 1000, par niveau", () => {
    const s = saisieValide();
    s.formulations.tous = "x".repeat(FORMULATION_LONGUEUR_MAX + 1);
    s.ancrages[1] = "y".repeat(ANCRAGE_LONGUEUR_MAX + 1);
    const e = erreursItem(s);
    expect(e["formulation-tous"]).toMatch(/500 caractères au plus/);
    expect(e["ancrage-2"]).toMatch(/1000 caractères au plus/);
    // Pile à la limite : accepté (la longueur est mesurée sur le texte nettoyé).
    const limite = saisieValide();
    limite.formulations.tous = ` ${"x".repeat(FORMULATION_LONGUEUR_MAX)} `;
    expect(validerSaisieItem(limite).ok).toBe(true);
  });

  it("exige un comportement et un libellé pour chaque niveau de l'échelle", () => {
    const s = saisieValide();
    s.libelles[2] = " ";
    s.ancrages[0] = "";
    expect(erreursItem(s)).toMatchObject({
      "libelle-3": "Libellé du niveau obligatoire.",
      "ancrage-1": "Un comportement observable est obligatoire pour chaque niveau.",
    });
  });

  it("ignore les cases au-delà du nombre de niveaux choisi", () => {
    const s = saisieValide();
    s.ancrages[7] = "reste d'une échelle plus longue";
    expect(validerSaisieItem(s).ok).toBe(true);
  });

  it("refuse des ancrages qui dépassent 1000 caractères une fois réunis", () => {
    const s = saisieValide();
    s.ancrages = ["a".repeat(400), "b".repeat(400), "c".repeat(400), "", "", "", "", "", "", ""];
    expect(AIDE_ANCRAGES_LONGUEUR_MAX).toBe(1000);
    expect(erreursItem(s).ancrages).toMatch(/Ancrages trop longs/);
  });

  it("exige au moins une formulation", () => {
    const s = saisieValide();
    s.formulations.tous = "  ";
    expect(erreursItem(s).formulations).toMatch(/Au moins une formulation/);
  });

  it("contrôle l'échelle, le poids, la priorité et la durée", () => {
    const s = {
      ...saisieValide(),
      niveaux: "11",
      poids: "0",
      priorite: "10",
      duree: "4",
    };
    expect(Object.keys(erreursItem(s)).sort()).toEqual(["duree", "niveaux", "poids", "priorite"]);
    expect(erreursItem({ ...saisieValide(), poids: "101" }).poids).toBeDefined();
    expect(erreursItem({ ...saisieValide(), poids: "abc" }).poids).toBeDefined();
    expect(erreursItem({ ...saisieValide(), duree: "601" }).duree).toBeDefined();
    expect(erreursItem({ ...saisieValide(), priorite: "1,5" }).priorite).toBeDefined();
    expect(erreursItem({ ...saisieValide(), niveaux: "1" }).niveaux).toBeDefined();
  });

  it("reprend un contenu enregistré et conserve exemples et étalonnage à l'enregistrement", () => {
    const base: ItemBanqueDonnees = {
      code: "c1",
      dimension: "d1",
      pratique: "p1",
      intitule: "Intitulé",
      echelle: { niveaux: 2, libelles: ["Bas", "Haut"] },
      ancrages: [
        { niveau: 1, comportement: "Rien" },
        {
          niveau: 2,
          comportement: "Tout",
          exemples: [{ contexte: "PME agro-industrielle", texte: "Revue mensuelle" }],
        },
      ],
      formulations: [{ public: "dirigeant", texte: "Question dirigeant" }],
      poids: 1.5,
      priorite: 2,
      dureeSecondes: 45,
      etalonnage: { echantillon: 12, moyenne: 1.4, ecartType: 0.5 },
    };
    const s = saisieDepuisItem(base);
    expect(s.niveaux).toBe("2");
    expect(s.poids).toBe("1,5");
    expect(s.formulations.dirigeant).toBe("Question dirigeant");
    expect(s.formulations.tous).toBe("");
    expect(s.libelles).toHaveLength(10);
    const r = validerSaisieItem({ ...s, intitule: "Intitulé modifié" }, base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charge.contenu.intitule).toBe("Intitulé modifié");
    expect(r.charge.contenu.ancrages[1]?.exemples).toEqual(base.ancrages[1]?.exemples);
    expect(r.charge.contenu.ancrages[0]).not.toHaveProperty("exemples");
    expect(r.charge.contenu.etalonnage).toEqual(base.etalonnage);
    expect(r.charge.contenu.poids).toBe(1.5);
    // Sans base, ni exemples ni étalonnage.
    const sans = validerSaisieItem(s);
    expect(sans.ok && sans.charge.contenu.etalonnage).toBeFalsy();
  });
});

describe("banque d'items : droits d'affichage", () => {
  const brouillon = { statut: "brouillon" as const, cree_par: "auteur", modifie_par: "auteur" };
  const roles = (...r: Role[]) => r;

  it("laisse un expert métier qui n'est pas l'auteur valider", () => {
    const d = droitsItemBanque(roles("expert_metier"), "relecteur", brouillon);
    expect(d).toMatchObject({
      modifier: true,
      validerVisible: true,
      valider: true,
      explicationValidation: null,
      nouvelleVersion: false,
    });
  });

  it("désactive la validation, avec explication, pour l'auteur et le dernier modificateur", () => {
    const auteur = droitsItemBanque(roles("expert_metier"), "auteur", brouillon);
    expect(auteur.validerVisible).toBe(true);
    expect(auteur.valider).toBe(false);
    expect(auteur.explicationValidation).toMatch(/séparation des tâches/);
    const modificateur = droitsItemBanque(roles("expert_metier"), "autre", {
      ...brouillon,
      modifie_par: "autre",
    });
    expect(modificateur.valider).toBe(false);
    expect(modificateur.explicationValidation).toMatch(/dernier|modifié/);
  });

  it("ne montre pas le bouton Valider sans notation.publier", () => {
    const d = droitsItemBanque(roles("associe"), "relecteur", brouillon);
    expect(d.modifier).toBe(true);
    expect(d.validerVisible).toBe(false);
    expect(d.valider).toBe(false);
    expect(d.explicationValidation).toMatch(/expert métier/);
    expect(droitsItemBanque(roles("ressources"), "x", brouillon).modifier).toBe(false);
  });

  it("fige une version validée et propose une nouvelle version", () => {
    const d = droitsItemBanque(roles("expert_metier"), "x", { ...brouillon, statut: "valide" });
    expect(d).toMatchObject({
      modifier: false,
      valider: false,
      validerVisible: false,
      nouvelleVersion: true,
      explicationValidation: null,
    });
  });
});

describe("notation augmentée : messages d'erreur de l'API", () => {
  it("détaille les anomalies du moteur avec la partie de l'item concernée", () => {
    const e = new ErreurApi("ITEM_INVALIDE", "Item de banque invalide.", 400, {
      erreurs: [
        { code: "FORMULATION_INVALIDE", chemin: "formulations[1]", message: "Formulation vide." },
        {
          code: "ANCRAGE_INVALIDE",
          chemin: "ancrages[0]",
          message: "Comportement observable vide.",
        },
        {
          code: "POIDS_INVALIDE",
          chemin: "poids",
          message: "Le poids est compris entre 0 (exclu) et 100.",
        },
      ],
    });
    expect(anomaliesErreur(e)).toHaveLength(3);
    expect(messageNotationAugmentee(e)).toBe(
      "Item de banque invalide. Formulation n° 2 : Formulation vide. Ancrage du niveau 1 : Comportement observable vide. Poids : Le poids est compris entre 0 (exclu) et 100.",
    );
  });

  it("ignore les anomalies mal formées et les chemins inconnus", () => {
    const e = new ErreurApi("ITEM_INVALIDE", "Item invalide.", 400, {
      erreurs: ["x", null, { message: 4 }, { code: "A", chemin: "inconnu", message: "Anomalie." }],
    });
    expect(anomaliesErreur(e)).toEqual([{ code: "A", chemin: "inconnu", message: "Anomalie." }]);
    expect(messageNotationAugmentee(e)).toBe("Item invalide. Anomalie.");
    expect(anomaliesErreur(new Error("x"))).toEqual([]);
    expect(libelleCheminAnomalie("etalonnage.moyenne")).toBe("Étalonnage");
    expect(libelleCheminAnomalie("autre")).toBe("");
  });

  it("restitue tels quels les messages métier de l'API, dont la séparation des tâches", () => {
    const separation = new ErreurApi(
      "SEPARATION_DES_TACHES",
      "Un expert métier qui publie les notations ne règle pas le seuil de confiance.",
      403,
    );
    expect(messageNotationAugmentee(separation)).toBe(separation.message);
    expect(
      messageNotationAugmentee(new ErreurApi("ITEM_FIGE", "Un item validé est figé.", 409)),
    ).toBe("Un item validé est figé.");
    expect(
      messageNotationAugmentee(new ErreurApi("CALIBRATION_FIGEE", "Session figée.", 409)),
    ).toBe("Session figée.");
    expect(
      messageNotationAugmentee(new ErreurApi("EXPERT_METIER_REQUIS", "Seul un expert.", 403)),
    ).toBe("Seul un expert.");
  });

  it("traduit un 404 et retombe sur les messages communs sinon", () => {
    expect(messageNotationAugmentee(new ErreurApi("INTROUVABLE", "Not found", 404))).toMatch(
      /n'est plus accessible/,
    );
    expect(messageNotationAugmentee(new ErreurApi("ACCES_REFUSE", "x", 403))).toMatch(/Votre rôle/);
    expect(messageNotationAugmentee(new Error("boom"))).toMatch(/erreur inattendue/);
    expect(etatNotationAugmenteeChange(new ErreurApi("CONFLIT", "x", 409))).toBe(true);
    expect(etatNotationAugmenteeChange(new ErreurApi("X", "x", 400))).toBe(false);
  });
});

/* ===== NOT-13 : calibrations ===== */

describe("calibrations : création d'une session", () => {
  it("accepte une session valide, code déduit du libellé, lignes vides ignorées", () => {
    const s = saisieCalibrationVide();
    s.titre = " Calibrage pilotage ";
    s.cas = [
      { code: "", libelle: "Cas Acme 2026" },
      { code: "beta", libelle: "Cas Bêta" },
      { code: "", libelle: "" },
    ];
    const r = validerSaisieCalibration(s);
    expect(r).toEqual({
      ok: true,
      charge: {
        titre: "Calibrage pilotage",
        cas: [
          { code: "cas_acme_2026", libelle: "Cas Acme 2026" },
          { code: "beta", libelle: "Cas Bêta" },
        ],
        niveaux: 5,
        tolerance: 0,
        notation_id: null,
      },
    });
  });

  it("déduit un code de repli et signale les doublons", () => {
    expect(codeCas({ code: "", libelle: "!!!" }, 2)).toBe("cas_3");
    expect(codeCas({ code: " x ", libelle: "Autre" }, 0)).toBe("x");
    const s = saisieCalibrationVide();
    s.titre = "T";
    s.cas = [
      { code: "a", libelle: "Un" },
      { code: "a", libelle: "Deux" },
    ];
    const r = validerSaisieCalibration(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs["cas-code-1"]).toMatch(/déjà utilisé/);
  });

  it("exige un titre, un cas, un libellé et un code valide", () => {
    const vide = validerSaisieCalibration(saisieCalibrationVide());
    expect(vide.ok).toBe(false);
    if (!vide.ok) expect(Object.keys(vide.erreurs).sort()).toEqual(["cas", "titre"]);
    const s = saisieCalibrationVide();
    s.titre = "T";
    s.cas = [
      { code: "", libelle: "" },
      { code: "Code Invalide", libelle: "Un cas" },
      { code: "ok", libelle: "" },
    ];
    const r = validerSaisieCalibration(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["cas-code-1", "cas-libelle-2"]);
  });

  it("contrôle l'échelle et la tolérance (inférieure au nombre de niveaux)", () => {
    const base = { ...saisieCalibrationVide(), titre: "T", cas: [{ code: "a", libelle: "A" }] };
    const erreurs = (s: typeof base) => {
      const r = validerSaisieCalibration(s);
      return r.ok ? {} : r.erreurs;
    };
    expect(erreurs({ ...base, niveaux: "1" }).niveaux).toBeDefined();
    expect(erreurs({ ...base, niveaux: "3", tolerance: "3" }).tolerance).toMatch(/inférieure/);
    expect(erreurs({ ...base, tolerance: "-1" }).tolerance).toBeDefined();
    expect(erreurs({ ...base, tolerance: "10", niveaux: "10" }).tolerance).toBeDefined();
    expect(erreurs({ ...base, niveaux: "4", tolerance: "2" })).toEqual({});
  });
});

describe("calibrations : cotation, clôture et droits", () => {
  it("valide une cotation dans l'échelle de la session, motif facultatif", () => {
    expect(validerCotation("c1", "3", "  ", 5)).toEqual({
      ok: true,
      charge: { cotations: [{ cas: "c1", niveau: 3 }] },
    });
    expect(validerCotation("c1", "2", " Revue absente ", 5)).toEqual({
      ok: true,
      charge: { cotations: [{ cas: "c1", niveau: 2, motif: "Revue absente" }] },
    });
    const hors = validerCotation("c1", "6", "", 5);
    expect(hors.ok).toBe(false);
    if (!hors.ok) expect(hors.erreurs.niveau).toBe("Choisissez un niveau de 1 à 5.");
    expect(validerCotation("c1", "", "", 5).ok).toBe(false);
    expect(validerCotation("c1", "0", "", 5).ok).toBe(false);
    const long = validerCotation("c1", "1", "m".repeat(2001), 5);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.erreurs.motif).toMatch(/2000/);
  });

  it("liste les niveaux de l'échelle", () => {
    expect(niveauxEchelle(3)).toEqual([1, 2, 3]);
    expect(niveauxEchelle(0)).toEqual([]);
    expect(niveauxEchelle(50)).toHaveLength(10);
  });

  it("exige une conclusion de 4000 caractères au plus", () => {
    expect(validerConclusion("  Cas 3 à rediscuter  ")).toEqual({
      ok: true,
      charge: { conclusion: "Cas 3 à rediscuter" },
    });
    expect(validerConclusion("   ").ok).toBe(false);
    expect(validerConclusion("x".repeat(4001)).ok).toBe(false);
    expect(validerConclusion("x".repeat(4000)).ok).toBe(true);
  });

  it("réserve la clôture à un expert métier et la cotation à qui rédige", () => {
    expect(droitsCalibration(["expert_metier"], false)).toEqual({
      coter: true,
      cloturer: true,
      explicationCloture: null,
    });
    const associe = droitsCalibration(["associe"], false);
    expect(associe.coter).toBe(true);
    expect(associe.cloturer).toBe(false);
    expect(associe.explicationCloture).toMatch(/expert métier/);
    const close = droitsCalibration(["expert_metier"], true);
    expect(close).toEqual({ coter: false, cloturer: false, explicationCloture: null });
    expect(droitsCalibration(["ressources"], false).coter).toBe(false);
  });

  it("présente l'accord et le biais calculés par le moteur", () => {
    expect(libelleAccord(true)).toEqual({ libelle: "En accord", tonalite: "succes" });
    expect(libelleAccord(false)).toEqual({ libelle: "À discuter", tonalite: "attention" });
    expect(libelleAccord(null).libelle).toBe("Un seul évaluateur");
    expect(phraseBiais(null)).toBe("Non comparable");
    expect(phraseBiais(0.004)).toBe("Aligné sur ses pairs");
    expect(phraseBiais(0.5)).toBe("Plus généreux que ses pairs (+0,50 niveau)");
    expect(phraseBiais(-1)).toBe("Plus sévère que ses pairs (−1,00 niveau)");
  });
});

/* ===== NOT-11 : paramètres de confiance ===== */

describe("paramètres de confiance", () => {
  const sortie = (seuil: string, repondants: string) => {
    const r = validerParametres({ seuil, repondants });
    return r.ok ? r.charge : r.erreurs;
  };

  it("accepte les valeurs à la française et les planchers exacts", () => {
    expect(sortie("0,5", "3")).toEqual({ seuil_confiance: 0.5, repondants_cible: 3 });
    expect(sortie("0,3", "2")).toEqual({ seuil_confiance: 0.3, repondants_cible: 2 });
    expect(sortie("1", "1000")).toEqual({ seuil_confiance: 1, repondants_cible: 1000 });
    expect(sortie("0.3125", " 5 ")).toEqual({ seuil_confiance: 0.3125, repondants_cible: 5 });
  });

  it("refuse un seuil sous le plancher de 0,3 et au-dessus de 1", () => {
    expect(sortie("0,29", "3")).toEqual({
      seuil_confiance: expect.stringContaining("0,3 au moins"),
    });
    expect(sortie("0", "3")).toHaveProperty("seuil_confiance");
    expect(sortie("1,01", "3")).toEqual({ seuil_confiance: "Seuil de confiance : 1 au plus." });
    expect(sortie("0,31234", "3")).toEqual({ seuil_confiance: "Quatre décimales au plus." });
  });

  it("refuse un seuil illisible ou vide", () => {
    expect(sortie("", "3")).toHaveProperty("seuil_confiance");
    expect(sortie("beaucoup", "3")).toHaveProperty("seuil_confiance");
  });

  it("refuse moins de 2 répondants cibles, un nombre non entier et un excès", () => {
    expect(sortie("0,5", "1")).toEqual({
      repondants_cible: expect.stringContaining("2 au moins"),
    });
    expect(sortie("0,5", "0")).toHaveProperty("repondants_cible");
    expect(sortie("0,5", "2,5")).toHaveProperty("repondants_cible");
    expect(sortie("0,5", "")).toHaveProperty("repondants_cible");
    expect(sortie("0,5", "1001")).toHaveProperty("repondants_cible");
  });

  it("signale les deux champs fautifs à la fois", () => {
    expect(Object.keys(sortie("0,1", "1")).sort()).toEqual(["repondants_cible", "seuil_confiance"]);
  });

  it("formate le seuil et reprend les paramètres enregistrés dans le formulaire", () => {
    expect(formaterSeuil(0.5)).toBe("0,5");
    expect(formaterSeuil(0.3125)).toBe("0,3125");
    expect(formaterSeuil(1)).toBe("1");
    expect(
      saisieParametres({
        seuil_confiance: 0.5,
        repondants_cible: 3,
        par_defaut: true,
        modifie_le: null,
      }),
    ).toEqual({ seuil: "0,5", repondants: "3" });
  });

  it("réserve la modification à cabinet.gerer et avertit un compte expert métier", () => {
    const associe = droitsParametres(["associe"]);
    expect(associe).toEqual({ modifier: true, avertissement: null, explication: null });
    const cumul = droitsParametres(["associe", "expert_metier"]);
    expect(cumul.modifier).toBe(true);
    expect(cumul.avertissement).toMatch(/séparation des tâches/);
    const expert = droitsParametres(["expert_metier"]);
    expect(expert.modifier).toBe(false);
    expect(expert.explication).toMatch(/associé/);
  });
});
