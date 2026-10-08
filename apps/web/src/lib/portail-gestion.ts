/**
 * Gestion du portail client PAR LE CABINET (SOC-09) : utilisateurs et invitations du portail
 * d'un client, partages explicites (RIEN n'est partagé par défaut), contact principal et
 * politique de double authentification du portail. Logique pure, testée dans
 * `portail-gestion.test.ts`. Les règles reproduisent `apps/api/src/routes/portail-gestion.ts`
 * pour n'afficher que ce qui sera accepté ; l'API reste seule juge.
 */
import {
  aPermission,
  estRoleClient,
  ROLE_LIBELLES,
  ROLES_CLIENT,
  TYPES_DOCUMENT_PARTAGEABLES,
  type Role,
  type RoleClient,
  type StatutContenu,
  type StatutMission,
  type TypeDocument,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { CODE_TFA_A_CONFIGURER, ErreurApi, messageErreur } from "./api";
import {
  messageReconfirmation,
  validerConfirmation,
  validerReconfirmation,
  type ChampConfirmation,
  type ChargeFacteur,
  type FacteurSaisi,
  type SaisieConfirmation,
} from "./double-authentification";
import type { Mission } from "./missions";
import { optionsPersonnes, type Personne } from "./personnes";
import { FORMAT_EMAIL, type Resultat } from "./saisie";
import { ongletsClient } from "./taux-clients";

// --- Réponses de l'API ---------------------------------------------------------------------

export type StatutUtilisateurPortail = "actif" | "desactive";

/** Élément de `GET /api/portail/utilisateurs?client_id=` (jamais de hachage ni de jeton). */
export interface UtilisateurPortail {
  id: string;
  nom: string;
  email: string;
  roles: Role[];
  statut: StatutUtilisateurPortail;
  cree_le: string;
  tfa_active: boolean;
}

/** Invitation du portail en attente (le jeton n'est jamais renvoyé : il part par e-mail). */
export interface InvitationPortail {
  id: string;
  email: string;
  roles: Role[];
  expire_le: string;
  cree_le: string;
}

export interface UtilisateursPortailClient {
  utilisateurs: UtilisateurPortail[];
  invitations: InvitationPortail[];
}

/** Mission partagée, telle que lue par le cabinet (`gerable` : modifiable par l'utilisateur). */
export interface PartageMissionLu {
  mission_id: string;
  intitule: string;
  statut: StatutMission;
  jalons: boolean;
  factures: boolean;
  partage_le: string;
  gerable: boolean;
}

/** Document partagé : une VERSION précise d'un livrable ou d'une lettre de mission. */
export interface DocumentPartageLu {
  document_id: string;
  mission_id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  partage_le: string;
}

/** Réponse de `GET` et `PUT /api/portail/partages?client_id=`. */
export interface PartagesClient {
  client: { id: string; raison_sociale: string; actif: boolean };
  contact_principal: { id: string; nom: string } | null;
  missions: PartageMissionLu[];
  documents: DocumentPartageLu[];
}

/** Réponse de `GET` et `PUT /api/portail/parametres`. */
export interface ParametresPortail {
  tfa_obligatoire: boolean;
}

/** Mission du client (liste `GET /api/missions?client_id=`), réduite à ce qui sert ici. */
export type MissionClient = Pick<
  Mission,
  "id" | "intitule" | "statut" | "directeur_id" | "chef_id" | "date_debut" | "date_fin"
>;

/** Dernière version d'un document de mission (`GET /api/missions/:id/documents`). */
export interface DocumentCandidat {
  id: string;
  mission_id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  statut_contenu: StatutContenu | null;
}

// --- Chemins ---------------------------------------------------------------------------------

const requeteClient = (clientId: string) => `client_id=${encodeURIComponent(clientId)}`;

export const cheminUtilisateursPortail = (clientId: string) =>
  `/api/portail/utilisateurs?${requeteClient(clientId)}`;
export const cheminPartagesPortail = (clientId: string) =>
  `/api/portail/partages?${requeteClient(clientId)}`;
export const CHEMIN_INVITATIONS_PORTAIL = "/api/portail/invitations";
export const cheminInvitationPortail = (id: string) =>
  `${CHEMIN_INVITATIONS_PORTAIL}/${encodeURIComponent(id)}`;
export const cheminStatutUtilisateurPortail = (id: string, action: "desactiver" | "reactiver") =>
  `/api/portail/utilisateurs/${encodeURIComponent(id)}/${action}`;
export const CHEMIN_PARAMETRES_PORTAIL = "/api/portail/parametres";
export const cheminDocumentsMission = (missionId: string) =>
  `/api/missions/${encodeURIComponent(missionId)}/documents`;

/** Page de gestion du portail d'un client, et page de la politique du portail. */
export const hrefPortailClient = (clientId: string) => `/clients/${clientId}/portail`;
export const HREF_POLITIQUE_PORTAIL = "/parametres/portail";

// --- Droits (confort d'affichage : l'API décide) -------------------------------------------

export const gerePortail = (roles: readonly Role[]) => aPermission(roles, "portail.gerer");
export const modifiePolitiquePortail = (roles: readonly Role[]) =>
  aPermission(roles, "cabinet.gerer");
const gereToutesLesMissions = (roles: readonly Role[]) =>
  aPermission(roles, "mission.modifier_toutes");

/** Onglets de la fiche client, complétés de « Portail client » pour qui gère le portail. */
export function ongletsClientAvecPortail(id: string, roles: readonly Role[]) {
  return [
    ...ongletsClient(id, roles),
    ...(gerePortail(roles)
      ? [{ id: "portail", libelle: "Portail client", href: hrefPortailClient(id) }]
      : []),
  ];
}

/** Partages d'une mission modifiables : toutes avec « mission.modifier_toutes », sinon les siennes. */
export function missionGerable(
  m: Pick<MissionClient, "directeur_id" | "chef_id">,
  utilisateurId: string,
  roles: readonly Role[],
): boolean {
  return (
    gereToutesLesMissions(roles) || m.directeur_id === utilisateurId || m.chef_id === utilisateurId
  );
}

/**
 * L'utilisateur gère-t-il le portail de ce client ? Comme `exigerClientGere` de l'API : toutes
 * les missions modifiables, ou la direction (directeur ou chef) d'au moins une de ses missions.
 */
export function gereLeClient(
  missions: readonly Pick<MissionClient, "directeur_id" | "chef_id">[],
  utilisateurId: string,
  roles: readonly Role[],
): boolean {
  if (!gerePortail(roles)) return false;
  return (
    gereToutesLesMissions(roles) || missions.some((m) => missionGerable(m, utilisateurId, roles))
  );
}

// --- Rôles du portail ------------------------------------------------------------------------

/** Ce que chaque rôle du portail permet à la personne invitée. */
export const ROLE_PORTAIL_DESCRIPTIONS: Record<RoleClient, string> = {
  client_dirigeant:
    "Voit les missions partagées, valide leurs jalons et consulte les factures émises partagées.",
  client_contributeur:
    "Voit les missions, jalons et livrables partagés et répond aux questionnaires ; il ne voit pas les factures.",
  client_investisseur:
    "Vue restreinte : son profil seulement, sans missions, jalons, livrables ni factures.",
};

export const OPTIONS_ROLES_PORTAIL = ROLES_CLIENT.map((r) => ({
  valeur: r,
  libelle: ROLE_LIBELLES[r],
  aide: ROLE_PORTAIL_DESCRIPTIONS[r],
}));

/** Libellés des rôles du portail d'un compte (un rôle interne n'est jamais affiché ici). */
export function libellesRolesPortail(roles: readonly string[]): string {
  const libelles = roles.filter(estRoleClient).map((r) => ROLE_LIBELLES[r]);
  return libelles.length === 0 ? "Aucun rôle du portail" : libelles.join(", ");
}

export const STATUT_UTILISATEUR_PORTAIL: Record<
  StatutUtilisateurPortail,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  actif: { libelle: "Accès actif", tonalite: "succes" },
  desactive: { libelle: "Accès désactivé", tonalite: "neutre" },
};

