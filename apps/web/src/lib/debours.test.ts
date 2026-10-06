import { describe, expect, it } from "vitest";
import {
  actionsDebours,
  deboursRefacturables,
  lireStatutDebours,
  saisieDeboursVide,
  saisieDepuisDebours,
  validerDebours,
  valideurDeMission,
  type ContexteDebours,
  type Debours,
} from "./debours";

const MOI = "moi";
const debours: Debours = {
  id: "d1",
  mission_id: "m1",
  collaborateur_id: "c1",
  collaborateur_nom: "Koffi",
  auteur_id: MOI,
  date: "2026-10-05",
  categorie: "transport",
  libelle: "Taxi",
  montant: 15000,
  devise: "XOF",
  refacturable: true,
  justificatif: null,
  statut: "brouillon",
  motif_rejet: null,
  soumis_le: null,
  decide_par: null,
  decide_le: null,
  cree_le: "",
  modifie_le: "",
};

const ctx = (p: Partial<ContexteDebours> = {}): ContexteDebours => ({
  roles: ["consultant"],
  utilisateurId: MOI,
  chefId: "chef",
  directeurId: "dir",
  missionCloturee: false,
  ...p,
});

describe("validerDebours", () => {
  const ok = {
    ...saisieDeboursVide("2026-10-05"),
    categorie: "transport",
    libelle: " Taxi ",
    montant: "15 000",
  };

  it("produit la charge dans la devise de la mission", () => {
    expect(validerDebours(ok, "XOF")).toEqual({
      ok: true,
      charge: {
        date: "2026-10-05",
        categorie: "transport",
        libelle: "Taxi",
        montant: 15000,
        devise: "XOF",
        refacturable: true,
        justificatif: null,
      },
    });
    const eur = validerDebours({ ...ok, montant: "45,50" }, "EUR");
    expect(eur.ok && eur.charge.montant).toBe(4550);
  });

  it("signale chaque champ invalide", () => {
    const r = validerDebours(
      {
        date: "",
        categorie: "x",
        libelle: "",
        montant: "0",
        refacturable: false,
        justificatif: "",
      },
      "XOF",
    );
    expect(r.ok ? [] : Object.keys(r.erreurs).sort()).toEqual([
      "categorie",
      "date",
      "libelle",
      "montant",
    ]);
    expect(validerDebours({ ...ok, montant: "12,5" }, "XOF").ok).toBe(false);
    expect(validerDebours({ ...ok, montant: "" }, "XOF").ok).toBe(false);
  });

  it("n'accepte qu'une référence relative de justificatif", () => {
    expect(validerDebours({ ...ok, justificatif: "frais/2026-10/taxi.jpg" }, "XOF").ok).toBe(true);
    for (const j of ["../secret", "https://exemple.com/x.jpg", "/abs/x", "a\\b"]) {
      expect(validerDebours({ ...ok, justificatif: j }, "XOF").ok).toBe(false);
    }
  });

  it("reprend un débours pour modification", () => {
    expect(saisieDepuisDebours(debours)).toMatchObject({ montant: "15000", justificatif: "" });
  });
});

describe("actionsDebours", () => {
  it("laisse l'auteur modifier, soumettre et supprimer un brouillon ou un rejet", () => {
    expect(actionsDebours(debours, ctx())).toEqual({
      modifier: true,
      soumettre: true,
      supprimer: true,
      valider: false,
      rejeter: false,
    });
    expect(actionsDebours({ ...debours, statut: "rejete" }, ctx()).soumettre).toBe(true);
    expect(actionsDebours(debours, ctx({ missionCloturee: true })).soumettre).toBe(false);
    expect(actionsDebours({ ...debours, statut: "soumis" }, ctx()).modifier).toBe(false);
  });

  it("fait valider par le chef ou le directeur de la mission", () => {
    const soumis = { ...debours, statut: "soumis" as const, auteur_id: "autre" };
    expect(actionsDebours(soumis, ctx({ roles: ["chef_mission"], chefId: MOI })).valider).toBe(
      true,
    );
    expect(
      actionsDebours(soumis, ctx({ roles: ["directeur_mission"], directeurId: MOI })).rejeter,
    ).toBe(true);
    // Chef d'une autre mission : rien.
    expect(actionsDebours(soumis, ctx({ roles: ["chef_mission"] })).valider).toBe(false);
    expect(actionsDebours(soumis, ctx({ roles: ["gestionnaire"] })).valider).toBe(false);
  });

  it("interdit de valider ses propres débours, sauf associé", () => {
    const mien = { ...debours, statut: "soumis" as const };
    expect(actionsDebours(mien, ctx({ roles: ["chef_mission"], chefId: MOI })).valider).toBe(false);
    expect(actionsDebours(mien, ctx({ roles: ["associe"] })).valider).toBe(true);
  });

  it("reconnaît le valideur de la mission", () => {
    expect(
      valideurDeMission({
        roles: ["associe"],
        utilisateurId: MOI,
        chefId: null,
        directeurId: null,
      }),
    ).toBe(true);
    expect(
      valideurDeMission({
        roles: ["consultant"],
        utilisateurId: MOI,
        chefId: MOI,
        directeurId: null,
      }),
    ).toBe(false);
  });
});

describe("divers", () => {
  it("ne garde que les débours refacturables validés", () => {
    const l = [
      { ...debours, id: "a", statut: "valide" as const },
      { ...debours, id: "b", statut: "valide" as const, refacturable: false },
      { ...debours, id: "c", statut: "soumis" as const },
    ];
    expect(deboursRefacturables(l).map((d) => d.id)).toEqual(["a"]);
  });

  it("lit le filtre de statut", () => {
    expect(lireStatutDebours("soumis")).toBe("soumis");
    expect(lireStatutDebours(["valide"])).toBe("valide");
    expect(lireStatutDebours("x")).toBe("");
    expect(lireStatutDebours(undefined)).toBe("");
  });
});
