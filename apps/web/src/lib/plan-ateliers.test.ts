import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  API_ATELIERS_PORTAIL,
  cheminApiContributionPortail,
  cheminContribution,
  cheminListeAteliers,
  deplacer,
  droitsAtelier,
  formaterCentiemes,
  formaterTauxCentiemes,
  hrefAtelier,
  libelleOption,
  libelleQuadrant,
  lignesParRang,
  messageAtelier,
  ordreInitial,
  peutContribuerCabinet,
  phraseMasque,
  phraseParticipation,
  pointsRepartis,
  raisonOuvertureImpossible,
  saisieAtelierVide,
  saisieMatrice,
  saisieVote,
  validerAtelier,
  validerClassement,
  validerMatrice,
  validerVote,
  type AtelierDetail,
} from "./plan-ateliers";
import type { DroitsPlan } from "./plan-strategique";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("saisie d'un atelier", () => {
  it("valide et normalise le corps envoyé à l'API", () => {
    const s = saisieAtelierVide();
    s.titre = "  Atelier 2027  ";
    s.methodes = ["matrice", "vote"];
    s.options = [
      { libelle: " Digitaliser ", description: "" },
      { libelle: "Former", description: " Équipes " },
    ];
    const v = validerAtelier(s);
    expect(v.erreurs).toEqual({});
    expect(v.corps).toMatchObject({
      titre: "Atelier 2027",
      methodes: ["vote", "matrice"],
      budget_points: 10,
      plafond_par_option: null,
      axes: {
        x: { libelle: "Valeur / impact", inverse: false },
        y: { libelle: "Effort", inverse: true },
      },
    });
    expect(v.corps?.options).toEqual([
      { libelle: "Digitaliser" },
      { libelle: "Former", description: "Équipes" },
    ]);
  });

  it("refuse titre vide, aucune méthode, budget et plafond hors bornes, options insuffisantes ou vides", () => {
    const s = saisieAtelierVide();
    s.methodes = [];
    s.budget_points = "0";
    s.plafond_par_option = "5";
    const v = validerAtelier(s);
    expect(Object.keys(v.erreurs).sort()).toEqual([
      "budget_points",
      "methodes",
      "options",
      "titre",
    ]);
    s.titre = "Ok";
    s.methodes = ["vote"];
    s.budget_points = "10";
    s.plafond_par_option = "11";
    s.options = [{ libelle: "Seule", description: "" }];
    const w = validerAtelier(s);
    expect(Object.keys(w.erreurs).sort()).toEqual(["options", "plafond_par_option"]);
    s.plafond_par_option = "";
    s.options = Array.from({ length: 51 }, (_, i) => ({ libelle: `O${i}`, description: "" }));
    expect(validerAtelier(s).erreurs.options).toMatch(/2 à 50/);
    s.options = [
      { libelle: "A", description: "" },
      { libelle: " ", description: "" },
    ];
    expect(validerAtelier(s).erreurs.options).toBeDefined();
  });
});

describe("vote par points", () => {
  const options = [{ id: A }, { id: B }, { id: C }];

  it("compte les points répartis et préremplit depuis SA contribution", () => {
    expect(pointsRepartis({ [A]: "6", [B]: "4", [C]: "" })).toBe(10);
    expect(pointsRepartis({ [A]: "x" })).toBe(0);
    const s = saisieVote(options, {
      version: 2,
      depose_le: "",
      points: [{ option_id: B, points: 7 }],
    });
    expect(s).toEqual({ [A]: "", [B]: "7", [C]: "" });
  });

  it("refuse un budget dépassé, un plafond dépassé, une saisie illisible ou vide", () => {
    expect(validerVote({ [A]: "6", [B]: "5" }, 10, null).global).toMatch(/11 points/);
    expect(validerVote({ [A]: "9" }, 10, 8).erreurs[A]).toMatch(/8 points au plus/);
    expect(validerVote({ [A]: "1,5" }, 10, null).erreurs[A]).toBeDefined();
    expect(validerVote({ [A]: "0", [B]: "" }, 10, null).global).toMatch(/au moins un point/);
    expect(validerVote({ [A]: "6", [B]: "4", [C]: "0" }, 10, 8).corps).toEqual({
      points: [
        { option_id: A, points: 6 },
        { option_id: B, points: 4 },
      ],
    });
  });
});

describe("classement", () => {
  it("complète l'ordre, le déplace dans les bornes et le valide", () => {
    const options = [{ id: A }, { id: B }, { id: C }];
    expect(ordreInitial(options)).toEqual([A, B, C]);
    expect(ordreInitial(options, { version: 1, depose_le: "", classement: [C, A] })).toEqual([
      C,
      A,
      B,
    ]);
    expect(deplacer([A, B, C], 2, -1)).toEqual([A, C, B]);
    expect(deplacer([A, B, C], 0, -1)).toEqual([A, B, C]);
    expect(deplacer([A, B, C], 2, 1)).toEqual([A, B, C]);
    expect(validerClassement([B, A, C]).corps).toEqual({ classement: [B, A, C] });
    expect(validerClassement([]).global).toMatch(/au moins une option/);
  });
});

