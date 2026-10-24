/**
 * Connexion de démonstration multi-cabinets : logique pure et appels API, testés dans
 * `demo-connexion.test.ts`. Remplace la connexion rapide à plat (`connexion-demo.ts`).
 *
 * La liste n'existe que si l'API a activé la démonstration (sinon 404 : aucun bloc affiché).
 * Le navigateur ne reçoit que des identifiants de cabinet, des noms, des e-mails et des rôles ;
 * aucun stockage navigateur, aucun secret.
 */
import { ROLE_LIBELLES, type Role } from "@missionpilot/shared";
import {
  api,
  CODE_ORIGINE_REFUSEE,
  ErreurApi,
  MESSAGE_INATTENDU,
  MESSAGE_ORIGINE_REFUSEE,
} from "./api";

/** Liste de la démonstration (appel serveur de la page de connexion). */
export const CHEMIN_DEMO = "/api/auth/demo";
/** Ouverture de session d'un compte de cabinet ou de portail (appel du navigateur). */
export const CHEMIN_DEMO_CONNEXION = "/api/auth/demo/connexion";
/** Ouverture de session du super administrateur de la plateforme (appel du navigateur). */
export const CHEMIN_DEMO_CONNEXION_PLATEFORME = "/api/auth/demo/connexion-plateforme";
/** Destination après la connexion du super administrateur (redirection pleine page). */
export const CHEMIN_PLATEFORME = "/plateforme";

export const MAX_CABINETS_DEMO = 50;
export const MAX_COMPTES_PAR_CABINET_DEMO = 100;
const MAX_ROLES_PAR_COMPTE = 20;
const MAX_TEXTE = 200;
const MAX_EMAIL = 254;
const MAX_ID = 100;

export interface DemoCompte {
  email: string;
  nom: string;
  /** Rôles tels que servis par l'API (les inconnus sont écartés à l'affichage). */
  roles: string[];
  /** Compte de l'espace client (portail) plutôt que de l'équipe du cabinet. */
  portail: boolean;
}

export interface DemoCabinet {
  id: string;
  nom: string;
  comptes: DemoCompte[];
}

export interface DemoSuperAdmin {
  email: string;
  nom: string;
}

