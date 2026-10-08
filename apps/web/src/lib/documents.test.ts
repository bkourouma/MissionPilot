import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  actionsDocument,
  grouperParType,
  memeContenu,
  messageDocument,
  peutEcrireType,
  responsableMission,
  typesDeposables,
  validerDepot,
  type ContexteDocuments,
  type VersionDocument,
} from "./documents";

const ctx = (p: Partial<ContexteDocuments> = {}): ContexteDocuments => ({
  roles: ["consultant"],
  utilisateurId: "moi",
  chefId: "chef",
  directeurId: "dir",
  missionCloturee: false,
  ...p,
});

const doc = (p: Partial<VersionDocument> = {}): VersionDocument => ({
  id: "d1",
  mission_id: "m1",
  type: "livrable",
  nom: "Rapport",
  version: 2,
  auteur_id: "auteur",
  auteur_nom: "Awa",
  chemin_stockage: null,
  cree_le: "2026-10-06T10:00:00Z",
  fichier_id: "f1",
  fichier: {
    id: "f1",
    nom: "rapport.pdf",
    type_mime: "application/pdf",
    taille: 1000,
    sha256: "abc",
    cree_le: "2026-10-06T10:00:00Z",
  },
  statut_contenu: "brouillon_ia",
  contenu_modifie_par: null,
  valide_par: null,
  valide_le: null,
  version_courante: 2,
  est_version_courante: true,
  ...p,
});

describe("droits de dépôt par type", () => {
  it("laisse tout membre déposer livrables et autres documents", () => {
    expect(typesDeposables(ctx())).toEqual(["livrable", "autre"]);
  });

  it("réserve proposition et lettre de mission aux responsables (et la lettre au signataire)", () => {
    expect(typesDeposables(ctx({ roles: ["chef_mission"], chefId: "moi" }))).toEqual([
      "proposition",
      "livrable",
      "autre",
    ]);
    expect(typesDeposables(ctx({ roles: ["directeur_mission"], directeurId: "moi" }))).toEqual([
      "proposition",
      "lettre_de_mission",
      "livrable",
      "autre",
    ]);
    expect(typesDeposables(ctx({ roles: ["associe"] }))).toContain("lettre_de_mission");
    // Chef d'une autre mission : pas de type réservé.
    expect(peutEcrireType("proposition", ctx({ roles: ["chef_mission"] }))).toBe(false);
  });

  it("ferme tout dépôt sur une mission clôturée ou sans « document.ecrire »", () => {
    expect(typesDeposables(ctx({ roles: ["associe"], missionCloturee: true }))).toEqual([]);
    expect(typesDeposables(ctx({ roles: ["gestionnaire"] }))).toEqual([]);
  });

  it("reconnaît le responsable de la mission", () => {
    expect(responsableMission(ctx({ roles: ["directeur_mission"] }))).toBe(true); // modifier_toutes
    expect(responsableMission(ctx({ roles: ["chef_mission"], chefId: "moi" }))).toBe(true);
    expect(responsableMission(ctx({ roles: ["chef_mission"] }))).toBe(false);
  });
});

