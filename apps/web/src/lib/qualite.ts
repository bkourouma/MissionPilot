/**
 * Qualité et responsabilité professionnelle (QUA-01 à QUA-04, QUA-06 à QUA-08) : types des
 * réponses de l'API, libellés, chemins, validations de saisie et droits d'affichage. Logique
 * pure, testée dans `qualite.test.ts`.
 *
 * RÈGLE : la garde de chaque classe, la séparation des tâches, la définition de terminé et le
 * NPS sont jugés ou calculés par l'API (moteur `evaluerGarde`, contrôles déterministes,
 * `syntheseNps`). Ce module n'en recalcule rien : il met en forme ce que l'API renvoie. Les
 * droits ci-dessous sont un confort d'affichage ; l'API reste seule juge.
 */
import {
  aPermission,
  CLASSE_RISQUE_LIBELLES,
  CLASSES_RISQUE,
  DECISION_ACCEPTATION_LIBELLES,
  ETAPE_GARDE_LIBELLES,
  FACTEURS_RISQUE_CLIENT,
  KIND_ELEMENT_LIBELLES,
  NIVEAU_RISQUE_LIBELLES,
  STATUT_SUIVI_LIBELLES,
  STATUT_VERIFICATION_LIBELLES,
  TYPE_LIVRABLE_LIBELLES,
  TYPES_LIVRABLE,
  STATUTS_SUIVI,
  type ClasseRisque,
  type DecisionAcceptation,
  type EtapeGardeQualite,
  type KindElementRevue,
  type NiveauRisqueClient,
  type Role,
  type StatutSuivi,
  type StatutVerification,
  type TypeLivrable,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import type { Resultat } from "./saisie";

// --- Types des réponses de l'API -------------------------------------------------------------

export interface SuiviResume {
  id: string;
  mission_id: string;
  mission_intitule: string;
  type_livrable: TypeLivrable;
  libelle: string;
  version: number;
  classe: ClasseRisque;
  statut: StatutSuivi;
  elements_obligatoires: number;
  elements_vus_par_moi: number;
  validations_faites: number;
  ouvert_le: string;
}

export interface PageSuivis {
  elements: SuiviResume[];
  curseur_suivant: string | null;
}

export interface Suivi {
  id: string;
  mission_id: string;
  type_livrable: TypeLivrable;
  livrable_id: string;
  libelle: string;
  version: number;
  classe_minimale: ClasseRisque;
  classe: ClasseRisque;
  statut: StatutSuivi;
  auteur_id: string | null;
  ouvert_le: string;
}

export type CodeViolation =
  "AUTEUR_ATTENDU" | "CUMUL_INTERDIT" | "QUATRE_YEUX" | "ETAPE_EN_DOUBLE" | "ACTEUR_NON_HABILITE";

export interface Violation {
  code: CodeViolation;
  roles: string[];
  acteur: string;
}

export interface GardeSuivi {
  classe: ClasseRisque;
  automatique: boolean;
  etapes_requises: EtapeGardeQualite[];
  etapes_faites: EtapeGardeQualite[];
  manquantes: EtapeGardeQualite[];
  prochaine_etape: EtapeGardeQualite | null;
  violations: Violation[];
  peut_valider_prochaine_etape: boolean;
}

export interface ValidationSuivi {
  etape: EtapeGardeQualite;
  acteur_id: string;
  acteur_nom: string | null;
  commentaire: string | null;
  valide_le: string;
}

export interface ItemDefinition {
  id: string;
  code: string;
  libelle: string;
  controle: string;
  obligatoire: boolean;
  statut: StatutVerification | "en_attente";
  detail: string | null;
  satisfait: boolean;
}

export interface DefinitionSuivi {
  definition_id: string | null;
  libelle: string | null;
  version: number | null;
  items: ItemDefinition[];
  satisfaite: boolean;
  bloquants: string[];
}

export interface ElementRevue {
  id: string;
  cle: string;
  kind: KindElementRevue;
  libelle: string;
  obligatoire: boolean;
  source: string | null;
  reference: string | null;
  vu_par_moi: boolean;
  vu_le: string | null;
  nb_vus: number;
}

export interface Parcours {
  obligatoires: number;
  vus: number;
  restants: number;
  complet: boolean;
}

export interface SessionRevue {
  id: string;
  utilisateur_id: string;
  debut: string;
  fin: string | null;
  duree_secondes: number | null;
}

export interface TempsRevue {
  sessions: SessionRevue[];
  synthese: {
    sessions: number;
    totalSecondes: number;
    medianeSecondes: number;
    maxSecondes: number;
  };
}

export interface SignatureSuivi {
  signataire_nom: string | null;
  qualite: string;
  version: number;
  empreinte_sha256: string;
  portee_empreinte: "contenu" | "dossier_qualite";
  mention_ia: string | null;
  signe_le: string;
}

export interface EvenementSuivi {
  rang: number;
  action: string;
  par_nom: string | null;
  le: string;
}

export interface DetailSuivi {
  suivi: Suivi;
  mission: { id: string; intitule: string };
  garde: GardeSuivi;
  validations: ValidationSuivi[];
  definition: DefinitionSuivi;
  elements: ElementRevue[];
  parcours: Parcours;
  temps_revue: TempsRevue;
  signature: SignatureSuivi | null;
  evenements: EvenementSuivi[];
}

export interface Conflit {
  relation_id: string;
  nature: string;
  client_lie_id: string;
  client_lie_nom: string;
  missions_en_cours: number;
  note: string | null;
}

export interface Acceptation {
  id: string;
  rang: number;
  conflits: Conflit[];
  profil_risque: {
    facteurs: string[];
    niveau_calcule: NiveauRisqueClient;
    niveau_retenu: NiveauRisqueClient;
  };
  niveau_risque: NiveauRisqueClient;
  decision: DecisionAcceptation;
  motif: string | null;
  evalue_par_nom: string | null;
  evalue_le: string;
}

export interface VueAcceptation {
  derniere: Acceptation | null;
  historique: Acceptation[];
  conflits_actuels: Conflit[];
}

export interface SyntheseNps {
  total: number;
  promoteurs: number;
  passifs: number;
  detracteurs: number;
  nps: string | null;
}

export interface NoteSatisfaction {
  id: string;
  moment: "jalon" | "cloture";
  jalon_libelle: string | null;
  rang: number;
  note: number;
  commentaire: string | null;
  repondant: string | null;
  saisi_le: string;
}

export interface VueSatisfactions {
  notes: NoteSatisfaction[];
  synthese: SyntheseNps;
}

export interface SyntheseCabinet {
  synthese: SyntheseNps;
  missions: (SyntheseNps & { mission_id: string; mission_intitule: string })[];
  tronque: boolean;
}

// --- Libellés et tonalités -------------------------------------------------------------------

export const libelleClasse = (c: ClasseRisque) => `${c} · ${CLASSE_RISQUE_LIBELLES[c]}`;
export const libelleStatutSuivi = (s: StatutSuivi) => STATUT_SUIVI_LIBELLES[s];
export const libelleType = (t: TypeLivrable) => TYPE_LIVRABLE_LIBELLES[t];
export const libelleEtape = (e: EtapeGardeQualite) => ETAPE_GARDE_LIBELLES[e];
export const libelleKind = (k: KindElementRevue) => KIND_ELEMENT_LIBELLES[k];
export const libelleDecision = (d: DecisionAcceptation) => DECISION_ACCEPTATION_LIBELLES[d];
export const libelleNiveauRisque = (n: NiveauRisqueClient) => NIVEAU_RISQUE_LIBELLES[n];

export function libelleVerification(s: StatutVerification | "en_attente"): string {
  return s === "en_attente" ? "À vérifier" : STATUT_VERIFICATION_LIBELLES[s];
}

export function tonaliteStatutSuivi(s: StatutSuivi): TonaliteStatut {
  return s === "signe" || s === "valide" ? "succes" : s === "en_revue" ? "attention" : "neutre";
}

export function tonaliteClasse(c: ClasseRisque): TonaliteStatut {
  return c === "R3" ? "danger" : c === "R2" ? "attention" : "neutre";
}

export function tonaliteVerification(s: StatutVerification | "en_attente"): TonaliteStatut {
  if (s === "conforme" || s === "atteste") return "succes";
  if (s === "non_conforme") return "danger";
  return "attention";
}

export function tonaliteNiveauRisque(n: NiveauRisqueClient): TonaliteStatut {
  return n === "eleve" ? "danger" : n === "moyen" ? "attention" : "succes";
}

const LIBELLES_VIOLATION: Record<CodeViolation, string> = {
  AUTEUR_ATTENDU: "La validation de l'auteur revient à l'auteur du contenu.",
  CUMUL_INTERDIT: "Une même personne ne peut pas cumuler ces deux rôles.",
  QUATRE_YEUX: "Quatre yeux : le second expert doit être distinct de l'auteur et du valideur.",
  ETAPE_EN_DOUBLE: "Cette étape a déjà été franchie.",
  ACTEUR_NON_HABILITE: "Vous n'êtes pas habilité à tenir ce rôle sur cette mission.",
};

export const libelleViolation = (v: Violation) =>
  LIBELLES_VIOLATION[v.code] ?? "Garde non respectée.";

export const NATURES_CONFLIT: Record<string, string> = {
  meme_groupe: "Même groupe",
  investisseur_cible: "Investisseur et société cible",
  concurrent: "Concurrent déclaré",
};
export const libelleNatureConflit = (n: string) => NATURES_CONFLIT[n] ?? n;

/** « 3 sur 5 » : progression du parcours de revue (les nombres viennent de l'API). */
export function texteParcours(p: Parcours): string {
  if (p.obligatoires === 0) return "Aucun élément obligatoire à parcourir";
  return `${p.vus} sur ${p.obligatoires} parcourus`;
}

/** Durée en secondes → « 1 h 05 min », « 12 min 30 s », « 45 s ». Mise en forme seulement. */
export function formaterDuree(secondes: number): string {
  const s = Math.max(0, Math.trunc(secondes));
  if (s < 60) return `${s} s`;
  const minutes = Math.trunc(s / 60);
  if (minutes < 60) {
    const reste = s % 60;
    return reste === 0 ? `${minutes} min` : `${minutes} min ${String(reste).padStart(2, "0")} s`;
  }
  return `${Math.trunc(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Empreinte abrégée pour l'affichage (la valeur complète reste en `title`). */
export function empreinteCourte(e: string): string {
  return e.length > 16 ? `${e.slice(0, 8)}…${e.slice(-8)}` : e;
}

/** NPS « -33.3 » de l'API → affichage français « −33,3 » ; absence → « — ». */
export function formaterNps(nps: string | null): string {
  if (nps === null) return "—";
  return nps.replace("-", "−").replace(".", ",");
}

// --- Erreurs ---------------------------------------------------------------------------------

/** Codes de l'API dont le message (français, explicite) est affiché tel quel. */
const CODES_MESSAGE_API = new Set([
  "GARDE_VIOLEE",
  "PARCOURS_INCOMPLET",
  "DEFINITION_NON_SATISFAITE",
  "SUIVI_NON_EN_REVUE",
  "SUIVI_NON_VALIDE",
  "SUIVI_EXISTANT",
  "CLASSE_SOUS_MINIMALE",
  "CLASSE_ABAISSEE",
  "SIGNATURE_NON_APPLICABLE",
  "MOTIF_CONFLIT_REQUIS",
  "CLOTURE_NON_ATTEINTE",
  "RELATION_EN_DOUBLE",
  "SESSION_OUVERTE",
]);

export const MESSAGE_INTROUVABLE_QUALITE =
  "Ce livrable ou cette mission n'est plus accessible. Actualisez la page.";

export function messageQualite(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_QUALITE;
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatQualiteChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Droits d'affichage ----------------------------------------------------------------------

export interface DroitsQualite {
  consulter: boolean;
  relire: boolean;
  signer: boolean;
  associe: boolean;
}

export function droitsQualite(roles: readonly Role[]): DroitsQualite {
  return {
    consulter: aPermission(roles, "mission.lire"),
    relire: aPermission(roles, "qualite.relire"),
    signer: aPermission(roles, "qualite.signer"),
    associe: roles.includes("associe"),
  };
}

// --- Chemins ---------------------------------------------------------------------------------

const segment = (id: string) => encodeURIComponent(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export interface FiltresQualite {
  statut: StatutSuivi | "";
  curseur: string;
  /** Mission dont on suit les livrables (UUID) ; vide : toutes les missions visibles. */
  mission: string;
}

export function lireFiltresQualite(
  p: Record<string, string | string[] | undefined>,
): FiltresQualite {
  const s = un(p.statut) ?? "";
  const c = un(p.curseur) ?? "";
  const m = un(p.mission) ?? "";
  return {
    statut: (STATUTS_SUIVI as readonly string[]).includes(s) ? (s as StatutSuivi) : "",
    curseur: /^[A-Za-z0-9_-]{1,500}$/.test(c) ? c : "",
    mission: UUID.test(m) ? m : "",
  };
}

export function cheminSuivis(f: Omit<FiltresQualite, "mission"> & { mission?: string }): string {
  const r = new URLSearchParams({ limite: "30" });
  if (f.mission) r.set("mission_id", f.mission);
  if (f.statut) r.set("statut", f.statut);
  if (f.curseur) r.set("curseur", f.curseur);
  return `/api/qualite/suivis?${r.toString()}`;
}

export function hrefQualite(f: Partial<FiltresQualite> = {}): string {
  const r = new URLSearchParams();
  if (f.mission) r.set("mission", f.mission);
  if (f.statut) r.set("statut", f.statut);
  if (f.curseur) r.set("curseur", f.curseur);
  const s = r.toString();
  return s ? `/qualite?${s}` : "/qualite";
}

/** Suivi qualité des livrables d'une mission (onglet « Qualité » de la mission). */
export const hrefQualiteMission = (missionId: string) => hrefQualite({ mission: missionId });

export const hrefSuivi = (id: string) => `/qualite/${segment(id)}`;
export const hrefAcceptation = (missionId: string) => `/qualite/acceptation/${segment(missionId)}`;
export const hrefSatisfaction = (missionId: string) =>
  `/qualite/satisfaction/${segment(missionId)}`;
export const cheminSuivi = (id: string) => `/api/qualite/suivis/${segment(id)}`;
export const cheminActionSuivi = (id: string, action: string) => `${cheminSuivi(id)}/${action}`;
export const cheminVu = (suiviId: string, elementId: string) =>
  `${cheminSuivi(suiviId)}/elements/${segment(elementId)}/vu`;
export const cheminAttestation = (suiviId: string, itemId: string) =>
  `${cheminSuivi(suiviId)}/verification/${segment(itemId)}/attestation`;
export const cheminTerminerSession = (id: string) =>
  `/api/qualite/sessions/${segment(id)}/terminer`;
export const cheminAcceptation = (missionId: string) =>
  `/api/qualite/missions/${segment(missionId)}/acceptation`;
export const cheminSatisfactions = (missionId: string) =>
  `/api/qualite/missions/${segment(missionId)}/satisfactions`;

// --- Validations de saisie -------------------------------------------------------------------

export const COMMENTAIRE_MAX = 2000;
export const LIBELLE_MAX = 200;

export interface SaisieOuverture {
  mission_id: string;
  type_livrable: string;
  livrable_id: string;
  libelle: string;
  classe: string;
}

export type ChargeOuverture = {
  mission_id: string;
  type_livrable: TypeLivrable;
  livrable_id: string;
  libelle: string;
  classe?: ClasseRisque;
};

/** Ouverture d'un suivi : un livrable « autre » reçoit un identifiant généré par l'appelant. */
export function validerOuverture(
  s: SaisieOuverture,
  genererId: () => string,
): Resultat<ChargeOuverture, keyof SaisieOuverture> {
  const erreurs: Partial<Record<keyof SaisieOuverture, string>> = {};
  if (!UUID.test(s.mission_id)) erreurs.mission_id = "Choisissez la mission du livrable.";
  if (!(TYPES_LIVRABLE as readonly string[]).includes(s.type_livrable)) {
    erreurs.type_livrable = "Choisissez le type de livrable.";
  }
  const libelle = s.libelle.trim();
  if (libelle === "") erreurs.libelle = "Donnez un nom au livrable.";
  else if (libelle.length > LIBELLE_MAX) {
    erreurs.libelle = `Le nom ne doit pas dépasser ${LIBELLE_MAX} caractères.`;
  }
  const id = s.livrable_id.trim();
  const identifiantGenere = s.type_livrable === "autre" && id === "";
  if (!identifiantGenere && !UUID.test(id)) {
    erreurs.livrable_id = "Saisissez l'identifiant du livrable (UUID affiché par son module).";
  }
  if (s.classe !== "" && !(CLASSES_RISQUE as readonly string[]).includes(s.classe)) {
    erreurs.classe = "Classe inconnue.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      mission_id: s.mission_id,
      type_livrable: s.type_livrable as TypeLivrable,
      livrable_id: id === "" ? genererId() : id,
      libelle,
      ...(s.classe ? { classe: s.classe as ClasseRisque } : {}),
    },
  };
}

export function validerCommentaire(
  texte: string,
  { obligatoire }: { obligatoire: boolean },
): Resultat<{ commentaire: string | null }, "commentaire"> {
  const t = texte.trim();
  if (obligatoire && t === "") {
    return { ok: false, erreurs: { commentaire: "Un commentaire motivé est obligatoire." } };
  }
  if (t.length > COMMENTAIRE_MAX) {
    return {
      ok: false,
      erreurs: {
        commentaire: `Le commentaire ne doit pas dépasser ${COMMENTAIRE_MAX} caractères.`,
      },
    };
  }
  return { ok: true, charge: { commentaire: t === "" ? null : t } };
}

export function validerRelevement(
  classe: string,
  motif: string,
  actuelle: ClasseRisque,
): Resultat<{ classe: ClasseRisque; motif: string }, "classe" | "motif"> {
  const erreurs: Partial<Record<"classe" | "motif", string>> = {};
  const rang = (CLASSES_RISQUE as readonly string[]).indexOf(classe);
  if (rang < 0) erreurs.classe = "Choisissez la nouvelle classe.";
  else if (rang <= CLASSES_RISQUE.indexOf(actuelle)) {
    erreurs.classe = "La classe se relève : choisissez une classe supérieure à l'actuelle.";
  }
  if (motif.trim() === "") erreurs.motif = "Indiquez pourquoi la classe est relevée.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { classe: classe as ClasseRisque, motif: motif.trim() } };
}

export interface SaisieAcceptation {
  facteurs: string[];
  niveau_retenu: string;
  decision: string;
  motif: string;
}

export function validerAcceptation(
  s: SaisieAcceptation,
  { conflits }: { conflits: number },
): Resultat<
  {
    facteurs: string[];
    niveau_retenu?: NiveauRisqueClient;
    decision: DecisionAcceptation;
    motif: string | null;
  },
  "decision" | "motif" | "niveau_retenu"
> {
  const erreurs: Partial<Record<"decision" | "motif" | "niveau_retenu", string>> = {};
  const decisions = Object.keys(DECISION_ACCEPTATION_LIBELLES);
  if (!decisions.includes(s.decision)) erreurs.decision = "Choisissez une décision.";
  const motif = s.motif.trim();
  const exigeMotif =
    s.decision === "refusee" ||
    s.decision === "acceptee_sous_conditions" ||
    (s.decision === "acceptee" && conflits > 0);
  if (exigeMotif && motif === "") {
    erreurs.motif =
      s.decision === "acceptee"
        ? "Un conflit d'intérêts est détecté : motivez l'acceptation."
        : "Un motif est obligatoire pour refuser ou accepter sous conditions.";
  }
  if (motif.length > COMMENTAIRE_MAX) {
    erreurs.motif = `Le motif ne doit pas dépasser ${COMMENTAIRE_MAX} caractères.`;
  }
  if (s.niveau_retenu !== "" && !(s.niveau_retenu in NIVEAU_RISQUE_LIBELLES)) {
    erreurs.niveau_retenu = "Niveau inconnu.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      facteurs: s.facteurs.filter((f) => FACTEURS_RISQUE_CLIENT.some((x) => x.code === f)),
      ...(s.niveau_retenu ? { niveau_retenu: s.niveau_retenu as NiveauRisqueClient } : {}),
      decision: s.decision as DecisionAcceptation,
      motif: motif === "" ? null : motif,
    },
  };
}

export interface SaisieSatisfaction {
  moment: string;
  jalon_id: string;
  note: string;
  commentaire: string;
  repondant: string;
}

export function validerSatisfaction(s: SaisieSatisfaction): Resultat<
  {
    moment: "jalon" | "cloture";
    jalon_id?: string;
    note: number;
    commentaire: string | null;
    repondant: string | null;
  },
  "moment" | "jalon_id" | "note" | "commentaire"
> {
  const erreurs: Partial<Record<"moment" | "jalon_id" | "note" | "commentaire", string>> = {};
  if (s.moment !== "jalon" && s.moment !== "cloture") erreurs.moment = "Choisissez le moment.";
  if (s.moment === "jalon" && !UUID.test(s.jalon_id)) erreurs.jalon_id = "Choisissez le jalon.";
  const note = s.note.trim() === "" ? Number.NaN : Number(s.note.trim());
  if (!Number.isInteger(note) || note < 0 || note > 10) {
    erreurs.note = "La note est un entier de 0 à 10.";
  }
  if (s.commentaire.trim().length > COMMENTAIRE_MAX) {
    erreurs.commentaire = `Le commentaire ne doit pas dépasser ${COMMENTAIRE_MAX} caractères.`;
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const commentaire = s.commentaire.trim();
  const repondant = s.repondant.trim();
  return {
    ok: true,
    charge: {
      moment: s.moment as "jalon" | "cloture",
      ...(s.moment === "jalon" ? { jalon_id: s.jalon_id } : {}),
      note,
      commentaire: commentaire === "" ? null : commentaire,
      repondant: repondant === "" ? null : repondant.slice(0, 200),
    },
  };
}

/** Violations de garde jointes à un refus 409 `GARDE_VIOLEE` (`erreur.details.violations`). */
export function violationsDeErreur(e: unknown): Violation[] {
  if (!(e instanceof ErreurApi) || e.code !== "GARDE_VIOLEE") return [];
  const d = e.details as { violations?: unknown } | undefined;
  if (!d || !Array.isArray(d.violations)) return [];
  return d.violations.filter(
    (v): v is Violation =>
      typeof v === "object" && v !== null && typeof (v as { code?: unknown }).code === "string",
  );
}