export interface Demo {
  superAdmin: DemoSuperAdmin | null;
  cabinets: DemoCabinet[];
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const estEmail = (v: unknown): v is string =>
  typeof v === "string" && v.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+$/.test(v);
const estNom = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "" && v.length <= MAX_TEXTE;

function lireSuperAdmin(v: unknown): DemoSuperAdmin | null {
  if (!estObjet(v) || !estEmail(v.email) || !estNom(v.nom)) return null;
  return { email: v.email, nom: v.nom.trim() };
}

function lireCompte(v: unknown): DemoCompte | null {
  if (!estObjet(v) || !estEmail(v.email) || !estNom(v.nom)) return null;
  if (!Array.isArray(v.roles) || typeof v.portail !== "boolean") return null;
  const roles = [
    ...new Set(
      v.roles
        .filter((r): r is string => typeof r === "string" && r !== "" && r.length <= 64)
        .slice(0, MAX_ROLES_PAR_COMPTE),
    ),
  ];
  return { email: v.email, nom: v.nom.trim(), roles, portail: v.portail };
}

function lireCabinet(v: unknown): DemoCabinet | null {
  if (!estObjet(v) || typeof v.id !== "string" || v.id === "" || v.id.length > MAX_ID) return null;
  if (!estNom(v.nom) || !Array.isArray(v.comptes)) return null;
  const vus = new Set<string>();
  const comptes: DemoCompte[] = [];
  for (const element of v.comptes) {
    const compte = lireCompte(element);
    if (!compte || vus.has(compte.email.toLowerCase())) continue;
    vus.add(compte.email.toLowerCase());
    comptes.push(compte);
    if (comptes.length === MAX_COMPTES_PAR_CABINET_DEMO) break;
  }
  return { id: v.id, nom: v.nom.trim(), comptes };
}

/**
 * Réponse de GET /api/auth/demo vérifiée avant usage : `null` si elle n'a pas la forme attendue
 * ou n'est pas active (rien n'est affiché). Les entrées mal formées sont écartées, les tailles
 * bornées et aucun champ imprévu n'est recopié.
 */
export function lireDemo(corps: unknown): Demo | null {
  if (!estObjet(corps) || corps.actif !== true || !Array.isArray(corps.cabinets)) return null;
  const vus = new Set<string>();
  const cabinets: DemoCabinet[] = [];
  for (const element of corps.cabinets) {
    const cabinet = lireCabinet(element);
    if (!cabinet || vus.has(cabinet.id)) continue;
    vus.add(cabinet.id);
    cabinets.push(cabinet);
    if (cabinets.length === MAX_CABINETS_DEMO) break;
  }
  return { superAdmin: lireSuperAdmin(corps.superAdmin), cabinets };
}

// --- Affichage ---------------------------------------------------------------------------------

/** « 1 compte », « 12 comptes » ; « Aucun compte » à zéro. */
export function libelleNombreComptes(n: number): string {
  if (n <= 0) return "Aucun compte";
  return n === 1 ? "1 compte" : `${n} comptes`;
}

const estRoleConnu = (r: string): r is Role => Object.hasOwn(ROLE_LIBELLES, r);

/** Rôles en clair (`ROLE_LIBELLES` du paquet partagé) ; un rôle inconnu de cette version est écarté. */
export function libelleRolesDemo(roles: readonly string[]): string {
  return roles
    .filter(estRoleConnu)
    .map((r) => ROLE_LIBELLES[r])
    .join(", ");
}

export type EspaceDemo = "equipe" | "portail";

export interface GroupeComptesDemo {
  espace: EspaceDemo;
  titre: string;
  comptes: DemoCompte[];
}

export const TITRE_GROUPE_EQUIPE = "Équipe du cabinet";
export const TITRE_GROUPE_PORTAIL = "Espace client (portail)";

/**
 * Comptes d'un cabinet répartis en « Équipe du cabinet » puis « Espace client (portail) »
 * (ordre de l'API conservé) ; un groupe vide est omis.
 */
export function grouperComptesCabinet(comptes: readonly DemoCompte[]): GroupeComptesDemo[] {
  const groupes: GroupeComptesDemo[] = [
    { espace: "equipe", titre: TITRE_GROUPE_EQUIPE, comptes: comptes.filter((c) => !c.portail) },
    { espace: "portail", titre: TITRE_GROUPE_PORTAIL, comptes: comptes.filter((c) => c.portail) },
  ];
  return groupes.filter((g) => g.comptes.length > 0);
}

// --- Automate d'étapes -------------------------------------------------------------------------

/**
 * `focus` : clé de la carte à refocaliser au retour sur le choix (`CLE_SUPER_ADMIN_DEMO` ou id
 * de cabinet).
 */
export type EtatDemo =
  | { etape: "choix"; cabinetId: null; focus: string | null }
  | { etape: "cabinet"; cabinetId: string; focus: string };

export type EvenementDemo = { type: "choisir_cabinet"; cabinetId: string } | { type: "retour" };

export const CLE_SUPER_ADMIN_DEMO = "super-admin";
export const ETAT_DEMO_INITIAL: EtatDemo = { etape: "choix", cabinetId: null, focus: null };

export function transitionDemo(etat: EtatDemo, ev: EvenementDemo): EtatDemo {
  switch (ev.type) {
    case "choisir_cabinet":
      return etat.etape === "choix"
        ? { etape: "cabinet", cabinetId: ev.cabinetId, focus: ev.cabinetId }
        : etat;
    case "retour":
      return etat.etape === "choix" ? etat : { etape: "choix", cabinetId: null, focus: etat.focus };
  }
}

// --- Messages ----------------------------------------------------------------------------------

export const MESSAGE_DEMO_REPONSE_INATTENDUE =
  "Réponse inattendue du serveur. Rechargez la page ou connectez-vous avec une adresse e-mail et un mot de passe.";
export const MESSAGE_DEMO_COMPTE_INCONNU =
  "Ce compte de démonstration n'existe plus. Rechargez la page pour actualiser la liste.";
export const MESSAGE_DEMO_DESACTIVEE =
  "Le mode démonstration n'est plus actif sur ce serveur. Rechargez la page ou connectez-vous avec une adresse e-mail et un mot de passe.";
export const MESSAGE_DEMO_TROP_DE_TENTATIVES =
  "Trop de tentatives de connexion. Patientez quelques minutes avant de réessayer.";
export const MESSAGE_DEMO_REFUSEE = "Ce compte de démonstration ne peut pas s'ouvrir en un clic.";

const CODES_RESEAU = ["RESEAU_INDISPONIBLE", "DELAI_DEPASSE"];

/** Message affiché après un échec de connexion de démonstration (toujours en français). */
export function messageErreurDemo(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === CODE_ORIGINE_REFUSEE) return MESSAGE_ORIGINE_REFUSEE;
  if (e.statut === 0 || CODES_RESEAU.includes(e.code)) return e.message;
  if (e.statut === 401 && e.code === "COMPTE_DEMO_INCONNU") return MESSAGE_DEMO_COMPTE_INCONNU;
  if (e.statut === 403) return e.message.trim() !== "" ? e.message : MESSAGE_DEMO_REFUSEE;
  if (e.statut === 404) return MESSAGE_DEMO_DESACTIVEE;
  if (e.statut === 429) return MESSAGE_DEMO_TROP_DE_TENTATIVES;
  if (e.code === "REQUETE_INVALIDE") return MESSAGE_DEMO_REPONSE_INATTENDUE;
  return e.message.trim() !== "" ? e.message : MESSAGE_INATTENDU;
}

// --- Appels navigateur -------------------------------------------------------------------------

/** Ouvre la session d'un compte de cabinet ; la réponse brute passe dans l'automate de connexion. */
export function connecterCompteDemo(cabinetId: string, email: string): Promise<unknown> {
  return api.post<unknown>(CHEMIN_DEMO_CONNEXION, { cabinetId, email }, { redirigerSi401: false });
}

/** Seule réponse acceptée pour un compte de cabinet : session ouverte en un temps (pas de 2FA). */
export function connexionCompteReussie(corps: unknown): boolean {
  return estObjet(corps) && corps.ok === true && corps.etape === "connecte";
}

/** Réponse attendue de la connexion plateforme : `{ ok: true, superAdmin: { id, email, nom } }`. */
export function connexionPlateformeReussie(corps: unknown): boolean {
  return (
    estObjet(corps) &&
    corps.ok === true &&
    estObjet(corps.superAdmin) &&
    typeof corps.superAdmin.id === "string" &&
    typeof corps.superAdmin.email === "string"
  );
}

/** Ouvre la session du super administrateur ; `true` si la réponse est celle attendue. */
export async function connecterSuperAdminDemo(email: string): Promise<boolean> {
  const corps = await api.post<unknown>(
    CHEMIN_DEMO_CONNEXION_PLATEFORME,
    { email },
    { redirigerSi401: false },
  );
  return connexionPlateformeReussie(corps);
}
