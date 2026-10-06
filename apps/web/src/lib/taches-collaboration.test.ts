import { describe, expect, it } from "vitest";
import {
  actionsTache,
  changementsTache,
  enRetard,
  hrefNouvelleTache,
  hrefTaches,
  libellePastilleTaches,
  lienEntite,
  lireEntiteLiee,
  lireFiltresTaches,
  pastilleTaches,
  requeteTaches,
  SAISIE_TACHE_VIDE,
  tachesOuvertes,
  transitionsStatut,
  validerTache,
  valeurEntite,
  type TacheCollaboration,
} from "./taches-collaboration";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const M1 = "33333333-3333-4333-8333-333333333333";

const tache = (p: Partial<TacheCollaboration> = {}): TacheCollaboration => ({
  id: "t1",
  titre: "Relancer le client",
  description: "",
  assignee_id: U2,
  assignee_nom: "Awa",
  cree_par: U1,
  cree_par_nom: "Koffi",
  echeance: "2026-10-10",
  statut: "a_faire",
  fait_le: null,
  entite_type: null,
  entite_id: null,
  mission_id: null,
  cree_le: "",
  modifie_le: "",
  ...p,
});

describe("filtres de « Mes tâches »", () => {
  it("lit la vue, le statut et le curseur, avec repli sûr", () => {
    expect(lireFiltresTaches({})).toEqual({ vue: "assignees", statut: "", curseur: "" });
    expect(lireFiltresTaches({ vue: "creees", statut: "fait", curseur: "abc_-=" })).toEqual({
      vue: "creees",
      statut: "fait",
      curseur: "abc_-=",
    });
    expect(lireFiltresTaches({ vue: "x", statut: "y", curseur: "<script>" })).toEqual({
      vue: "assignees",
      statut: "",
      curseur: "",
    });
  });

  it("construit les liens et la requête d'API", () => {
    expect(hrefTaches({ vue: "assignees" })).toBe("/mes-taches");
    expect(hrefTaches({ vue: "creees", statut: "en_cours" })).toBe(
      "/mes-taches?vue=creees&statut=en_cours",
    );
    expect(requeteTaches({ vue: "assignees", statut: "", curseur: "" })).toBe(
      "/api/taches-collaboration?vue=assignees&limite=30",
    );
    expect(requeteTaches({ vue: "creees", statut: "fait", curseur: "c" }, 10)).toBe(
      "/api/taches-collaboration?vue=creees&limite=10&statut=fait&curseur=c",
    );
  });
});

describe("droits d'action", () => {
  it("laisse l'assigné changer le statut, sans modifier le reste", () => {
    expect(actionsTache(tache(), U2, ["consultant"])).toEqual({
      changerStatut: true,
      modifier: false,
    });
  });

  it("laisse le créateur qui garde « tache.assigner » tout modifier", () => {
    expect(actionsTache(tache(), U1, ["chef_mission"])).toEqual({
      changerStatut: true,
      modifier: true,
    });
    // Créateur qui a perdu le droit d'assigner : statut seulement.
    expect(actionsTache(tache(), U1, ["consultant"]).modifier).toBe(false);
  });

  it("ne donne rien à un tiers", () => {
    expect(actionsTache(tache(), "autre", ["associe"])).toEqual({
      changerStatut: false,
      modifier: false,
    });
  });

  it("propose les changements de statut, action principale d'abord", () => {
    expect(transitionsStatut("a_faire").map((t) => t.cible)).toEqual(["en_cours", "fait"]);
    expect(transitionsStatut("en_cours").map((t) => t.cible)).toEqual(["fait", "a_faire"]);
    expect(transitionsStatut("fait")).toEqual([{ cible: "a_faire", libelle: "Rouvrir" }]);
  });

  it("signale une échéance dépassée d'une tâche non faite", () => {
    expect(enRetard(tache(), "2026-10-11")).toBe(true);
    expect(enRetard(tache(), "2026-10-10")).toBe(false);
    expect(enRetard(tache({ statut: "fait" }), "2026-12-01")).toBe(false);
    expect(enRetard(tache({ echeance: null }), "2026-12-01")).toBe(false);
  });
});

