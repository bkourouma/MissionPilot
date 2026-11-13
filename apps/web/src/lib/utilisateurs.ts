/** Utilisateurs, invitations et journal d'audit : logique pure, testée dans `utilisateurs.test.ts`. */
import {
  creerTraduire,
  libelleRole,
  ROLES,
  ROLE_LIBELLES,
  type Langue,
  type Role,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { FORMAT_EMAIL, type Resultat } from "./saisie";

export interface Utilisateur {
  id: string;
  email: string;
  nom: string;
  roles: Role[];
  actif: boolean;
  cree_le: string;
  /** Double authentification active (SOC-02). */
  tfa_active?: boolean;
}

export interface Invitation {
  id: string;
  email: string;
  roles: Role[];
  expire_le: string;
  cree_le: string;
}

export interface EntreeAudit {
  id: string;
  action: string;
  entite: string;
  entite_id: string | null;
  details: unknown;
  cree_le: string;
  utilisateur_id: string | null;
  utilisateur_nom: string | null;
}

export const OPTIONS_ROLES = ROLES.map((r) => ({ valeur: r, libelle: ROLE_LIBELLES[r] }));

/** Rôles proposés, libellés dans la langue de l'interface. */
export function optionsRoles(langue: Langue = "fr") {
  return ROLES.map((r) => ({ valeur: r, libelle: libelleRole(r, langue) }));
}

/** Ne garde que des rôles connus, sans doublon, dans l'ordre de la table des rôles. */
export function rolesValides(roles: readonly string[]): Role[] {
  return ROLES.filter((r) => roles.includes(r));
}

export function validerRoles(roles: readonly string[], langue: Langue = "fr"): string | undefined {
  return rolesValides(roles).length === 0
    ? creerTraduire(langue)("Cochez au moins un rôle.", "Check at least one role.")
    : undefined;
}

export function validerEnvoiInvitation(
  s: {
    email: string;
    roles: string[];
  },
  langue: Langue = "fr",
): Resultat<{ email: string; roles: Role[] }, "email" | "roles"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"email" | "roles", string>> = {};
  const email = s.email.trim().toLowerCase();
  if (email === "")
    erreurs.email = t(
      "Saisissez l'adresse e-mail de la personne à inviter.",
      "Enter the email address of the person to invite.",
    );
  else if (!FORMAT_EMAIL.test(email) || email.length > 254)
    erreurs.email = t(
      "Adresse e-mail invalide. Exemple : prenom.nom@cabinet.ci",
      "Invalid email address. Example: first.last@firm.ci",
    );
  const roles = validerRoles(s.roles, langue);
  if (roles) erreurs.roles = roles;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { email, roles: rolesValides(s.roles) } };
}

/** Message du refus de modification d'un utilisateur (règle du dernier associé). */
export function messageModificationUtilisateur(e: unknown, langue: Langue = "fr"): string | null {
  if (e instanceof ErreurApi && e.code === "DERNIER_ASSOCIE")
    return creerTraduire(langue)(
      "Impossible : le cabinet doit garder au moins un associé actif. Donnez d'abord le rôle Associé à une autre personne active.",
      "Not possible: the firm must keep at least one active partner. First give the Partner role to another active person.",
    );
  return null;
}

// --- Journal d'audit ---------------------------------------------------------

export const ENTITE_LIBELLES: Record<string, string> = {
  cabinet: "Cabinet",
  ferie: "Jour férié",
  utilisateur: "Utilisateur",
  invitation: "Invitation",
  client: "Client",
  contact_client: "Contact client",
  grade: "Grade",
  collaborateur: "Collaborateur",
  collaborateur_couts: "Coûts d'un collaborateur",
  type_mission: "Type de mission",
  modele_element: "Élément de modèle",
  catalogue: "Catalogue",
  session: "Session",
};

export const ACTION_LIBELLES: Record<string, string> = {
  creation: "Création",
  modification: "Modification",
  suppression: "Suppression",
  acceptation: "Acceptation",
  duplication: "Duplication",
  modification_taux: "Modification de taux",
  semis_catalogue_conseil: "Installation du catalogue de conseil",
  connexion: "Connexion",
  deconnexion: "Déconnexion",
};