export function statutUtilisateurPortail(statut: string): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  return (
    STATUT_UTILISATEUR_PORTAIL[statut as StatutUtilisateurPortail] ?? {
      libelle: "Statut inconnu",
      tonalite: "neutre",
    }
  );
}

// --- Invitation ------------------------------------------------------------------------------

export type ChampInvitationPortail = "email" | "role";

export interface SaisieInvitationPortail {
  email: string;
  role: string;
}

export interface ChargeInvitationPortail {
  email: string;
  client_id: string;
  roles: RoleClient[];
}

/** Corps de `POST /api/portail/invitations` : e-mail normalisé, UN rôle du portail. */
export function validerInvitationPortail(
  s: SaisieInvitationPortail,
  clientId: string,
): Resultat<ChargeInvitationPortail, ChampInvitationPortail> {
  const erreurs: Partial<Record<ChampInvitationPortail, string>> = {};
  const email = s.email.trim().toLowerCase();
  if (email === "") erreurs.email = "Saisissez l'adresse e-mail de la personne à inviter.";
  else if (!FORMAT_EMAIL.test(email) || email.length > 254)
    erreurs.email = "Adresse e-mail invalide. Exemple : prenom.nom@entreprise.ci";
  if (!estRoleClient(s.role)) erreurs.role = "Choisissez le rôle de la personne sur le portail.";
  if (Object.keys(erreurs).length > 0 || !estRoleClient(s.role)) return { ok: false, erreurs };
  return { ok: true, charge: { email, client_id: clientId, roles: [s.role] } };
}

