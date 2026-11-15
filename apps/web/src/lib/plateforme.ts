/**
 * Console de plateforme (super admin) : types, lecture défensive des réponses, validation des
 * saisies et messages d'erreur. Logique pure, testée dans `plateforme.test.ts`.
 *
 * Contrat : `apps/api/src/routes/plateforme.ts` et `apps/api/src/plateforme/schemas.ts`.
 * Le super admin ne voit JAMAIS de donnée métier d'un cabinet : seulement cabinets et comptes.
 */
import {
  creerTraduire,
  libelleRole,
  LOCALES_INTL,
  MOT_DE_PASSE_MIN,
  ROLE_LIBELLES,
  ROLES_CABINET,
  type Langue,
  type RoleCabinet,
} from "@missionpilot/shared";
import { CODE_ORIGINE_REFUSEE, ErreurApi } from "./api";
import { messageErreurLangue } from "./double-authentification";

export const MOT_DE_PASSE_MAX = 200;
export const NOM_MAX = 200;
export const EMAIL_MAX = 254;
/** Pays proposé par défaut (même défaut que l'API). */
export const PAYS_PAR_DEFAUT = "CI";
/** Codes pays proposés (ISO 3166-1 alpha-2, deux lettres majuscules comme l'exige l'API). */
export const PAYS_PROPOSES: readonly string[] = [
  "CI",
  "SN",
  "CM",
  "BF",
  "ML",
  "TG",
  "BJ",
  "GA",
  "CG",
  "CD",
  "NE",
  "GN",
  "MA",
  "TN",
  "FR",
];

export interface SuperAdmin {
  id: string;
  email: string;
  nom: string;
  estDemo: boolean;
}

export interface CabinetPlateforme {
  id: string;
  nom: string;
  pays: string;
  actif: boolean;
  estDemo: boolean;
  creeLe: string;
}

export interface CabinetListe extends CabinetPlateforme {
  nbUtilisateurs: number;
  nbUtilisateursActifs: number;
}

export interface UtilisateurPlateforme {
  id: string;
  email: string;
  nom: string;
  roles: RoleCabinet[];
  actif: boolean;
  creeLe: string;
}

export interface CreationCabinet {
  cabinet: CabinetPlateforme;
  associe: UtilisateurPlateforme;
  /** Mot de passe généré, montré UNE fois ; `null` si l'opérateur en a fourni un. */
  motDePasseGenere: string | null;
}