export const ENTITE_LIBELLES_EN: Record<string, string> = {
  cabinet: "Firm",
  ferie: "Public holiday",
  utilisateur: "User",
  invitation: "Invitation",
  client: "Client",
  contact_client: "Client contact",
  grade: "Grade",
  collaborateur: "Staff member",
  collaborateur_couts: "Staff member costs",
  type_mission: "Engagement type",
  modele_element: "Template item",
  catalogue: "Catalog",
  session: "Session",
};

export const ACTION_LIBELLES_EN: Record<string, string> = {
  creation: "Creation",
  modification: "Update",
  suppression: "Deletion",
  acceptation: "Acceptance",
  duplication: "Duplication",
  modification_taux: "Rate change",
  semis_catalogue_conseil: "Consulting catalog installation",
  connexion: "Sign-in",
  deconnexion: "Sign-out",
};

/** Libellés des éléments et des actions du journal, dans la langue de l'interface. */
export const entiteLibelles = (langue: Langue = "fr") =>
  langue === "en" ? ENTITE_LIBELLES_EN : ENTITE_LIBELLES;
export const actionLibelles = (langue: Langue = "fr") =>
  langue === "en" ? ACTION_LIBELLES_EN : ACTION_LIBELLES;

export const libelleEntite = (e: string, langue: Langue = "fr") => entiteLibelles(langue)[e] ?? e;
export const libelleAction = (a: string, langue: Langue = "fr") => actionLibelles(langue)[a] ?? a;

/** Libellés des champs les plus fréquents dans les détails du journal. */
const CHAMP_LIBELLES: Record<string, string> = {
  nom: "Nom",
  roles: "Rôles",
  actif: "Actif",
  email: "E-mail",
  pays: "Pays",
  devise_base: "Devise de base",
  unite_saisie_temps: "Unité de saisie des temps",
  heures_par_jour: "Heures par jour",
  jours_travailles: "Jours travaillés",
  raison_sociale: "Raison sociale",
  libelle: "Libellé",
  code: "Code",
  date: "Date",
  depuis_le: "Date d'effet",
  a_valider: "À valider",
  grades: "Grades ajoutés",
  types: "Types ajoutés",
  champs: "Champs modifiés",
  client_id: "Identifiant du client",
  collaborateur_id: "Identifiant du collaborateur",
  type_mission_id: "Identifiant du type de mission",
  utilisateur_id: "Identifiant de l'utilisateur",
  source_id: "Identifiant de l'original",
  forme_juridique: "Forme juridique",
  rccm: "Numéro RCCM",
  compte_contribuable: "Compte contribuable",
  secteur: "Secteur",
  taille: "Taille",
  adresse: "Adresse",
  fonction: "Fonction",
  telephone: "Téléphone",
  principal: "Contact principal",
  ordre: "Ordre",
  domaine: "Domaine",
  mode_facturation: "Mode de facturation",
  duree_type_jours: "Durée type (jours)",
  equipe_type: "Équipe type",
  jours_par_grade: "Jours par grade",
  est_livrable: "Livrable",
  est_jalon: "Jalon",
  niveau: "Niveau",
  parent_id: "Élément parent",
  grade_id: "Grade",
  competences: "Compétences",
  secteurs: "Secteurs",
  langues: "Langues",
  capacite_pct: "Capacité (%)",
  type: "Type",
  nationale: "Fête nationale",
};