// --- Documents partageables --------------------------------------------------------------------

export const estTypePartageable = (type: string) =>
  (TYPES_DOCUMENT_PARTAGEABLES as readonly string[]).includes(type);

/**
 * Comme l'API : livrable ou lettre de mission, hors circuit IA ou VALIDÉ (« l'IA propose,
 * l'expert dispose » : aucun brouillon IA n'atteint le client).
 */
export function documentPartageable(d: Pick<DocumentCandidat, "type" | "statut_contenu">): boolean {
  return estTypePartageable(d.type) && (d.statut_contenu === null || d.statut_contenu === "valide");
}

export const RAISON_CONTENU_IA = "Contenu produit par l'IA : à valider avant tout partage.";

/** Document affiché dans les partages d'une mission. */
export interface LigneDocumentPartage {
  id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  partageable: boolean;
  /** Pourquoi le document ne peut pas être partagé. */
  raison: string | null;
  /** Version partagée plus ancienne que la dernière : numéro de la dernière version. */
  versionPlusRecente: number | null;
}

const comparerDocuments = (a: LigneDocumentPartage, b: LigneDocumentPartage) =>
  a.type.localeCompare(b.type) || a.nom.localeCompare(b.nom, "fr") || b.version - a.version;

/**
 * Documents d'une mission à proposer au partage : dernières versions des livrables et lettres
 * de mission (les autres types ne se partagent pas), plus les versions déjà partagées qui ne
 * sont plus les dernières (pour pouvoir les retirer).
 */
export function documentsDeMission(
  missionId: string,
  candidats: readonly DocumentCandidat[],
  partages: readonly DocumentPartageLu[],
): LigneDocumentPartage[] {
  const lignes: LigneDocumentPartage[] = [];
  const derniere = new Map<string, number>();
  for (const d of candidats) {
    if (d.mission_id !== missionId || !estTypePartageable(d.type)) continue;
    const partageable = documentPartageable(d);
    derniere.set(`${d.type}\u0000${d.nom}`, d.version);
    lignes.push({
      id: d.id,
      type: d.type,
      nom: d.nom,
      version: d.version,
      partageable,
      raison: partageable ? null : RAISON_CONTENU_IA,
      versionPlusRecente: null,
    });
  }
  const vus = new Set(lignes.map((l) => l.id));
  for (const p of partages) {
    if (p.mission_id !== missionId || vus.has(p.document_id)) continue;
    vus.add(p.document_id);
    const recente = derniere.get(`${p.type}\u0000${p.nom}`);
    lignes.push({
      id: p.document_id,
      type: p.type,
      nom: p.nom,
      version: p.version,
      partageable: true,
      raison: null,
      versionPlusRecente: recente !== undefined && recente > p.version ? recente : null,
    });
  }
  return lignes.sort(comparerDocuments);
}