describe("matrice", () => {
  it("valide les deux notes de 1 à 5, ignore les options laissées vides", () => {
    const s = saisieMatrice([{ id: A }, { id: B }, { id: C }]);
    expect(validerMatrice(s).global).toMatch(/au moins une option/);
    s[A] = { x: "5", y: "1" };
    s[B] = { x: "6", y: "2" };
    expect(validerMatrice(s).erreurs[B]).toBeDefined();
    s[B] = { x: "", y: "" };
    expect(validerMatrice(s).corps).toEqual({ positions: [{ option_id: A, x: 5, y: 1 }] });
    s[C] = { x: "3", y: "" };
    expect(validerMatrice(s).erreurs[C]).toBeDefined();
  });
});

describe("présentation des entiers du moteur", () => {
  it("taux, moyennes et rangs", () => {
    expect(formaterTauxCentiemes(6667)).toBe("66,67 %");
    expect(formaterTauxCentiemes(10000)).toBe("100 %");
    expect(formaterTauxCentiemes(null)).toBe("—");
    expect(formaterCentiemes(400)).toBe("4");
    expect(formaterCentiemes(null)).toBe("—");
    expect(libelleQuadrant("gains_rapides")).toBe("Gains rapides");
    expect(libelleQuadrant(null)).toBe("Non placée");
    expect(lignesParRang([{ rang: 3 }, { rang: 1 }, { rang: 2 }]).map((l) => l.rang)).toEqual([
      1, 2, 3,
    ]);
    expect(libelleOption([{ id: A, libelle: "Option A" }], A)).toBe("Option A");
    expect(libelleOption([], A)).toBe("Option retirée");
    expect(
      phraseParticipation({ invites: 3, ayant_contribue: 2, taux_centiemes_pourcent: 6667 }),
    ).toBe("2 participants sur 3 invités (66,67 %).");
    expect(
      phraseParticipation({ invites: 1, ayant_contribue: null, taux_centiemes_pourcent: null }),
    ).toBe("1 personne invitée.");
  });
});

describe("droits et état", () => {
  const plan = (rediger: boolean, cloturee = false) => ({ rediger, cloturee }) as DroitsPlan;
  it("écrire, inviter un dirigeant et générer la synthèse suivent les droits du plan et du rôle", () => {
    expect(droitsAtelier(["consultant"], plan(true))).toMatchObject({
      lire: true,
      ecrire: true,
      inviterClient: false,
      synthese: true,
    });
    expect(droitsAtelier(["chef_mission"], plan(true))).toMatchObject({ inviterClient: true });
    expect(droitsAtelier(["expert_metier"], plan(false))).toMatchObject({
      ecrire: false,
      synthese: false,
    });
    expect(droitsAtelier(["chef_mission"], plan(false, true)).cloturee).toBe(true);
    expect(droitsAtelier(["chef_mission"], plan(false, true)).inviterClient).toBe(false);
  });

  it("contribuer : atelier ouvert et personne invitée ; ouvrir : deux options et un participant", () => {
    const a = { statut: "ouvert", participants: [{ utilisateur_id: "moi" }] } as AtelierDetail;
    expect(peutContribuerCabinet(a, "moi")).toBe(true);
    expect(peutContribuerCabinet(a, "autre")).toBe(false);
    expect(peutContribuerCabinet({ ...a, statut: "clos" }, "moi")).toBe(false);
    const brouillon = {
      statut: "brouillon",
      options: [{}, {}],
      participants: [{}],
    } as AtelierDetail;
    expect(raisonOuvertureImpossible(brouillon)).toBeNull();
    expect(raisonOuvertureImpossible({ ...brouillon, participants: [] })).toMatch(/participant/);
    expect(raisonOuvertureImpossible({ ...brouillon, options: [{}] as never })).toMatch(
      /deux options/,
    );
    expect(raisonOuvertureImpossible({ ...brouillon, statut: "ouvert" })).toMatch(/brouillon/);
  });
});

describe("messages et chemins", () => {
  it("traduit les codes de l'API", () => {
    expect(messageAtelier(new ErreurApi("ATELIER_PLAFOND", "x", 409))).toMatch(/Plafond atteint/);
    expect(messageAtelier(new ErreurApi("ATELIER_ETAT", "x", 409))).toMatch(/rechargez/);
    expect(messageAtelier(new ErreurApi("INTERDIT", "x", 403))).toMatch(/rôle/);
    expect(messageAtelier(new ErreurApi("INTROUVABLE", "x", 404))).toMatch(/introuvable/);
    expect(messageAtelier(new ErreurApi("CONFLIT", "Déjà invitée.", 409))).toBe("Déjà invitée.");
  });

  it("construit des chemins encodés, sans identifiant du plan côté portail", () => {
    expect(hrefAtelier("m1", "p1", "a1")).toBe("/missions/m1/plan/p1/ateliers/a1");
    expect(cheminListeAteliers("p1")).toBe("/api/plans/p1/ateliers?limite=30");
    expect(cheminContribution("p1", "a1", "vote")).toBe(
      "/api/plans/p1/ateliers/a1/contribution/vote",
    );
    expect(API_ATELIERS_PORTAIL).toBe("/api/portail/ateliers");
    expect(cheminApiContributionPortail("a 1", "matrice")).toBe(
      "/api/portail/ateliers/a%201/contribution/matrice",
    );
  });
});

describe("phraseMasque", () => {
  it("indique le seuil de participants, 3 par défaut", () => {
    expect(phraseMasque(3)).toBe("Agrégats masqués : au moins 3 participants requis.");
    expect(phraseMasque(undefined)).toBe("Agrégats masqués : au moins 3 participants requis.");
    expect(phraseMasque(5)).toBe("Agrégats masqués : au moins 5 participants requis.");
  });
});
