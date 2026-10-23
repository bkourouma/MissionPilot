/**
 * Logique pure de la gestion des utilisateurs d'un cabinet (console de plateforme) : état de
 * l'éditeur, libellés des actions, messages de succès. Testée dans `GestionUtilisateurs.test.ts`.
 */
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

/** Message annoncé après un changement d'état : `actifApres` = état du compte après l'action. */
export const messageSuccesEtat = (actifApres: boolean): string =>
  actifApres ? SUCCES_COMPTE_REACTIVE : SUCCES_COMPTE_DESACTIVE;

/** « 3 utilisateurs, 2 actifs » ; « Aucun utilisateur ». */
export function sousTitreUtilisateurs(utilisateurs: readonly UtilisateurPlateforme[]): string {
  const n = utilisateurs.length;
  if (n === 0) return libelleNombreUtilisateurs(0);
  const actifs = utilisateurs.filter((u) => u.actif).length;
  return `${libelleNombreUtilisateurs(n)}, ${actifs} ${actifs > 1 ? "actifs" : "actif"}`;
}

export const libelleEtatUtilisateur = (actif: boolean): string => (actif ? "Actif" : "Désactivé");

/** Libellé visible du bouton d'état : l'action proposée, pas l'état courant. */
export const libelleActionEtat = (actif: boolean): string => (actif ? "Désactiver" : "Activer");

export const ariaModifierRoles = (u: Pick<UtilisateurPlateforme, "nom">): string =>
  `Modifier les rôles de ${u.nom}`;

export const ariaActionEtat = (u: Pick<UtilisateurPlateforme, "nom" | "actif">): string =>
  `${libelleActionEtat(u.actif)} le compte de ${u.nom}`;

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
): TexteConfirmation {
  return u.actif
    ? {
        titre: `Désactiver le compte de ${u.nom} ?`,
        consequence:
          "Cette personne ne pourra plus se connecter. Ses données sont conservées et vous pourrez réactiver le compte à tout moment.",
        libelleConfirmer: "Désactiver le compte",
        danger: true,
      }
    : {
        titre: `Réactiver le compte de ${u.nom} ?`,
        consequence: "Cette personne pourra de nouveau se connecter avec son mot de passe actuel.",
        libelleConfirmer: "Réactiver le compte",
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