/** Mission présentée dans le formulaire des partages. */
export interface MissionPartageable {
  id: string;
  intitule: string;
  statut: StatutMission;
  gerable: boolean;
  documents: LigneDocumentPartage[];
  /** La liste des documents n'a pas pu être chargée : seuls les documents déjà partagés figurent. */
  documentsIndisponibles: boolean;
}

/**
 * Missions du client à présenter : celles que l'utilisateur voit, plus les missions partagées
 * absentes de la liste. Les documents ne sont chargés que pour les missions gérables (`null` :
 * échec du chargement) ; pour les autres, seuls les documents partagés sont montrés.
 */
export function missionsPartageables(e: {
  missions: readonly MissionClient[];
  partages: Pick<PartagesClient, "missions" | "documents">;
  documents: ReadonlyMap<string, readonly DocumentCandidat[] | null>;
  utilisateurId: string;
  roles: readonly Role[];
}): MissionPartageable[] {
  const partageParMission = new Map(e.partages.missions.map((p) => [p.mission_id, p]));
  const resultat: MissionPartageable[] = [];
  const vues = new Set<string>();
  const ajouter = (id: string, intitule: string, statut: StatutMission, gerable: boolean) => {
    vues.add(id);
    const candidats = gerable ? e.documents.get(id) : [];
    resultat.push({
      id,
      intitule,
      statut,
      gerable,
      documents: documentsDeMission(id, candidats ?? [], e.partages.documents),
      documentsIndisponibles: gerable && !candidats,
    });
  };
  for (const m of e.missions) {
    if (vues.has(m.id)) continue;
    const gerable =
      partageParMission.get(m.id)?.gerable ?? missionGerable(m, e.utilisateurId, e.roles);
    ajouter(m.id, m.intitule, m.statut, gerable);
  }
  for (const p of e.partages.missions) {
    if (!vues.has(p.mission_id)) ajouter(p.mission_id, p.intitule, p.statut, p.gerable);
  }
  return resultat.sort((a, b) => a.intitule.localeCompare(b.intitule, "fr"));
}

// --- Brouillon des partages ------------------------------------------------------------------

export interface OptionsMission {
  jalons: boolean;
  factures: boolean;
}

/**
 * État du formulaire : une mission présente dans `missions` est partagée ; `documents` associe
 * l'identifiant d'un document partagé à sa mission ; `contact` vaut "" pour « aucun ».
 */
export interface BrouillonPartages {
  missions: Readonly<Record<string, OptionsMission>>;
  documents: Readonly<Record<string, string>>;
  contact: string;
}

export function brouillonDepuisPartages(p: PartagesClient): BrouillonPartages {
  return {
    missions: Object.fromEntries(
      p.missions.map((m) => [m.mission_id, { jalons: m.jalons, factures: m.factures }]),
    ),
    documents: Object.fromEntries(p.documents.map((d) => [d.document_id, d.mission_id])),
    contact: p.contact_principal?.id ?? "",
  };
}

/** Partager une mission (rien d'autre coché), ou la retirer avec ses jalons, factures et documents. */
export function basculerMission(
  b: BrouillonPartages,
  missionId: string,
  partagee: boolean,
): BrouillonPartages {
  if (partagee) {
    if (b.missions[missionId]) return b;
    return { ...b, missions: { ...b.missions, [missionId]: { jalons: false, factures: false } } };
  }
  const missions = { ...b.missions };
  delete missions[missionId];
  const documents = Object.fromEntries(
    Object.entries(b.documents).filter(([, mission]) => mission !== missionId),
  );
  return { ...b, missions, documents };
}

