/** Logique pure de la console de plateforme (libellés, destinations). Testée dans `console-logique.test.ts`. */
import { libelleNombreUtilisateurs, type CabinetListe } from "../../../lib/plateforme";
import { CHEMIN_CONNEXION_PLATEFORME } from "../../../lib/plateforme-routes";

/** Un compte de démonstration revient à la connexion des cabinets (point d'entrée de la démo). */
export function destinationApresDeconnexion(estDemo: boolean): string {
  return estDemo ? "/connexion" : CHEMIN_CONNEXION_PLATEFORME;
}

/** « 5 utilisateurs, 4 actifs » ; « Aucun utilisateur » sans compte. */
export function libelleUtilisateursCabinet(
  c: Pick<CabinetListe, "nbUtilisateurs" | "nbUtilisateursActifs">,
): string {
  const total = libelleNombreUtilisateurs(c.nbUtilisateurs);
  if (c.nbUtilisateurs <= 0) return total;
  const actifs =
    c.nbUtilisateursActifs === 0
      ? "aucun actif"
      : c.nbUtilisateursActifs === 1
        ? "1 actif"
        : `${c.nbUtilisateursActifs} actifs`;
  return `${total}, ${actifs}`;
}

export interface TexteActionEtat {
  /** Libellé du bouton : « Désactiver » ou « Activer ». */
  bouton: string;
  /** Nom accessible du bouton, avec le cabinet. */
  nomAccessible: string;
  titre: string;
  consequences: string;
  confirmer: string;
  /** Message de succès annoncé après l'opération. */
  succes: string;
  /** État visé. */
  actif: boolean;
}

/** Textes de l'action d'activation ou de désactivation d'un cabinet. */
export function texteActionEtat(c: Pick<CabinetListe, "nom" | "actif">): TexteActionEtat {
  return c.actif
    ? {
        bouton: "Désactiver",
        nomAccessible: `Désactiver le cabinet ${c.nom}`,
        titre: `Désactiver le cabinet ${c.nom} ?`,
        consequences:
          "Les utilisateurs de ce cabinet ne pourront plus se connecter. Leurs données sont conservées et vous pourrez réactiver le cabinet à tout moment.",
        confirmer: "Désactiver le cabinet",
        succes: `Le cabinet ${c.nom} est désactivé.`,
        actif: false,
      }
    : {
        bouton: "Activer",
        nomAccessible: `Activer le cabinet ${c.nom}`,
        titre: `Réactiver le cabinet ${c.nom} ?`,
        consequences: "Les utilisateurs actifs de ce cabinet pourront de nouveau se connecter.",
        confirmer: "Activer le cabinet",
        succes: `Le cabinet ${c.nom} est réactivé.`,
        actif: true,
      };
}

/** Compte désigné à côté du mot de passe généré à la création d'un cabinet. */
export function libelleComptePremierAssocie(
  cabinet: string,
  associe: { nom: string; email: string },
): string {
  return `Premier associé de ${cabinet} : ${associe.nom} (${associe.email})`;
}
