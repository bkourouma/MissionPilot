import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminAttestation,
  cheminSuivis,
  cheminVu,
  droitsQualite,
  empreinteCourte,
  etatQualiteChange,
  formaterDuree,
  formaterNps,
  hrefQualite,
  hrefQualiteMission,
  hrefSuivi,
  libelleClasse,
  libelleVerification,
  libelleViolation,
  lireFiltresQualite,
  messageQualite,
  texteParcours,
  tonaliteClasse,
  tonaliteStatutSuivi,
  tonaliteVerification,
  validerAcceptation,
  validerCommentaire,
  validerOuverture,
  validerRelevement,
  validerSatisfaction,
  violationsDeErreur,
} from "./qualite";

const ID = "00000000-0000-4000-8000-000000000001";
const AUTRE = "00000000-0000-4000-8000-000000000002";

describe("libellés et tonalités", () => {
  it("affiche la classe avec sa nature et une tonalité croissante", () => {
    expect(libelleClasse("R3")).toBe("R3 · Engageant");
    expect(tonaliteClasse("R3")).toBe("danger");
    expect(tonaliteClasse("R2")).toBe("attention");
    expect(tonaliteClasse("R1")).toBe("neutre");
  });

  it("tonalité du statut et des vérifications", () => {
    expect(tonaliteStatutSuivi("signe")).toBe("succes");
    expect(tonaliteStatutSuivi("en_revue")).toBe("attention");
    expect(tonaliteStatutSuivi("brouillon")).toBe("neutre");
    expect(tonaliteVerification("atteste")).toBe("succes");
    expect(tonaliteVerification("non_conforme")).toBe("danger");
    expect(tonaliteVerification("non_evaluable")).toBe("attention");
    expect(libelleVerification("en_attente")).toBe("À vérifier");
    expect(libelleVerification("non_evaluable")).toBe("À attester");
  });

  it("explique chaque violation de garde en français", () => {
    expect(libelleViolation({ code: "QUATRE_YEUX", roles: [], acteur: ID })).toContain(
      "Quatre yeux",
    );
    expect(libelleViolation({ code: "CUMUL_INTERDIT", roles: [], acteur: ID })).toContain(
      "cumuler",
    );
    expect(libelleViolation({ code: "AUTEUR_ATTENDU", roles: [], acteur: ID })).toContain("auteur");
  });
});

describe("mise en forme", () => {
  it("progression du parcours", () => {
    expect(texteParcours({ obligatoires: 5, vus: 3, restants: 2, complet: false })).toBe(
      "3 sur 5 parcourus",
    );
    expect(texteParcours({ obligatoires: 0, vus: 0, restants: 0, complet: true })).toContain(
      "Aucun",
    );
  });

  it("durées", () => {
    expect(formaterDuree(0)).toBe("0 s");
    expect(formaterDuree(45)).toBe("45 s");
    expect(formaterDuree(60)).toBe("1 min");
    expect(formaterDuree(750)).toBe("12 min 30 s");
    expect(formaterDuree(3900)).toBe("1 h 05 min");
    expect(formaterDuree(-5)).toBe("0 s");
  });

  it("NPS à la française et empreinte abrégée", () => {
    expect(formaterNps("-33.3")).toBe("−33,3");
    expect(formaterNps("100.0")).toBe("100,0");
    expect(formaterNps(null)).toBe("—");
    const e = "a".repeat(32) + "b".repeat(32);
    expect(empreinteCourte(e)).toBe("aaaaaaaa…bbbbbbbb");
    expect(empreinteCourte("abc")).toBe("abc");
  });
});