/** Cocher les jalons ou les factures partage aussi la mission. */
export function basculerOption(
  b: BrouillonPartages,
  missionId: string,
  option: keyof OptionsMission,
  valeur: boolean,
): BrouillonPartages {
  const actuelles = b.missions[missionId];
  if (!actuelles && !valeur) return b;
  const options = { ...(actuelles ?? { jalons: false, factures: false }), [option]: valeur };
  return { ...b, missions: { ...b.missions, [missionId]: options } };
}

/** Cocher un document partage aussi sa mission. */
export function basculerDocument(
  b: BrouillonPartages,
  documentId: string,
  missionId: string,
  coche: boolean,
): BrouillonPartages {
  if (!coche) {
    if (!(documentId in b.documents)) return b;
    const documents = { ...b.documents };
    delete documents[documentId];
    return { ...b, documents };
  }
  const avecMission = basculerMission(b, missionId, true);
  return { ...avecMission, documents: { ...avecMission.documents, [documentId]: missionId } };
}

const signature = (b: BrouillonPartages) =>
  JSON.stringify([
    Object.entries(b.missions)
      .map(([id, o]) => [id, o.jalons, o.factures])
      .sort(),
    Object.keys(b.documents).sort(),
    b.contact,
  ]);

export const brouillonModifie = (b: BrouillonPartages, initial: BrouillonPartages) =>
  signature(b) !== signature(initial);

/** Corps de `PUT /api/portail/partages?client_id=`. */
export interface ChargePartages {
  missions: { mission_id: string; jalons: boolean; factures: boolean }[];
  documents: string[];
  contact_principal_id?: string | null;
}

/**
 * Corps du remplacement des partages : seules les missions GÉRABLES (et leurs documents) sont
 * envoyées, les partages des autres missions restant intacts côté API. Le contact principal
 * n'est envoyé que s'il change ("" → null : plus aucun contact affiché).
 */
export function chargePartages(
  b: BrouillonPartages,
  initial: BrouillonPartages,
  gerables: ReadonlySet<string>,
): ChargePartages {
  const missions = Object.entries(b.missions)
    .filter(([id]) => gerables.has(id))
    .sort(([a], [z]) => a.localeCompare(z))
    .map(([mission_id, o]) => ({ mission_id, jalons: o.jalons, factures: o.factures }));
  const partagees = new Set(missions.map((m) => m.mission_id));
  const documents = Object.entries(b.documents)
    .filter(([, mission]) => partagees.has(mission))
    .map(([id]) => id)
    .sort();
  const charge: ChargePartages = { missions, documents };
  if (b.contact !== initial.contact)
    charge.contact_principal_id = b.contact === "" ? null : b.contact;
  return charge;
}

// --- Contact principal -----------------------------------------------------------------------

/** Personnes proposables comme contact principal, plus le contact actuel s'il n'y figure pas. */
export function optionsContactPrincipal(
  personnes: readonly Personne[],
  actuel: { id: string; nom: string } | null,
): { valeur: string; libelle: string }[] {
  const options = optionsPersonnes(personnes);
  if (actuel && !options.some((o) => o.valeur === actuel.id)) {
    options.unshift({ valeur: actuel.id, libelle: actuel.nom });
  }
  return options;
}

// --- Résumé « ce que voit votre client » --------------------------------------------------------

export interface ResumeMissionPartagee {
  id: string;
  intitule: string;
  jalons: boolean;
  factures: boolean;
  documents: number;
}

export interface ResumePartagesClient {
  /** Aucune mission partagée : le client ne voit rien de vos missions. */
  rien: boolean;
  contact: string | null;
  missions: ResumeMissionPartagee[];
  documents: number;
}

export function resumePartages(p: PartagesClient): ResumePartagesClient {
  const parMission = new Map<string, number>();
  for (const d of p.documents)
    parMission.set(d.mission_id, (parMission.get(d.mission_id) ?? 0) + 1);
  const missions = [...p.missions]
    .sort((a, b) => a.intitule.localeCompare(b.intitule, "fr"))
    .map((m) => ({
      id: m.mission_id,
      intitule: m.intitule,
      jalons: m.jalons,
      factures: m.factures,
      documents: parMission.get(m.mission_id) ?? 0,
    }));
  return {
    rien: missions.length === 0,
    contact: p.contact_principal?.nom ?? null,
    missions,
    documents: p.documents.length,
  };
}

