import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  lignesDetails,
  lireFiltresAudit,
  messageModificationUtilisateur,
  requete,
  rolesValides,
  validerEnvoiInvitation,
} from "./utilisateurs";

describe("validerEnvoiInvitation", () => {
  it("normalise l'e-mail et ordonne les rôles", () => {
    expect(
      validerEnvoiInvitation({
        email: " Awa@Cabinet.CI ",
        roles: ["gestionnaire", "associe", "x"],
      }),
    ).toEqual({
      ok: true,
      charge: { email: "awa@cabinet.ci", roles: ["associe", "gestionnaire"] },
    });
  });

  it("exige un e-mail valide et au moins un rôle", () => {
    const r = validerEnvoiInvitation({ email: "awa@", roles: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.email).toMatch(/^Adresse e-mail invalide/);
      expect(r.erreurs.roles).toBe("Cochez au moins un rôle.");
    }
  });

  it("écarte les rôles inconnus", () => {
    expect(rolesValides(["admin", "consultant", "consultant"])).toEqual(["consultant"]);
  });
});

describe("messageModificationUtilisateur", () => {
  it("explique la règle du dernier associé", () => {
    expect(messageModificationUtilisateur(new ErreurApi("DERNIER_ASSOCIE", "x", 409))).toMatch(
      /au moins un associé actif/,
    );
    expect(messageModificationUtilisateur(new ErreurApi("CONFLIT", "x", 409))).toBeNull();
  });
});

describe("journal d'audit", () => {
  it("rend une modification en lignes « avant → après »", () => {
    expect(
      lignesDetails({ avant: { nom: "A", actif: true }, apres: { nom: "B", actif: false } }),
    ).toEqual(["Nom : A → B", "Actif : oui → non"]);
  });

  it("rend une création et les autres détails", () => {
    expect(lignesDetails({ apres: { roles: ["associe"] }, client_id: "c1" })).toEqual([
      "Rôles : associe",
      "Identifiant du client : c1",
    ]);
    expect(lignesDetails(null)).toEqual([]);
    expect(lignesDetails({ grades: 0, types: 2 })).toEqual([
      "Grades ajoutés : 0",
      "Types ajoutés : 2",
    ]);
  });

  it("ignore les filtres mal formés de l'URL", () => {
    expect(
      lireFiltresAudit({
        entite: "client",
        action: ["modification", "x"],
        utilisateur_id: "pas-un-uuid",
        du: "2026-01-01",
        au: "01/02/2026",
        curseur: "123abc",
      }),
    ).toEqual({ entite: "client", action: "modification", du: "2026-01-01" });
    expect(lireFiltresAudit({ curseur: "42" })).toEqual({ curseur: "42" });
  });

  it("construit une chaîne de requête sans valeur vide", () => {
    expect(requete({ a: "1", b: undefined, c: "" })).toBe("?a=1");
    expect(requete({})).toBe("");
  });
});
