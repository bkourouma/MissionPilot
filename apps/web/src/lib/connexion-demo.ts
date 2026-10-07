/**
 * Connexion rapide de démonstration (recette humaine en local) : logique pure, testée dans
 * `connexion-demo.test.ts`.
 *
 * Le bloc de la page de connexion dépend UNIQUEMENT de la réponse de l'API : la liste n'existe
 * que si l'API a été démarrée avec `CONNEXION_RAPIDE_DEMO=oui` en développement local (sinon
 * 404, et rien n'est affiché). Le navigateur ne reçoit que l'e-mail, le nom et les rôles des
 * comptes ; aucun stockage navigateur.
 */
import { estRoleClient, ROLE_LIBELLES, TOUS_LES_ROLES, type Role } from "@missionpilot/shared";
import { CODE_ORIGINE_REFUSEE, ErreurApi, MESSAGE_INATTENDU, MESSAGE_ORIGINE_REFUSEE } from "./api";

/** Liste publique des comptes (appel serveur de la page de connexion). */
export const CHEMIN_COMPTES_DEMO = "/api/auth/comptes-demo";
/** Ouverture de session sans mot de passe (appel du navigateur, relayé par `/api/*`). */
export const CHEMIN_CONNEXION_DEMO = "/api/auth/connexion-demo";
/** Même borne que l'API (`routes/connexion-demo.ts`). */
export const MAX_COMPTES_DEMO = 50;

export interface CompteDemo {
  email: string;
  nom: string;
  /** Rôles connus de cette version du web (les autres sont écartés), d'une seule famille. */
  roles: Role[];
}

const ROLES_CONNUS: readonly string[] = TOUS_LES_ROLES;

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function lireCompte(v: unknown): CompteDemo | null {
  if (!estObjet(v)) return null;
  const { email, nom, roles } = v;
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    return null;
  }
  if (typeof nom !== "string" || nom.trim() === "" || nom.length > 200) return null;
  if (!Array.isArray(roles)) return null;
  const connus = roles.filter((r): r is Role => ROLES_CONNUS.includes(r as string));
  if (connus.length === 0) return null;
  // Jamais un compte à la fois du cabinet et du portail (la base l'interdit aussi).
  if (connus.some(estRoleClient) && !connus.every(estRoleClient)) return null;
  return { email, nom: nom.trim(), roles: [...new Set(connus)] };
}

/**
 * Réponse de GET /api/auth/comptes-demo vérifiée avant usage : `null` si elle n'a pas la forme
 * attendue (rien n'est affiché), sinon les comptes valides, sans doublon, bornés.
 */
export function lireComptesDemo(corps: unknown): CompteDemo[] | null {
  if (!estObjet(corps) || !Array.isArray(corps.elements)) return null;
  const vus = new Set<string>();
  const comptes: CompteDemo[] = [];
  for (const element of corps.elements) {
    const compte = lireCompte(element);
    if (!compte || vus.has(compte.email.toLowerCase())) continue;
    vus.add(compte.email.toLowerCase());
    comptes.push(compte);
    if (comptes.length === MAX_COMPTES_DEMO) break;
  }
  return comptes;
}

/** Rôles en clair (`ROLE_LIBELLES` du paquet partagé). */
export function libelleRoles(roles: readonly Role[]): string {
  return roles.map((r) => ROLE_LIBELLES[r]).join(", ");
}

export type EspaceDemo = "cabinet" | "portail";

/** Espace ouvert par le compte : portail client (rôles client) ou application du cabinet. */
export function espaceDuCompte(compte: Pick<CompteDemo, "roles">): EspaceDemo {
  return compte.roles.length > 0 && compte.roles.every(estRoleClient) ? "portail" : "cabinet";
}

export interface GroupeComptesDemo {
  espace: EspaceDemo;
  titre: string;
  comptes: CompteDemo[];
}

export const TITRE_ESPACE_CABINET = "Espace cabinet";
export const TITRE_ESPACE_PORTAIL = "Espace client (portail)";

/**
 * Comptes répartis en deux groupes, toujours dans cet ordre (cabinet, puis portail), chacun
 * dans l'ordre de l'API. Un groupe peut être vide (seed du portail pas encore lancé).
 */
export function grouperComptesDemo(
  comptes: readonly CompteDemo[],
): [GroupeComptesDemo, GroupeComptesDemo] {
  return [
    {
      espace: "cabinet",
      titre: TITRE_ESPACE_CABINET,
      comptes: comptes.filter((c) => espaceDuCompte(c) === "cabinet"),
    },
    {
      espace: "portail",
      titre: TITRE_ESPACE_PORTAIL,
      comptes: comptes.filter((c) => espaceDuCompte(c) === "portail"),
    },
  ];
}

/** Seule réponse acceptée : session ouverte en un temps (jamais d'étape 2FA ici). */
export function connexionDemoReussie(corps: unknown): boolean {
  return estObjet(corps) && corps.ok === true && corps.etape === "connecte";
}

export const MESSAGE_CONNEXION_DEMO_INATTENDUE =
  "Réponse inattendue du serveur. Rechargez la page ou connectez-vous avec le formulaire.";
export const MESSAGE_CONNEXION_DEMO_INDISPONIBLE =
  "La connexion rapide n'est plus active sur ce serveur. Rechargez la page ou connectez-vous avec le formulaire.";

/** Message affiché après un refus ; l'API fournit déjà des messages en français. */
export function messageErreurConnexionDemo(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === CODE_ORIGINE_REFUSEE) return MESSAGE_ORIGINE_REFUSEE;
  // Route absente : l'API a été redémarrée sans la connexion rapide.
  if (e.statut === 404) return MESSAGE_CONNEXION_DEMO_INDISPONIBLE;
  if (e.code === "REQUETE_INVALIDE") return MESSAGE_CONNEXION_DEMO_INATTENDUE;
  return e.message;
}