export const pluriel = (n: number, singulier: string, plurielForme: string) =>
  `${n} ${n > 1 ? plurielForme : singulier}`;

/** Ce que le client voit d'une mission partagée, en une phrase. */
export function detailMissionPartagee(m: ResumeMissionPartagee): string {
  const elements = ["intitulé, statut et dates"];
  if (m.jalons) elements.push("jalons");
  if (m.factures) elements.push("factures émises");
  if (m.documents > 0) elements.push(pluriel(m.documents, "document", "documents"));
  return elements.join(" · ");
}

/** Phrase de synthèse annoncée après l'enregistrement des partages. */
export function phraseResume(r: ResumePartagesClient): string {
  if (r.rien) return "Votre client ne voit plus aucune mission.";
  return `Votre client voit ${pluriel(r.missions.length, "mission", "missions")} et ${pluriel(r.documents, "document", "documents")}.`;
}

// --- Erreurs ---------------------------------------------------------------------------------

export type ActionPortail =
  "invitation" | "revocation" | "desactivation" | "reactivation" | "partages";

export const MESSAGE_CLIENT_NON_GERE =
  "Vous ne gérez pas le portail de ce client : il faut être associé, directeur de mission, ou diriger l'une de ses missions (directeur ou chef de mission).";

/** Message français d'un refus de l'API sur une action de gestion du portail. */
export function messageErreurPortailGestion(e: unknown, action: ActionPortail): string {
  if (!(e instanceof ErreurApi) || e.code === CODE_TFA_A_CONFIGURER) return messageErreur(e);
  if (e.statut === 403) {
    return action === "partages"
      ? "Une mission cochée n'est pas sous votre responsabilité : seuls son directeur, son chef de mission ou un associé en modifient les partages. Rechargez la page."
      : MESSAGE_CLIENT_NON_GERE;
  }
  if (e.statut === 404) {
    if (action === "revocation")
      return "Cette invitation n'est plus en attente : elle a été acceptée, a expiré ou a déjà été révoquée. Rechargez la page.";
    if (action === "desactivation" || action === "reactivation")
      return "Cet utilisateur du portail est introuvable. Rechargez la page.";
    return "Ce client est introuvable.";
  }
  if (e.code === "PORTAIL_PARTAGE_INVALIDE")
    return "Un élément coché n'est plus partageable (document remplacé ou contenu IA non validé). Rechargez la page.";
  return messageErreur(e);
}

// --- Politique de double authentification du portail ---------------------------------------

export const estRefusTfaInactive = (e: unknown) =>
  e instanceof ErreurApi && e.code === "TFA_INACTIVE";

export type ChargePolitiquePortail = {
  tfa_obligatoire: boolean;
  mot_de_passe: string;
} & Partial<ChargeFacteur>;

/**
 * Corps de `PUT /api/portail/parametres` : action à fort impact, mot de passe ET second
 * facteur. Sans 2FA active, le mot de passe seul part et l'API répond 409 TFA_INACTIVE.
 */
export function validerPolitiquePortail(
  tfaObligatoire: boolean,
  s: SaisieConfirmation,
  tfaActive: boolean,
): Resultat<ChargePolitiquePortail, ChampConfirmation> {
  const c = tfaActive ? validerConfirmation(s) : validerReconfirmation(s);
  if (!c.ok) return { ok: false, erreurs: c.erreurs };
  return { ok: true, charge: { tfa_obligatoire: tfaObligatoire, ...c.charge } };
}

/** Message d'un refus de la politique du portail (identité, 2FA de l'auteur inactive). */
export function messagePolitiquePortail(e: unknown, facteur: FacteurSaisi): string | null {
  return messageReconfirmation(e, facteur);
}

export const libellePolitiquePortail = (tfaObligatoire: boolean) =>
  tfaObligatoire ? "Exigée" : "Facultative";