describe("filtres et chemins", () => {
  it("ne retient qu'un statut connu et un curseur sûr", () => {
    expect(lireFiltresQualite({ statut: "en_revue", curseur: "abc_-1" })).toEqual({
      statut: "en_revue",
      curseur: "abc_-1",
      mission: "",
    });
    expect(lireFiltresQualite({ statut: "inconnu", curseur: "a b/c" })).toEqual({
      statut: "",
      curseur: "",
      mission: "",
    });
    expect(lireFiltresQualite({ mission: ID })).toMatchObject({ mission: ID });
    expect(lireFiltresQualite({ mission: "../x" })).toMatchObject({ mission: "" });
    expect(lireFiltresQualite({ statut: ["valide", "x"] })).toMatchObject({ statut: "valide" });
  });

  it("construit les chemins d'API et de pages", () => {
    expect(cheminSuivis({ statut: "en_revue", curseur: "" })).toBe(
      "/api/qualite/suivis?limite=30&statut=en_revue",
    );
    expect(hrefQualite()).toBe("/qualite");
    expect(hrefQualite({ statut: "valide" })).toBe("/qualite?statut=valide");
    expect(cheminSuivis({ statut: "", curseur: "", mission: ID })).toBe(
      `/api/qualite/suivis?limite=30&mission_id=${ID}`,
    );
    expect(hrefQualiteMission(ID)).toBe(`/qualite?mission=${ID}`);
    expect(hrefQualite({ mission: ID, statut: "valide" })).toBe(
      `/qualite?mission=${ID}&statut=valide`,
    );
    expect(hrefSuivi("a/b")).toBe("/qualite/a%2Fb");
    expect(cheminVu(ID, AUTRE)).toBe(`/api/qualite/suivis/${ID}/elements/${AUTRE}/vu`);
    expect(cheminAttestation(ID, AUTRE)).toBe(
      `/api/qualite/suivis/${ID}/verification/${AUTRE}/attestation`,
    );
  });
});

describe("droits d'affichage", () => {
  it("distingue consulter, relire, signer et associé", () => {
    expect(droitsQualite(["consultant"])).toEqual({
      consulter: true,
      relire: false,
      signer: false,
      associe: false,
    });
    expect(droitsQualite(["chef_mission"])).toMatchObject({ relire: true, signer: false });
    expect(droitsQualite(["directeur_mission"])).toMatchObject({
      relire: true,
      signer: true,
      associe: false,
    });
    expect(droitsQualite(["associe"])).toMatchObject({ relire: true, signer: true, associe: true });
    expect(droitsQualite(["expert_externe"]).consulter).toBe(false);
  });
});

describe("messages d'erreur", () => {
  it("affiche tel quel le message métier d'une garde ou d'un parcours", () => {
    const e = new ErreurApi("PARCOURS_INCOMPLET", "Parcourez d'abord (2 restants).", 409);
    expect(messageQualite(e)).toBe("Parcourez d'abord (2 restants).");
    expect(messageQualite(new ErreurApi("INTROUVABLE", "x", 404))).toContain(
      "n'est plus accessible",
    );
    expect(messageQualite(new ErreurApi("CONFLIT", "Déjà fait.", 409))).toBe("Déjà fait.");
    expect(etatQualiteChange(new ErreurApi("CONFLIT", "x", 409))).toBe(true);
    expect(etatQualiteChange(new ErreurApi("INTERDIT", "x", 403))).toBe(false);
  });
});

describe("validerOuverture", () => {
  const base = {
    mission_id: ID,
    type_livrable: "rapport",
    livrable_id: AUTRE,
    libelle: " Rapport final ",
    classe: "",
  };

  it("nettoie le libellé et garde l'identifiant saisi", () => {
    expect(validerOuverture(base, () => "x")).toEqual({
      ok: true,
      charge: {
        mission_id: ID,
        type_livrable: "rapport",
        livrable_id: AUTRE,
        libelle: "Rapport final",
      },
    });
  });

  it("génère l'identifiant d'un livrable « autre » et transmet la classe choisie", () => {
    const r = validerOuverture(
      { ...base, type_livrable: "autre", livrable_id: "", classe: "R2" },
      () => ID,
    );
    expect(r).toMatchObject({ ok: true, charge: { livrable_id: ID, classe: "R2" } });
  });

  it("refuse mission, type, identifiant et nom invalides", () => {
    const r = validerOuverture(
      {
        mission_id: "",
        type_livrable: "x",
        livrable_id: "pas-un-uuid",
        libelle: " ",
        classe: "R9",
      },
      () => ID,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "classe",
        "libelle",
        "livrable_id",
        "mission_id",
        "type_livrable",
      ]);
    expect(validerOuverture({ ...base, livrable_id: "" }, () => ID).ok).toBe(false);
  });
});

