/** Logique pure de la console de plateforme (libellés, destinations). Testée dans `console-logique.test.ts`. */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { libelleNombreUtilisateurs, type CabinetListe } from "../../../lib/plateforme";
import { CHEMIN_CONNEXION_PLATEFORME } from "../../../lib/plateforme-routes";

/** Un compte de démonstration revient à la connexion des cabinets (point d'entrée de la démo). */
export function destinationApresDeconnexion(estDemo: boolean): string {
  return estDemo ? "/connexion" : CHEMIN_CONNEXION_PLATEFORME;
}

/** « 5 utilisateurs, 4 actifs » ; « Aucun utilisateur » sans compte. */
export function libelleUtilisateursCabinet(
  c: Pick<CabinetListe, "nbUtilisateurs" | "nbUtilisateursActifs">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const total = libelleNombreUtilisateurs(c.nbUtilisateurs, langue);
  if (c.nbUtilisateurs <= 0) return total;
  const actifs =
    c.nbUtilisateursActifs === 0
      ? t("aucun actif", "none active")
      : c.nbUtilisateursActifs === 1
        ? t("1 actif", "1 active")
        : t(`${c.nbUtilisateursActifs} actifs`, `${c.nbUtilisateursActifs} active`);
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
export function texteActionEtat(
  c: Pick<CabinetListe, "nom" | "actif">,
  langue: Langue = "fr",
): TexteActionEtat {
  const t = creerTraduire(langue);
  return c.actif
    ? {
        bouton: t("Désactiver", "Deactivate"),
        nomAccessible: t(`Désactiver le cabinet ${c.nom}`, `Deactivate the firm ${c.nom}`),
        titre: t(`Désactiver le cabinet ${c.nom} ?`, `Deactivate the firm ${c.nom}?`),
        consequences: t(
          "Les utilisateurs de ce cabinet ne pourront plus se connecter. Leurs données sont conservées et vous pourrez réactiver le cabinet à tout moment.",
          "Users of this firm will no longer be able to sign in. Their data is kept and you can reactivate the firm at any time.",
        ),
        confirmer: t("Désactiver le cabinet", "Deactivate the firm"),
        succes: t(`Le cabinet ${c.nom} est désactivé.`, `The firm ${c.nom} is deactivated.`),
        actif: false,
      }
    : {
        bouton: t("Activer", "Activate"),
        nomAccessible: t(`Activer le cabinet ${c.nom}`, `Activate the firm ${c.nom}`),
        titre: t(`Réactiver le cabinet ${c.nom} ?`, `Reactivate the firm ${c.nom}?`),
        consequences: t(
          "Les utilisateurs actifs de ce cabinet pourront de nouveau se connecter.",
          "Active users of this firm will be able to sign in again.",
        ),
        confirmer: t("Activer le cabinet", "Activate the firm"),
        succes: t(`Le cabinet ${c.nom} est réactivé.`, `The firm ${c.nom} is reactivated.`),
        actif: true,
      };
}

/** Compte désigné à côté du mot de passe généré à la création d'un cabinet. */
export function libelleComptePremierAssocie(
  cabinet: string,
  associe: { nom: string; email: string },
  langue: Langue = "fr",
): string {
  return creerTraduire(langue)(
    `Premier associé de ${cabinet} : ${associe.nom} (${associe.email})`,
    `First partner of ${cabinet}: ${associe.nom} (${associe.email})`,
  );
}

export type FiltreEtatCabinet = "tous" | "actifs" | "desactives";

/** Seuil à partir duquel la recherche et le filtre apparaissent (sinon : bruit inutile). */
export const SEUIL_FILTRES_CABINETS = 6;

const normaliser = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Filtre local de la liste des cabinets : nom (sans accents ni casse) et état. */
export function filtrerCabinets<C extends Pick<CabinetListe, "nom" | "actif">>(
  cabinets: readonly C[],
  recherche: string,
  etat: FiltreEtatCabinet,
): C[] {
  const q = normaliser(recherche);
  return cabinets.filter(
    (c) =>
      (etat === "tous" || (etat === "actifs" ? c.actif : !c.actif)) &&
      (q === "" || normaliser(c.nom).includes(q)),
  );
}