describe("élément lié", () => {
  it("pointe vers l'écran de l'élément (mêmes liens que les notifications)", () => {
    expect(lienEntite({ entite_type: "mission", entite_id: M1, mission_id: M1 })).toBe(
      `/missions/${M1}`,
    );
    expect(lienEntite({ entite_type: "mission_tache", entite_id: U1, mission_id: M1 })).toBe(
      `/missions/${M1}/decoupage`,
    );
    expect(lienEntite({ entite_type: "debours", entite_id: U1, mission_id: M1 })).toBe(
      `/missions/${M1}/debours`,
    );
    expect(lienEntite({ entite_type: "facture", entite_id: U1, mission_id: M1 })).toBe(
      `/facturation/${U1}`,
    );
    expect(lienEntite({ entite_type: "opportunite", entite_id: U1, mission_id: null })).toBe(
      `/pipeline/${U1}`,
    );
    expect(lienEntite({ entite_type: "proposition", entite_id: U1, mission_id: null })).toBe(
      `/pipeline/propositions/${U1}`,
    );
  });

  it("ne construit aucun lien depuis une valeur inattendue", () => {
    expect(lienEntite({ entite_type: null, entite_id: null, mission_id: null })).toBeNull();
    expect(
      lienEntite({ entite_type: "mission", entite_id: "../../x", mission_id: null }),
    ).toBeNull();
    expect(lienEntite({ entite_type: "debours", entite_id: U1, mission_id: null })).toBeNull();
  });

  it("lit l'élément passé dans l'URL de création", () => {
    expect(lireEntiteLiee({ entite_type: "facture", entite_id: U1 })).toEqual({
      type: "facture",
      id: U1,
    });
    expect(lireEntiteLiee({ entite_type: "client", entite_id: U1 })).toBeNull();
    expect(lireEntiteLiee({ entite_type: "facture", entite_id: "x" })).toBeNull();
    expect(hrefNouvelleTache("mission", M1)).toBe(
      `/mes-taches/nouvelle?entite_type=mission&entite_id=${M1}`,
    );
  });
});

describe("saisie", () => {
  const ok = { ...SAISIE_TACHE_VIDE, titre: " Relancer ", assignee_id: U2 };

  it("produit la charge de création, élément lié facultatif", () => {
    expect(validerTache(ok)).toEqual({
      ok: true,
      charge: { titre: "Relancer", description: "", assignee_id: U2, echeance: null },
    });
    expect(
      validerTache({ ...ok, echeance: "2026-10-31", entite: valeurEntite("mission", M1) }),
    ).toEqual({
      ok: true,
      charge: {
        titre: "Relancer",
        description: "",
        assignee_id: U2,
        echeance: "2026-10-31",
        entite_type: "mission",
        entite_id: M1,
      },
    });
  });

  it("signale chaque champ invalide", () => {
    const r = validerTache({
      titre: "",
      description: "x".repeat(5001),
      assignee_id: "",
      echeance: "2200-01-01",
      entite: "client:abc",
    });
    expect(r.ok ? [] : Object.keys(r.erreurs).sort()).toEqual([
      "assignee_id",
      "description",
      "echeance",
      "entite",
      "titre",
    ]);
  });

  it("n'envoie que les champs changés à la modification", () => {
    const t = tache({ description: "Avant" });
    const v = validerTache({
      titre: t.titre,
      description: "Après",
      assignee_id: U1,
      echeance: "",
      entite: "",
    });
    expect(v.ok && changementsTache(t, v.charge)).toEqual({
      description: "Après",
      assignee_id: U1,
      echeance: null,
    });
  });
});

describe("pastille de navigation", () => {
  it("compte les tâches ouvertes et plafonne l'affichage", () => {
    expect(
      tachesOuvertes([tache(), tache({ statut: "en_cours" }), tache({ statut: "fait" })]),
    ).toBe(2);
    expect(pastilleTaches(0)).toBeNull();
    expect(pastilleTaches(null)).toBeNull();
    expect(pastilleTaches(3)).toBe("3");
    expect(pastilleTaches(10)).toBe("9+");
    expect(libellePastilleTaches(1)).toBe("1 tâche ouverte");
    expect(libellePastilleTaches(4)).toBe("4 tâches ouvertes");
    expect(libellePastilleTaches(10)).toBe("plus de 9 tâches ouvertes");
    expect(libellePastilleTaches(0)).toBe("");
  });
});