describe("validerCommentaire et validerRelevement", () => {
  it("commentaire facultatif ou obligatoire", () => {
    expect(validerCommentaire("  ", { obligatoire: false })).toEqual({
      ok: true,
      charge: { commentaire: null },
    });
    expect(validerCommentaire(" ok ", { obligatoire: true })).toEqual({
      ok: true,
      charge: { commentaire: "ok" },
    });
    expect(validerCommentaire(" ", { obligatoire: true }).ok).toBe(false);
    expect(validerCommentaire("x".repeat(2001), { obligatoire: false }).ok).toBe(false);
  });

  it("une classe se relève, jamais autrement", () => {
    expect(validerRelevement("R3", " Chiffres engageants ", "R2")).toEqual({
      ok: true,
      charge: { classe: "R3", motif: "Chiffres engageants" },
    });
    expect(validerRelevement("R1", "m", "R2").ok).toBe(false);
    expect(validerRelevement("R2", "m", "R2").ok).toBe(false);
    expect(validerRelevement("R3", " ", "R2").ok).toBe(false);
    expect(validerRelevement("", "m", "R2").ok).toBe(false);
  });
});

describe("validerAcceptation", () => {
  const base = {
    facteurs: ["pays_a_risque", "inconnu"],
    niveau_retenu: "",
    decision: "acceptee",
    motif: "",
  };

  it("exige un motif pour accepter malgré un conflit, refuser ou conditionner", () => {
    expect(validerAcceptation(base, { conflits: 1 }).ok).toBe(false);
    expect(validerAcceptation({ ...base, decision: "refusee" }, { conflits: 0 }).ok).toBe(false);
    expect(
      validerAcceptation({ ...base, decision: "acceptee_sous_conditions" }, { conflits: 0 }).ok,
    ).toBe(false);
    expect(validerAcceptation(base, { conflits: 0 })).toMatchObject({
      ok: true,
      charge: { decision: "acceptee", motif: null, facteurs: ["pays_a_risque"] },
    });
  });

  it("transmet le niveau retenu et le motif nettoyé", () => {
    expect(
      validerAcceptation(
        { ...base, niveau_retenu: "eleve", motif: " Muraille de Chine " },
        { conflits: 2 },
      ),
    ).toMatchObject({ ok: true, charge: { niveau_retenu: "eleve", motif: "Muraille de Chine" } });
    expect(validerAcceptation({ ...base, decision: "peut-etre" }, { conflits: 0 }).ok).toBe(false);
    expect(validerAcceptation({ ...base, niveau_retenu: "extreme" }, { conflits: 0 }).ok).toBe(
      false,
    );
  });
});

describe("validerSatisfaction", () => {
  const base = { moment: "jalon", jalon_id: ID, note: "9", commentaire: "", repondant: "" };

  it("note entière de 0 à 10, jalon obligatoire pour un jalon", () => {
    expect(validerSatisfaction(base)).toEqual({
      ok: true,
      charge: { moment: "jalon", jalon_id: ID, note: 9, commentaire: null, repondant: null },
    });
    for (const note of ["", "11", "-1", "7,5", "abc"]) {
      expect(validerSatisfaction({ ...base, note }).ok).toBe(false);
    }
    expect(validerSatisfaction({ ...base, jalon_id: "" }).ok).toBe(false);
    expect(validerSatisfaction({ ...base, moment: "autre" }).ok).toBe(false);
  });

  it("la clôture n'envoie pas de jalon", () => {
    const r = validerSatisfaction({
      ...base,
      moment: "cloture",
      jalon_id: "",
      note: "10",
      commentaire: " Très bien ",
    });
    expect(r).toEqual({
      ok: true,
      charge: { moment: "cloture", note: 10, commentaire: "Très bien", repondant: null },
    });
  });
});

describe("violationsDeErreur", () => {
  it("lit les violations d'un refus de garde, et seulement celui-là", () => {
    const v = { code: "QUATRE_YEUX", roles: ["auteur", "revue_second_expert"], acteur: ID };
    expect(
      violationsDeErreur(new ErreurApi("GARDE_VIOLEE", "m", 409, { violations: [v, 3] })),
    ).toEqual([v]);
    expect(violationsDeErreur(new ErreurApi("GARDE_VIOLEE", "m", 409))).toEqual([]);
    expect(violationsDeErreur(new ErreurApi("CONFLIT", "m", 409, { violations: [v] }))).toEqual([]);
    expect(violationsDeErreur(new Error("x"))).toEqual([]);
  });
});