const CHAMP_LIBELLES_EN: Record<string, string> = {
  nom: "Name",
  roles: "Roles",
  actif: "Active",
  email: "Email",
  pays: "Country",
  devise_base: "Base currency",
  unite_saisie_temps: "Time entry unit",
  heures_par_jour: "Hours per day",
  jours_travailles: "Working days",
  raison_sociale: "Company name",
  libelle: "Label",
  code: "Code",
  date: "Date",
  depuis_le: "Effective date",
  a_valider: "Pending approval",
  grades: "Grades added",
  types: "Types added",
  champs: "Fields changed",
  client_id: "Client ID",
  collaborateur_id: "Staff member ID",
  type_mission_id: "Engagement type ID",
  utilisateur_id: "User ID",
  source_id: "Original ID",
  forme_juridique: "Legal form",
  rccm: "RCCM number",
  compte_contribuable: "Taxpayer account",
  secteur: "Sector",
  taille: "Size",
  adresse: "Address",
  fonction: "Job title",
  telephone: "Phone",
  principal: "Main contact",
  ordre: "Order",
  domaine: "Domain",
  mode_facturation: "Billing mode",
  duree_type_jours: "Standard duration (days)",
  equipe_type: "Standard team",
  jours_par_grade: "Days per grade",
  est_livrable: "Deliverable",
  est_jalon: "Milestone",
  niveau: "Level",
  parent_id: "Parent item",
  grade_id: "Grade",
  competences: "Skills",
  secteurs: "Sectors",
  langues: "Languages",
  capacite_pct: "Capacity (%)",
  type: "Type",
  nationale: "National holiday",
};

function valeurLisible(v: unknown, langue: Langue = "fr"): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean")
    return v ? creerTraduire(langue)("oui", "yes") : creerTraduire(langue)("non", "no");
  if (Array.isArray(v)) return v.map((x) => valeurLisible(x, langue)).join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Détails d'une entrée du journal en lignes lisibles : « Nom : A → B » pour une
 * modification, « Nom : A » sinon. Le texte est rendu échappé par React.
 */
export function lignesDetails(details: unknown, langue: Langue = "fr"): string[] {
  if (!estObjet(details)) return [];
  const libelle = (c: string) =>
    (langue === "en" ? CHAMP_LIBELLES_EN[c] : undefined) ?? CHAMP_LIBELLES[c] ?? c;
  const valeur = (v: unknown) => valeurLisible(v, langue);
  const sep = langue === "en" ? ": " : " : ";
  const avant = estObjet(details.avant) ? details.avant : null;
  const apres = estObjet(details.apres) ? details.apres : null;
  const lignes: string[] = [];
  if (avant || apres) {
    const champs = [...new Set([...Object.keys(avant ?? {}), ...Object.keys(apres ?? {})])];
    for (const c of champs) {
      if (avant && apres)
        lignes.push(`${libelle(c)}${sep}${valeur(avant[c])} → ${valeur(apres[c])}`);
      else lignes.push(`${libelle(c)}${sep}${valeur((avant ?? apres)?.[c])}`);
    }
  }
  for (const [c, v] of Object.entries(details)) {
    if (c === "avant" || c === "apres") continue;
    lignes.push(`${libelle(c)}${sep}${valeur(v)}`);
  }
  return lignes;
}

export type FiltresAudit = {
  entite?: string;
  action?: string;
  utilisateur_id?: string;
  du?: string;
  au?: string;
  curseur?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtres lus dans l'URL : toute valeur mal formée est ignorée (pas d'erreur 400 à l'écran). */
export function lireFiltresAudit(p: Record<string, string | string[] | undefined>): FiltresAudit {
  const un = (k: string) => {
    const v = p[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s : undefined;
  };
  const f: FiltresAudit = {};
  const entite = un("entite");
  if (entite && entite.length <= 60) f.entite = entite;
  const action = un("action");
  if (action && action.length <= 60) f.action = action;
  const utilisateur = un("utilisateur_id");
  if (utilisateur && UUID.test(utilisateur)) f.utilisateur_id = utilisateur;
  const du = un("du");
  if (du && DATE.test(du)) f.du = du;
  const au = un("au");
  if (au && DATE.test(au)) f.au = au;
  const curseur = un("curseur");
  if (curseur && /^\d{1,18}$/.test(curseur)) f.curseur = curseur;
  return f;
}

/** Chaîne de requête (`?a=b`) à partir de filtres ; vide si aucun. */
export function requete(filtres: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtres)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