export interface CreationUtilisateur {
  utilisateur: UtilisateurPlateforme;
  motDePasseGenere: string | null;
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texte = (v: unknown): v is string => typeof v === "string" && v !== "";
const ROLES_CONNUS: readonly string[] = ROLES_CABINET;

function lireCabinetBase(v: unknown): CabinetPlateforme | null {
  if (!estObjet(v)) return null;
  const { id, nom, pays, actif, estDemo, creeLe } = v;
  if (!texte(id) || !texte(nom) || !texte(pays) || typeof actif !== "boolean") return null;
  return {
    id,
    nom,
    pays,
    actif,
    estDemo: estDemo === true,
    creeLe: typeof creeLe === "string" ? creeLe : "",
  };
}

function lireCabinetListe(v: unknown): CabinetListe | null {
  const base = lireCabinetBase(v);
  if (!base || !estObjet(v)) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
  return {
    ...base,
    nbUtilisateurs: n(v.nbUtilisateurs),
    nbUtilisateursActifs: n(v.nbUtilisateursActifs),
  };
}

function lireUtilisateur(v: unknown): UtilisateurPlateforme | null {
  if (!estObjet(v)) return null;
  const { id, email, nom, roles, actif, creeLe } = v;
  if (!texte(id) || !texte(email) || !texte(nom) || typeof actif !== "boolean") return null;
  if (!Array.isArray(roles)) return null;
  return {
    id,
    email,
    nom,
    roles: roles.filter((r): r is RoleCabinet => ROLES_CONNUS.includes(r as string)),
    actif,
    creeLe: typeof creeLe === "string" ? creeLe : "",
  };
}

/** `GET /api/plateforme/moi` (`estDemo` absent de la réponse de connexion : faux). */
export function lireSuperAdmin(corps: unknown): SuperAdmin | null {
  if (!estObjet(corps) || !estObjet(corps.superAdmin)) return null;
  const { id, email, nom, estDemo } = corps.superAdmin;
  if (!texte(id) || !texte(email) || !texte(nom)) return null;
  return { id, email, nom, estDemo: estDemo === true };
}

function lireElements<T>(corps: unknown, lire: (v: unknown) => T | null): T[] | null {
  if (!estObjet(corps) || !Array.isArray(corps.elements)) return null;
  return corps.elements.map(lire).filter((x): x is T => x !== null);
}

/** `GET /api/plateforme/cabinets`. */
export const lireCabinets = (corps: unknown): CabinetListe[] | null =>
  lireElements(corps, lireCabinetListe);

/** `GET /api/plateforme/cabinets/:id/utilisateurs`. */
export const lireUtilisateurs = (corps: unknown): UtilisateurPlateforme[] | null =>
  lireElements(corps, lireUtilisateur);

const lireMotDePasseGenere = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === "string" && v !== "" ? v : undefined;

/** `POST /api/plateforme/cabinets` (201). */
export function lireCreationCabinet(corps: unknown): CreationCabinet | null {
  if (!estObjet(corps)) return null;
  const cabinet = lireCabinetBase(corps.cabinet);
  const associe = lireUtilisateur(corps.associe);
  const motDePasseGenere = lireMotDePasseGenere(corps.motDePasseGenere);
  if (!cabinet || !associe || motDePasseGenere === undefined) return null;
  return { cabinet, associe, motDePasseGenere };
}

/** `POST /api/plateforme/cabinets/:id/utilisateurs` (201). */
export function lireCreationUtilisateur(corps: unknown): CreationUtilisateur | null {
  if (!estObjet(corps)) return null;
  const utilisateur = lireUtilisateur(corps.utilisateur);
  const motDePasseGenere = lireMotDePasseGenere(corps.motDePasseGenere);
  if (!utilisateur || motDePasseGenere === undefined) return null;
  return { utilisateur, motDePasseGenere };
}

/** Réponse de `PATCH …/cabinets/:id`. */
export function lireCabinetModifie(corps: unknown): CabinetPlateforme | null {
  return estObjet(corps) ? lireCabinetBase(corps.cabinet) : null;
}

/** Réponse de `PATCH …/utilisateurs/:uid`. */
export function lireUtilisateurModifie(corps: unknown): UtilisateurPlateforme | null {
  return estObjet(corps) ? lireUtilisateur(corps.utilisateur) : null;
}

// --- Libellés ------------------------------------------------------------------

/** Rôles du cabinet proposés à l'ajout d'un utilisateur (jamais un rôle client). */
export const ROLES_PROPOSES: readonly { valeur: RoleCabinet; libelle: string }[] =
  ROLES_CABINET.map((r) => ({ valeur: r, libelle: ROLE_LIBELLES[r] }));

/** Rôles du cabinet proposés à l'ajout d'un utilisateur, libellés dans la langue de l'interface. */
export function rolesProposes(
  langue: Langue = "fr",
): readonly { valeur: RoleCabinet; libelle: string }[] {
  return ROLES_CABINET.map((r) => ({ valeur: r, libelle: libelleRole(r, langue) }));
}

export function libelleRolesCabinet(roles: readonly string[], langue: Langue = "fr"): string {
  const libelles = roles
    .filter((r) => ROLES_CONNUS.includes(r))
    .map((r) => libelleRole(r as RoleCabinet, langue));
  return libelles.length > 0 ? libelles.join(", ") : creerTraduire(langue)("Aucun rôle", "No role");
}

/** Nom du pays en français (« Côte d'Ivoire »), le code brut si le navigateur ne le connaît pas. */
export function libellePays(code: string, langue: Langue = "fr"): string {
  try {
    return new Intl.DisplayNames([LOCALES_INTL[langue]], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** « 1 utilisateur », « 12 utilisateurs », « Aucun utilisateur ». */
export function libelleNombreUtilisateurs(n: number, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (n <= 0) return t("Aucun utilisateur", "No users");
  return n === 1 ? t("1 utilisateur", "1 user") : t(`${n} utilisateurs`, `${n} users`);
}

// --- Validation des saisies -----------------------------------------------------

const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const aControle = (v: string) =>
  [...v].some((c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f);

function erreurNom(
  valeur: string,
  libelle: string,
  libelleEn: string,
  langue: Langue,
): string | undefined {
  const t = creerTraduire(langue);
  const v = valeur.trim();
  if (v === "") return t(`Saisissez ${libelle}.`, `Enter ${libelleEn}.`);
  if (v.length > NOM_MAX)
    return t(`Maximum ${NOM_MAX} caractères.`, `Maximum ${NOM_MAX} characters.`);
  if (aControle(v))
    return t("Caractères de contrôle interdits.", "Control characters are not allowed.");
  return undefined;
}

function erreurEmail(valeur: string, langue: Langue): string | undefined {
  const t = creerTraduire(langue);
  const v = valeur.trim();
  if (v === "") return t("Saisissez l'adresse e-mail.", "Enter the email address.");
  if (v.length > EMAIL_MAX || !FORMAT_EMAIL.test(v))
    return t(
      "Adresse e-mail invalide. Exemple : prenom.nom@cabinet.ci",
      "Invalid email address. Example: first.last@firm.ci",
    );
  return undefined;
}

/** Mot de passe facultatif : vide = généré par le serveur. */
function erreurMotDePasseFacultatif(valeur: string, langue: Langue): string | undefined {
  const t = creerTraduire(langue);
  if (valeur === "") return undefined;
  if (valeur.length < MOT_DE_PASSE_MIN)
    return t(
      `Au moins ${MOT_DE_PASSE_MIN} caractères, ou laissez vide pour en générer un.`,
      `At least ${MOT_DE_PASSE_MIN} characters, or leave empty to generate one.`,
    );
  if (valeur.length > MOT_DE_PASSE_MAX)
    return t(`Maximum ${MOT_DE_PASSE_MAX} caractères.`, `Maximum ${MOT_DE_PASSE_MAX} characters.`);
  return undefined;
}

export interface SaisieCabinet {
  nom: string;
  pays: string;
  associeNom: string;
  associeEmail: string;
  associeMotDePasse: string;
}
export type ErreursCabinet = Partial<Record<keyof SaisieCabinet, string>>;

export function validerCabinet(s: SaisieCabinet, langue: Langue = "fr"): ErreursCabinet {
  const e: ErreursCabinet = {};
  const nom = erreurNom(s.nom, "le nom du cabinet", "the firm name", langue);
  if (nom) e.nom = nom;
  if (!/^[A-Z]{2}$/.test(s.pays))
    e.pays = creerTraduire(langue)("Choisissez un pays.", "Choose a country.");
  const associeNom = erreurNom(
    s.associeNom,
    "le nom du premier associé",
    "the first partner's name",
    langue,
  );
  if (associeNom) e.associeNom = associeNom;
  const email = erreurEmail(s.associeEmail, langue);
  if (email) e.associeEmail = email;
  const mdp = erreurMotDePasseFacultatif(s.associeMotDePasse, langue);
  if (mdp) e.associeMotDePasse = mdp;
  return e;
}

/** Corps de `POST /api/plateforme/cabinets` (le mot de passe vide est omis). */
export function corpsCreationCabinet(s: SaisieCabinet) {
  return {
    nom: s.nom.trim(),
    pays: s.pays,
    associe: {
      nom: s.associeNom.trim(),
      email: s.associeEmail.trim(),
      ...(s.associeMotDePasse === "" ? {} : { motDePasse: s.associeMotDePasse }),
    },
  };
}

export interface SaisieUtilisateur {
  nom: string;
  email: string;
  roles: readonly string[];
  motDePasse: string;
}
export type ErreursUtilisateur = Partial<Record<keyof SaisieUtilisateur, string>>;

export function validerUtilisateur(
  s: SaisieUtilisateur,
  langue: Langue = "fr",
): ErreursUtilisateur {
  const e: ErreursUtilisateur = {};
  const nom = erreurNom(s.nom, "le nom de l'utilisateur", "the user's name", langue);
  if (nom) e.nom = nom;
  const email = erreurEmail(s.email, langue);
  if (email) e.email = email;
  if (s.roles.length === 0)
    e.roles = creerTraduire(langue)("Choisissez au moins un rôle.", "Choose at least one role.");
  const mdp = erreurMotDePasseFacultatif(s.motDePasse, langue);
  if (mdp) e.motDePasse = mdp;
  return e;
}

/** Corps de `POST …/utilisateurs`. */
export function corpsCreationUtilisateur(s: SaisieUtilisateur) {
  return {
    nom: s.nom.trim(),
    email: s.email.trim(),
    roles: [...s.roles],
    ...(s.motDePasse === "" ? {} : { motDePasse: s.motDePasse }),
  };
}

/** Modification de rôles : 1 à 8 rôles. */
export function validerRoles(roles: readonly string[], langue: Langue = "fr"): string | undefined {
  return roles.length === 0
    ? creerTraduire(langue)("Choisissez au moins un rôle.", "Choose at least one role.")
    : undefined;
}

// --- Messages d'erreur ----------------------------------------------------------

export const MESSAGE_DERNIER_ASSOCIE =
  "Impossible : c'est le dernier associé actif de ce cabinet. Activez ou ajoutez d'abord un autre associé.";
export const MESSAGE_TROP_DE_TENTATIVES =
  "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
export const MESSAGE_SESSION_EXPIREE = "Votre session a expiré. Reconnectez-vous.";
export const MESSAGE_REPONSE_INATTENDUE =
  "Réponse inattendue du serveur. Rechargez la page puis réessayez.";
/** Réponse 201 illisible : l'écriture a pu aboutir, ne pas inviter à recommencer à l'aveugle. */
export const MESSAGE_CABINET_PEUT_ETRE_CREE =
  "Le serveur a répondu de façon inattendue : le cabinet a peut-être été créé. Rechargez la liste des cabinets avant de réessayer.";
export const MESSAGE_UTILISATEUR_PEUT_ETRE_CREE =
  "Le serveur a répondu de façon inattendue : l'utilisateur a peut-être été créé. Rechargez la liste des utilisateurs avant de réessayer.";
export const MESSAGE_IDENTIFIANTS_INVALIDES = "E-mail ou mot de passe incorrect.";

const MESSAGE_DERNIER_ASSOCIE_EN =
  "Not possible: this is the last active partner of this firm. First activate or add another partner.";
const MESSAGE_TROP_DE_TENTATIVES_EN = "Too many attempts. Wait a few minutes before trying again.";
const MESSAGE_SESSION_EXPIREE_EN = "Your session has expired. Sign in again.";
const MESSAGE_REPONSE_INATTENDUE_EN =
  "Unexpected response from the server. Reload the page, then try again.";
const MESSAGE_CABINET_PEUT_ETRE_CREE_EN =
  "The server responded unexpectedly: the firm may have been created. Reload the list of firms before trying again.";
const MESSAGE_UTILISATEUR_PEUT_ETRE_CREE_EN =
  "The server responded unexpectedly: the user may have been created. Reload the list of users before trying again.";
const MESSAGE_IDENTIFIANTS_INVALIDES_EN = "Incorrect email or password.";

/** Message de réponse inattendue de la console, dans la langue de l'interface. */
export function messageReponseInattendue(langue: Langue = "fr"): string {
  return langue === "en" ? MESSAGE_REPONSE_INATTENDUE_EN : MESSAGE_REPONSE_INATTENDUE;
}

/** Message affichable pour une erreur de l'API plateforme (l'API traduit ses propres messages). */
export function messageErreurPlateforme(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (e instanceof Error && e.name === "ReponseInattendue") {
    const traduits: Record<string, string> = {
      [MESSAGE_REPONSE_INATTENDUE]: MESSAGE_REPONSE_INATTENDUE_EN,
      [MESSAGE_CABINET_PEUT_ETRE_CREE]: MESSAGE_CABINET_PEUT_ETRE_CREE_EN,
      [MESSAGE_UTILISATEUR_PEUT_ETRE_CREE]: MESSAGE_UTILISATEUR_PEUT_ETRE_CREE_EN,
    };
    if (!e.message) return messageReponseInattendue(langue);
    return langue === "en" ? (traduits[e.message] ?? e.message) : e.message;
  }
  if (!(e instanceof ErreurApi)) return messageErreurLangue(e, langue);
  // Garde d'origine (403) : avant le refus générique, sinon l'utilisateur ne saurait pas quoi faire.
  if (e.code === CODE_ORIGINE_REFUSEE) return messageErreurLangue(e, langue);
  if (e.statut === 429 || e.code === "TROP_DE_TENTATIVES")
    return t(MESSAGE_TROP_DE_TENTATIVES, MESSAGE_TROP_DE_TENTATIVES_EN);
  if (e.statut === 401) {
    return e.code === "IDENTIFIANTS_INVALIDES"
      ? t(MESSAGE_IDENTIFIANTS_INVALIDES, MESSAGE_IDENTIFIANTS_INVALIDES_EN)
      : t(MESSAGE_SESSION_EXPIREE, MESSAGE_SESSION_EXPIREE_EN);
  }
  if (e.code === "DERNIER_ASSOCIE") return t(MESSAGE_DERNIER_ASSOCIE, MESSAGE_DERNIER_ASSOCIE_EN);
  if (e.statut === 409) return e.message;
  if (e.statut === 400 || e.code === "REQUETE_INVALIDE") {
    return t(
      "Certaines valeurs ont été refusées. Vérifiez les champs puis réessayez.",
      "Some values were rejected. Check the fields, then try again.",
    );
  }
  if (e.statut === 403)
    return t("Action refusée pour ce compte.", "Action refused for this account.");
  if (e.statut === 404)
    return t(
      "Cabinet ou utilisateur introuvable. Rechargez la page.",
      "Firm or user not found. Reload the page.",
    );
  return messageErreurLangue(e, langue);
}

/** Session de la console expirée ou absente. */
export const estSessionExpiree = (e: unknown): boolean =>
  e instanceof ErreurApi && e.statut === 401;
