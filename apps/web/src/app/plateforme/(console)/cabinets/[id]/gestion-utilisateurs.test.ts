import { describe, expect, it } from "vitest";
import type { UtilisateurPlateforme } from "../../../../../lib/plateforme";
import {
  ariaActionEtat,
  ariaModifierRoles,
  cleBouton,
  clePanneau,
  estIdentifiantCabinet,
  libelleActionEtat,
  libelleCompte,
  messageSuccesEtat,
  ouvrirConfirmationEtat,
  ouvrirEditeurRoles,
  rolesIdentiques,
  sousTitreUtilisateurs,
  texteConfirmationEtat,
} from "./gestion-utilisateurs";

const u = (nom: string, actif: boolean): UtilisateurPlateforme => ({
  id: `id-${nom}`,
  nom,
  email: `${nom.toLowerCase()}@exemple.ci`,
  roles: ["associe"],
  actif,
  creeLe: "2026-10-01T00:00:00Z",
});

describe("gestion-utilisateurs", () => {
  it("n'accepte que des UUID comme identifiant de cabinet", () => {
    expect(estIdentifiantCabinet("0b3f8a52-6c1d-4e0a-9a57-1f2d3c4b5a69")).toBe(true);
    expect(estIdentifiantCabinet("pas-un-uuid")).toBe(false);
    expect(estIdentifiantCabinet("../etc/passwd")).toBe(false);
    expect(estIdentifiantCabinet("")).toBe(false);
  });

  it("compose le sous-titre avec accord", () => {
    expect(sousTitreUtilisateurs([])).toBe("Aucun utilisateur");
    expect(sousTitreUtilisateurs([u("Awa", true)])).toBe("1 utilisateur, 1 actif");
    expect(sousTitreUtilisateurs([u("Awa", true), u("Koffi", false), u("Ibrahim", true)])).toBe(
      "3 utilisateurs, 2 actifs",
    );
    expect(sousTitreUtilisateurs([u("Awa", false), u("Koffi", false)])).toBe(
      "2 utilisateurs, 0 actif",
    );
  });

  it("propose l'action inverse de l'état et nomme l'utilisateur", () => {
    expect(libelleActionEtat(true)).toBe("Désactiver");
    expect(libelleActionEtat(false)).toBe("Activer");
    expect(ariaActionEtat(u("Awa", true))).toBe("Désactiver le compte de Awa");
    expect(ariaActionEtat(u("Awa", false))).toBe("Activer le compte de Awa");
    expect(ariaModifierRoles(u("Awa", true))).toBe("Modifier les rôles de Awa");
  });

  it("messages de succès", () => {
    expect(messageSuccesEtat(false)).toBe("Compte désactivé.");
    expect(messageSuccesEtat(true)).toBe("Compte réactivé.");
  });

  it("confirmation : désactiver est dangereux et réversible, réactiver ne l'est pas", () => {
    const off = texteConfirmationEtat(u("Awa", true));
    expect(off.danger).toBe(true);
    expect(off.consequence).toContain("ne pourra plus se connecter");
    expect(off.consequence).toContain("réactiver");
    const on = texteConfirmationEtat(u("Awa", false));
    expect(on.danger).toBe(false);
    expect(on.libelleConfirmer).toBe("Réactiver le compte");
  });

  it("libellé du compte du mot de passe généré", () => {
    expect(libelleCompte(u("Awa", true))).toBe("Awa (awa@exemple.ci)");
  });

  it("éditeur de rôles : copie des rôles, comparaison sans ordre", () => {
    const user = u("Awa", true);
    const p = ouvrirEditeurRoles(user);
    expect(p).toEqual({ type: "roles", utilisateurId: user.id, roles: ["associe"] });
    if (p.type === "roles") expect(p.roles).not.toBe(user.roles);
    expect(ouvrirConfirmationEtat(user)).toEqual({ type: "etat", utilisateurId: user.id });
    expect(rolesIdentiques(["a", "b"], ["b", "a"])).toBe(true);
    expect(rolesIdentiques(["a"], ["a", "b"])).toBe(false);
    expect(rolesIdentiques([], [])).toBe(true);
  });

  it("clés des boutons d'origine du focus", () => {
    const user = u("Awa", true);
    expect(clePanneau(ouvrirEditeurRoles(user))).toBe(cleBouton.roles(user.id));
    expect(clePanneau(ouvrirConfirmationEtat(user))).toBe(cleBouton.etat(user.id));
    expect(cleBouton.roles("x")).not.toBe(cleBouton.etat("x"));
  });
});
