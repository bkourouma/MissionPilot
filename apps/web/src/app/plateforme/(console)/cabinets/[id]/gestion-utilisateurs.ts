/**
 * Logique pure de la gestion des utilisateurs d'un cabinet (console de plateforme) : état de
 * l'éditeur, libellés des actions, messages de succès. Testée dans `GestionUtilisateurs.test.ts`.
 */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import {
  libelleNombreUtilisateurs,
  type UtilisateurPlateforme,
} from "../../../../../lib/plateforme";

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L'identifiant de l'URL a la forme d'un UUID (sinon : 404 sans appel d'API). */
export const estIdentifiantCabinet = (id: string): boolean => FORMAT_UUID.test(id);

export const SUCCES_UTILISATEUR_AJOUTE = "Utilisateur ajouté.";
export const SUCCES_ROLES_MIS_A_JOUR = "Rôles mis à jour.";
export const SUCCES_COMPTE_DESACTIVE = "Compte désactivé.";
export const SUCCES_COMPTE_REACTIVE = "Compte réactivé.";

/** Messages de succès dans la langue de l'interface. */
export const succesUtilisateurAjoute = (langue: Langue = "fr"): string =>
  creerTraduire(langue)(SUCCES_UTILISATEUR_AJOUTE, "User added.");
export const succesRolesMisAJour = (langue: Langue = "fr"): string =>
  creerTraduire(langue)(SUCCES_ROLES_MIS_A_JOUR, "Roles updated.");

/** Message annoncé après un changement d'état : `actifApres` = état du compte après l'action. */
export const messageSuccesEtat = (actifApres: boolean, langue: Langue = "fr"): string =>
  actifApres
    ? creerTraduire(langue)(SUCCES_COMPTE_REACTIVE, "Account reactivated.")
    : creerTraduire(langue)(SUCCES_COMPTE_DESACTIVE, "Account deactivated.");

/** « 3 utilisateurs, 2 actifs » ; « Aucun utilisateur ». */
export function sousTitreUtilisateurs(
  utilisateurs: readonly UtilisateurPlateforme[],
  langue: Langue = "fr",
): string {
  const n = utilisateurs.length;
  if (n === 0) return libelleNombreUtilisateurs(0, langue);
  const actifs = utilisateurs.filter((u) => u.actif).length;
  return `${libelleNombreUtilisateurs(n, langue)}, ${actifs} ${
    langue === "en" ? "active" : actifs > 1 ? "actifs" : "actif"
  }`;
}

export const libelleEtatUtilisateur = (actif: boolean, langue: Langue = "fr"): string =>
  actif
    ? creerTraduire(langue)("Actif", "Active")
    : creerTraduire(langue)("Désactivé", "Deactivated");

/** Libellé visible du bouton d'état : l'action proposée, pas l'état courant. */
export const libelleActionEtat = (actif: boolean, langue: Langue = "fr"): string =>
  actif
    ? creerTraduire(langue)("Désactiver", "Deactivate")
    : creerTraduire(langue)("Activer", "Activate");

export const ariaModifierRoles = (
  u: Pick<UtilisateurPlateforme, "nom">,
  langue: Langue = "fr",
): string => creerTraduire(langue)(`Modifier les rôles de ${u.nom}`, `Edit roles of ${u.nom}`);

export const ariaActionEtat = (
  u: Pick<UtilisateurPlateforme, "nom" | "actif">,
  langue: Langue = "fr",
): string =>
  creerTraduire(langue)(
    `${libelleActionEtat(u.actif)} le compte de ${u.nom}`,
    `${libelleActionEtat(u.actif, langue)} the account of ${u.nom}`,
  );

/** « Awa Koné (awa@exemple.ci) » : le compte auquel un mot de passe est attaché. */
export const libelleCompte = (u: Pick<UtilisateurPlateforme, "nom" | "email">): string =>
  `${u.nom} (${u.email})`;

export interface TexteConfirmation {
  titre: string;
  consequence: string;
  libelleConfirmer: string;
  danger: boolean;
}

/** Texte de la confirmation d'un changement d'état (désactiver est réversible). */
export function texteConfirmationEtat(
  u: Pick<UtilisateurPlateforme, "nom" | "actif">,
  langue: Langue = "fr",
): TexteConfirmation {
  const t = creerTraduire(langue);
  return u.actif
    ? {
        titre: t(`Désactiver le compte de ${u.nom} ?`, `Deactivate the account of ${u.nom}?`),
        consequence: t(
          "Cette personne ne pourra plus se connecter. Ses données sont conservées et vous pourrez réactiver le compte à tout moment.",
          "This person will no longer be able to sign in. Their data is kept and you can reactivate the account at any time.",
        ),
        libelleConfirmer: t("Désactiver le compte", "Deactivate the account"),
        danger: true,
      }
    : {
        titre: t(`Réactiver le compte de ${u.nom} ?`, `Reactivate the account of ${u.nom}?`),
        consequence: t(
          "Cette personne pourra de nouveau se connecter avec son mot de passe actuel.",
          "This person will be able to sign in again with their current password.",
        ),
        libelleConfirmer: t("Réactiver le compte", "Reactivate the account"),
        danger: false,
      };
}

/** Panneau d'action ouvert sous la liste : un seul à la fois. */
export type Panneau =
  | { type: "roles"; utilisateurId: string; roles: string[]; erreur?: string }
  | { type: "etat"; utilisateurId: string; erreur?: string };

export const ouvrirEditeurRoles = (u: Pick<UtilisateurPlateforme, "id" | "roles">): Panneau => ({
  type: "roles",
  utilisateurId: u.id,
  roles: [...u.roles],
});

export const ouvrirConfirmationEtat = (u: Pick<UtilisateurPlateforme, "id">): Panneau => ({
  type: "etat",
  utilisateurId: u.id,
});

/** Mêmes rôles, quel que soit l'ordre. */
export function rolesIdentiques(a: readonly string[], b: readonly string[]): boolean {
  const ensembleA = new Set(a);
  const ensembleB = new Set(b);
  return ensembleA.size === ensembleB.size && [...ensembleA].every((r) => ensembleB.has(r));
}

/** Clé du bouton d'origine, pour y ramener le focus à la fermeture d'un panneau. */
export const cleBouton = {
  ajout: "ajout",
  roles: (utilisateurId: string) => `roles:${utilisateurId}`,
  etat: (utilisateurId: string) => `etat:${utilisateurId}`,
} as const;

export const clePanneau = (p: Panneau): string =>
  p.type === "roles" ? cleBouton.roles(p.utilisateurId) : cleBouton.etat(p.utilisateurId);