describe("statut du contenu", () => {
  const chef = ctx({ roles: ["chef_mission"], chefId: "moi" });

  it("fait valider par un responsable qui n'est ni l'auteur ni le dernier modificateur", () => {
    expect(actionsDocument(doc(), chef)).toMatchObject({ valider: true, marquerModifie: true });
    const auteur = actionsDocument(doc({ auteur_id: "moi" }), chef);
    expect(auteur.valider).toBe(false);
    expect(auteur.raisonSansValidation).toContain("un autre responsable");
    expect(actionsDocument(doc({ contenu_modifie_par: "moi" }), chef).valider).toBe(false);
  });

  it("laisse l'associé valider son propre contenu", () => {
    expect(actionsDocument(doc({ auteur_id: "moi" }), ctx({ roles: ["associe"] })).valider).toBe(
      true,
    );
  });

  it("explique au membre qu'il ne valide pas, mais le laisse marquer « modifié »", () => {
    const a = actionsDocument(doc(), ctx());
    expect(a.valider).toBe(false);
    expect(a.marquerModifie).toBe(true);
    expect(a.raisonSansValidation).toContain("chef ou au directeur");
  });

  it("ne change que la version courante, jamais un contenu validé ou hors circuit", () => {
    expect(actionsDocument(doc({ est_version_courante: false }), chef)).toMatchObject({
      valider: false,
      marquerModifie: false,
      nouvelleVersion: false,
    });
    expect(actionsDocument(doc({ statut_contenu: "valide" }), chef).valider).toBe(false);
    const horsCircuit = actionsDocument(doc({ statut_contenu: null }), chef);
    expect(horsCircuit).toMatchObject({
      valider: false,
      marquerModifie: false,
      nouvelleVersion: true,
    });
    expect(horsCircuit.raisonSansValidation).toBeNull();
    expect(actionsDocument(doc({ statut_contenu: "modifie" }), chef)).toMatchObject({
      valider: true,
      marquerModifie: false,
    });
  });

  it("n'ouvre aucune action sur un type réservé à qui ne peut l'écrire", () => {
    const a = actionsDocument(doc({ type: "proposition" }), ctx());
    expect(a).toEqual({
      nouvelleVersion: false,
      marquerModifie: false,
      valider: false,
      raisonSansValidation: null,
    });
  });

  it("explique un refus de validation par l'API", () => {
    const m = messageDocument(
      new ErreurApi("APPROBATION_REQUISE", "L'auteur ne valide pas lui-même.", 403),
    );
    expect(m).toContain("Validation refusée");
    expect(m).toContain("L'auteur ne valide pas lui-même.");
    expect(messageDocument(new ErreurApi("CONTENU_IDENTIQUE", "x", 409))).toContain("identique");
  });
});

describe("dépôt", () => {
  it("valide le type permis, le nom et la présence du fichier", () => {
    expect(
      validerDepot({ type: "livrable", nom: " Rapport ", brouillonIa: false }, ["livrable"], null),
    ).toEqual({
      ok: true,
      charge: { type: "livrable", nom: "Rapport" },
    });
    expect(
      validerDepot({ type: "livrable", nom: "R", brouillonIa: true }, ["livrable"], null),
    ).toEqual({ ok: true, charge: { type: "livrable", nom: "R", statut_contenu: "brouillon_ia" } });
    const r = validerDepot(
      { type: "proposition", nom: "", brouillonIa: false },
      ["livrable"],
      "Choisissez le fichier.",
    );
    expect(r.ok ? [] : Object.keys(r.erreurs).sort()).toEqual(["fichier", "nom", "type"]);
    expect(
      validerDepot(
        { type: "livrable", nom: "x".repeat(201), brouillonIa: false },
        ["livrable"],
        null,
      ).ok,
    ).toBe(false);
  });

  it("repère avant l'envoi un fichier identique à la version courante", () => {
    expect(memeContenu("abc", doc())).toBe(true);
    expect(memeContenu("def", doc())).toBe(false);
    expect(memeContenu(null, doc())).toBe(false);
    expect(memeContenu("abc", doc({ fichier: null }))).toBe(false);
  });

  it("groupe par type dans l'ordre des types, puis par nom", () => {
    const g = grouperParType([
      doc({ id: "1", type: "autre", nom: "b" }),
      doc({ id: "2", type: "livrable", nom: "Zèbre" }),
      doc({ id: "3", type: "livrable", nom: "abeille" }),
      doc({ id: "4", type: "proposition", nom: "P" }),
    ]);
    expect(g.map((x) => [x.type, x.documents.map((d) => d.id)])).toEqual([
      ["proposition", ["4"]],
      ["livrable", ["3", "2"]],
      ["autre", ["1"]],
    ]);
  });
});
