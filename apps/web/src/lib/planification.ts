/**
 * Planification (PLN-04, PLN-06 à PLN-10) : types des réponses de l'API, validations des
 * formulaires et règles d'affichage des actions. Logique pure, testée dans
 * `planification.test.ts`. Aucun coût ni taux : l'API n'en renvoie aucun dans ce module.
 */
import { aPermission, creerTraduire, type Langue, type Role } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { NomIcone } from "../components/ui/Icone";
import { lireNombre, texteOuNull, type Resultat } from "./saisie";
import { ajouterJoursIso, estDateIso } from "./semaine";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const uuidOuVide = (v: string | undefined) => (v && UUID.test(v) ? v : "");

// --- Mon planning (PLN-10) -------------------------------------------------------------------

export interface LigneMonPlanning {
  affectation_id: string;
  mission: { id: string; intitule: string | null; statut: string | null; accessible: boolean };
  tache: { id: string; libelle: string | null; phase_libelle: string | null };
  jours_alloues_semaine: number;
  affectation: { jours_alloues: number; date_debut: string; date_fin: string };
}

export interface MonPlanning {
  semaine: { debut: string; fin: string };
  collaborateur: { id: string; nom: string } | null;
  lignes: LigneMonPlanning[];
  absences: {
    id: string;
    type: TypeAbsence;
    statut: StatutAbsence;
    date_debut: string;
    date_fin: string;
  }[];
  feries: { date: string; libelle: string }[];
  capacite: number | null;
  jours_affectes: number;
}

/** Lignes de « Mon planning » groupées par mission, dans l'ordre de l'API. */
export function groupesParMission(
  lignes: readonly LigneMonPlanning[],
  langue: Langue = "fr",
): { cle: string; intitule: string; accessible: boolean; lignes: LigneMonPlanning[] }[] {
  const groupes = new Map<
    string,
    { cle: string; intitule: string; accessible: boolean; lignes: LigneMonPlanning[] }
  >();
  for (const l of lignes) {
    const g = groupes.get(l.mission.id) ?? {
      cle: l.mission.id,
      intitule:
        l.mission.intitule ??
        (langue === "en" ? "Engagement not accessible" : "Mission non accessible"),
      accessible: l.mission.accessible,
      lignes: [],
    };
    g.lignes.push(l);
    groupes.set(l.mission.id, g);
  }
  return [...groupes.values()];
}

// --- Congés et absences (PLN-07) ----------------------------------------------------------

export const TYPES_ABSENCE = ["conge_paye", "maladie", "formation", "autre"] as const;
export type TypeAbsence = (typeof TYPES_ABSENCE)[number];
export type StatutAbsence = "demandee" | "validee" | "refusee" | "annulee";

export const TYPE_ABSENCE_LIBELLES: Record<TypeAbsence, string> = {
  conge_paye: "Congé payé",
  maladie: "Maladie",
  formation: "Formation",
  autre: "Autre absence",
};

export const TYPE_ABSENCE_LIBELLES_EN: Record<TypeAbsence, string> = {
  conge_paye: "Paid leave",
  maladie: "Sick leave",
  formation: "Training",
  autre: "Other absence",
};

export const optionsTypesAbsence = (langue: Langue = "fr") =>
  TYPES_ABSENCE.map((t) => ({
    valeur: t,
    libelle: (langue === "en" ? TYPE_ABSENCE_LIBELLES_EN : TYPE_ABSENCE_LIBELLES)[t],
  }));

export const OPTIONS_TYPES_ABSENCE = TYPES_ABSENCE.map((t) => ({
  valeur: t,
  libelle: TYPE_ABSENCE_LIBELLES[t],
}));

export const STATUT_ABSENCE: Record<StatutAbsence, { libelle: string; tonalite: TonaliteStatut }> =
  {
    demandee: { libelle: "En attente de validation", tonalite: "attention" },
    validee: { libelle: "Validée", tonalite: "succes" },
    refusee: { libelle: "Refusée", tonalite: "danger" },
    annulee: { libelle: "Annulée", tonalite: "neutre" },
  };

const STATUT_ABSENCE_EN: Record<StatutAbsence, string> = {
  demandee: "Pending approval",
  validee: "Approved",
  refusee: "Rejected",
  annulee: "Cancelled",
};

export const presentationStatutAbsence = (s: StatutAbsence, langue: Langue = "fr") =>
  langue === "en" ? { ...STATUT_ABSENCE[s], libelle: STATUT_ABSENCE_EN[s] } : STATUT_ABSENCE[s];

export interface Absence {
  id: string;
  collaborateur_id: string;
  collaborateur_nom: string;
  demandeur_id: string;
  type: TypeAbsence;
  date_debut: string;
  date_fin: string;
  commentaire: string | null;
  statut: StatutAbsence;
  motif_refus: string | null;
  decide_par: string | null;
  decide_le: string | null;
  annulee_le: string | null;
  cree_le: string;
}

export interface SaisieAbsence {
  type: string;
  date_debut: string;
  date_fin: string;
  commentaire: string;
}

export const SAISIE_ABSENCE_VIDE: SaisieAbsence = {
  type: "conge_paye",
  date_debut: "",
  date_fin: "",
  commentaire: "",
};

export function validerAbsence(
  s: SaisieAbsence,
  langue: Langue = "fr",
): Resultat<
  { type: TypeAbsence; date_debut: string; date_fin: string; commentaire: string | null },
  keyof SaisieAbsence
> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieAbsence, string>> = {};
  if (!(TYPES_ABSENCE as readonly string[]).includes(s.type))
    erreurs.type = t("Choisissez le type d'absence.", "Choose the absence type.");
  if (!estDateIso(s.date_debut))
    erreurs.date_debut = t("Indiquez la date de début.", "Enter the start date.");
  if (!estDateIso(s.date_fin))
    erreurs.date_fin = t("Indiquez la date de fin.", "Enter the end date.");
  if (!erreurs.date_debut && !erreurs.date_fin) {
    if (s.date_fin < s.date_debut)
      erreurs.date_fin = t(
        "La date de fin précède la date de début.",
        "The end date is before the start date.",
      );
    else if (ajouterJoursIso(s.date_debut, 366) < s.date_fin)
      erreurs.date_fin = t("Une absence dure au plus un an.", "An absence lasts at most one year.");
  }
  const commentaire = s.commentaire.trim();
  if (commentaire.length > 500)
    erreurs.commentaire = t("500 caractères au plus.", "500 characters at most.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      type: s.type as TypeAbsence,
      date_debut: s.date_debut,
      date_fin: s.date_fin,
      commentaire: texteOuNull(commentaire),
    },
  };
}

/** Le demandeur annule une absence demandée ou validée qui n'a pas commencé. */
export function peutAnnulerAbsence(
  a: Pick<Absence, "statut" | "date_debut" | "demandeur_id">,
  utilisateurId: string,
  aujourdhui: string,
): boolean {
  return (
    a.demandeur_id === utilisateurId &&
    (a.statut === "demandee" || a.statut === "validee") &&
    a.date_debut > aujourdhui
  );
}

/** Un valideur décide d'une demande en attente, jamais de la sienne. */
export function peutDeciderAbsence(
  a: Pick<Absence, "statut" | "demandeur_id">,
  roles: readonly Role[],
  utilisateurId: string,
): boolean {
  return (
    aPermission(roles, "conges.valider") &&
    a.statut === "demandee" &&
    a.demandeur_id !== utilisateurId
  );
}

// --- Affectations (PLN-04, PLN-08) ------------------------------------------------------------

export interface Affectation {
  id: string;
  mission_id: string;
  tache_id: string;
  tache_libelle: string;
  phase_id: string;
  collaborateur_id: string | null;
  collaborateur_nom: string | null;
  collaborateur_type: "interne" | "externe" | "sous_traitant" | null;
  grade_id: string | null;
  grade_code: string | null;
  grade_libelle: string | null;
  competence: string | null;
  a_pourvoir: boolean;
  jours_alloues: number;
  date_debut: string;
  date_fin: string;
}

export interface AvertissementAffectation {
  code: string;
  message: string;
}

export interface ReponseAffectation {
  affectation: Affectation;
  avertissements: AvertissementAffectation[];
}

export interface SaisieAffectation {
  tache_id: string;
  mode: "nominative" | "profil";
  collaborateur_id: string;
  grade_id: string;
  competence: string;
  jours_alloues: string;
  date_debut: string;
  date_fin: string;
}

export type ChampAffectation = keyof SaisieAffectation;

export const SAISIE_AFFECTATION_VIDE: SaisieAffectation = {
  tache_id: "",
  mode: "nominative",
  collaborateur_id: "",
  grade_id: "",
  competence: "",
  jours_alloues: "",
  date_debut: "",
  date_fin: "",
};

export function saisieDepuisAffectation(a: Affectation): SaisieAffectation {
  return {
    tache_id: a.tache_id,
    mode: a.a_pourvoir ? "profil" : "nominative",
    collaborateur_id: a.collaborateur_id ?? "",
    grade_id: a.grade_id ?? "",
    competence: a.competence ?? "",
    jours_alloues: String(a.jours_alloues).replace(".", ","),
    date_debut: a.date_debut,
    date_fin: a.date_fin,
  };
}

export interface ChargeAffectation {
  tache_id: string;
  collaborateur_id?: string;
  profil?: { grade_id: string; competence: string | null };
  jours_alloues: number;
  date_debut: string;
  date_fin: string;
}

function validerPeriodeEtJours(
  s: SaisieAffectation,
  erreurs: Partial<Record<ChampAffectation, string>>,
  langue: Langue = "fr",
): number {
  const t = creerTraduire(langue);
  const jours = lireNombre(s.jours_alloues);
  if (jours === null)
    erreurs.jours_alloues = t("Indiquez les jours alloués.", "Enter the allocated days.");
  else if (Number.isNaN(jours) || jours <= 0)
    erreurs.jours_alloues = t(
      "Nombre de jours strictement positif (ex. 2,5).",
      "Strictly positive number of days (e.g. 2.5).",
    );
  else if (Math.abs(jours * 100 - Math.round(jours * 100)) > 1e-6)
    erreurs.jours_alloues = t("Deux décimales au plus.", "Two decimal places at most.");
  else if (jours > 9999) erreurs.jours_alloues = t("Valeur trop grande.", "Value too large.");
  if (!estDateIso(s.date_debut))
    erreurs.date_debut = t("Indiquez la date de début.", "Enter the start date.");
  if (!estDateIso(s.date_fin))
    erreurs.date_fin = t("Indiquez la date de fin.", "Enter the end date.");
  if (!erreurs.date_debut && !erreurs.date_fin) {
    if (s.date_fin < s.date_debut)
      erreurs.date_fin = t(
        "La date de fin précède la date de début.",
        "The end date is before the start date.",
      );
    else if (ajouterJoursIso(s.date_debut, 365) < s.date_fin)
      erreurs.date_fin = t(
        "Une affectation couvre au plus 366 jours.",
        "An assignment covers at most 366 days.",
      );
  }
  return jours ?? 0;
}

/** Création : nominative (collaborateur) ou profil à pourvoir (grade, compétence). */
export function validerAffectation(
  s: SaisieAffectation,
  langue: Langue = "fr",
): Resultat<ChargeAffectation, ChampAffectation> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampAffectation, string>> = {};
  if (!UUID.test(s.tache_id)) erreurs.tache_id = t("Choisissez la tâche.", "Choose the task.");
  if (s.mode === "nominative" && !UUID.test(s.collaborateur_id))
    erreurs.collaborateur_id = t("Choisissez la personne.", "Choose the person.");
  if (s.mode === "profil" && !UUID.test(s.grade_id))
    erreurs.grade_id = t("Choisissez le grade.", "Choose the grade.");
  const competence = s.competence.trim();
  if (s.mode === "profil" && competence.length > 80)
    erreurs.competence = t("80 caractères au plus.", "80 characters at most.");
  const jours = validerPeriodeEtJours(s, erreurs, langue);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      tache_id: s.tache_id,
      ...(s.mode === "nominative"
        ? { collaborateur_id: s.collaborateur_id }
        : { profil: { grade_id: s.grade_id, competence: texteOuNull(competence) } }),
      jours_alloues: jours,
      date_debut: s.date_debut,
      date_fin: s.date_fin,
    },
  };
}

/** Modification : tâche, jours et période (la personne ou le profil ne changent pas). */
export function validerModificationAffectation(
  s: SaisieAffectation,
  avant: Affectation,
  langue: Langue = "fr",
): Resultat<Partial<Omit<ChargeAffectation, "collaborateur_id" | "profil">>, ChampAffectation> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampAffectation, string>> = {};
  if (!UUID.test(s.tache_id)) erreurs.tache_id = t("Choisissez la tâche.", "Choose the task.");
  const jours = validerPeriodeEtJours(s, erreurs, langue);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: Partial<Omit<ChargeAffectation, "collaborateur_id" | "profil">> = {};
  if (s.tache_id !== avant.tache_id) charge.tache_id = s.tache_id;
  if (jours !== avant.jours_alloues) charge.jours_alloues = jours;
  if (s.date_debut !== avant.date_debut) charge.date_debut = s.date_debut;
  if (s.date_fin !== avant.date_fin) charge.date_fin = s.date_fin;
  if (Object.keys(charge).length === 0)
    return {
      ok: false,
      erreurs: { jours_alloues: t("Aucune modification à enregistrer.", "No changes to save.") },
    };
  return { ok: true, charge };
}

/**
 * Gestion des affectations d'une mission (miroir de `exigerMissionAffectable`) : permission
 * affectation.gerer, mission ouverte, et responsable de la mission ou lecteur de toutes les
 * missions (responsable des ressources).
 */
export function peutGererAffectations(
  m: { statut: string; directeur_id: string | null; chef_id: string | null },
  roles: readonly Role[],
  utilisateurId: string,
): boolean {
  if (!aPermission(roles, "affectation.gerer") || m.statut === "cloturee") return false;
  return (
    aPermission(roles, "mission.modifier_toutes") ||
    aPermission(roles, "mission.lire_toutes") ||
    m.directeur_id === utilisateurId ||
    m.chef_id === utilisateurId
  );
}

// --- Re-planification (PLN-09) -----------------------------------------------------------------

export interface ResultatReplanification {
  apercu: boolean;
  phase_id: string;
  decalage_jours_ouvres: number;
  taches: {
    id: string;
    libelle?: string;
    avant: { debut: string; fin: string };
    apres: { debut: string; fin: string };
  }[];
  affectations: {
    id: string;
    tache_id: string;
    collaborateur_id: string | null;
    avant: { debut: string; fin: string };
    apres: { debut: string; fin: string };
  }[];
  personnes: { collaborateur_id: string; nom: string | null; utilisateur_id: string | null }[];
  message?: string;
}

export function validerReplanification(
  phaseId: string,
  decalage: string,
  langue: Langue = "fr",
): Resultat<{ phase_id: string; decalage_jours_ouvres: number }, "phase_id" | "decalage"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"phase_id" | "decalage", string>> = {};
  if (!UUID.test(phaseId))
    erreurs.phase_id = t("Choisissez la phase à décaler.", "Choose the phase to shift.");
  const n = lireNombre(decalage);
  if (n === null)
    erreurs.decalage = t(
      "Indiquez le décalage en jours ouvrés.",
      "Enter the shift in business days.",
    );
  else if (Number.isNaN(n) || !Number.isInteger(n))
    erreurs.decalage = t(
      "Nombre entier de jours ouvrés (ex. 3 ou -2).",
      "Whole number of business days (e.g. 3 or -2).",
    );
  else if (n === 0)
    erreurs.decalage = t("Un décalage nul ne change rien.", "A zero shift changes nothing.");
  else if (Math.abs(n) > 260)
    erreurs.decalage = t(
      "260 jours ouvrés au plus, dans un sens ou l'autre.",
      "260 business days at most, in either direction.",
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { phase_id: phaseId, decalage_jours_ouvres: n as number } };
}

// --- Plan de charge (PLN-06) --------------------------------------------------------------------

export type EtatCharge = "surcharge" | "normal" | "sous_occupation" | "indisponible";

export const ETAT_CHARGE: Record<
  EtatCharge,
  { libelle: string; court: string; icone: NomIcone; tonalite: TonaliteStatut }
> = {
  surcharge: { libelle: "Surcharge", court: "Surcharge", icone: "flecheHaut", tonalite: "danger" },
  normal: { libelle: "Charge normale", court: "Normal", icone: "succes", tonalite: "succes" },
  sous_occupation: {
    libelle: "Sous-occupation",
    court: "Sous-occ.",
    icone: "flecheBas",
    tonalite: "attention",
  },
  indisponible: {
    libelle: "Indisponible (aucune capacité)",
    court: "Indispo.",
    icone: "neutre",
    tonalite: "neutre",
  },
};

const ETAT_CHARGE_EN: Record<EtatCharge, { libelle: string; court: string }> = {
  surcharge: { libelle: "Overload", court: "Overload" },
  normal: { libelle: "Normal workload", court: "Normal" },
  sous_occupation: { libelle: "Under-utilization", court: "Under-util." },
  indisponible: { libelle: "Unavailable (no capacity)", court: "Unavail." },
};

export const presentationEtatCharge = (e: EtatCharge, langue: Langue = "fr") =>
  langue === "en" ? { ...ETAT_CHARGE[e], ...ETAT_CHARGE_EN[e] } : ETAT_CHARGE[e];

export interface CelluleCharge {
  semaine: string;
  capacite: number;
  jours_affectes: number;
  taux_occupation: number | null;
  etat: EtatCharge;
}

export interface LignePlanDeCharge {
  collaborateur: {
    id: string;
    nom: string;
    type: "interne" | "externe" | "sous_traitant";
    capacite_pct: number;
    grade_id: string | null;
    grade_code: string | null;
    grade_libelle: string | null;
  };
  cellules: CelluleCharge[];
}

export interface PlanDeCharge {
  debut: string;
  fin: string;
  seuils: { surcharge_pct: number; sous_occupation_pct: number };
  semaines: string[];
  elements: LignePlanDeCharge[];
  curseur_suivant: string | null;
}

export interface Surcharges {
  debut: string;
  fin: string;
  elements: {
    collaborateur_id: string;
    collaborateur_nom: string;
    semaine: string;
    jours_affectes: number;
    capacite: number;
  }[];
  curseur_suivant: string | null;
}

export const DUREES_PLAN = [4, 8, 12, 26] as const;
export type DureePlan = (typeof DUREES_PLAN)[number];

export interface FiltresPlan {
  debut: string;
  semaines: DureePlan;
  equipe: string;
  grade_id: string;
  type: "" | "interne" | "externe" | "sous_traitant";
  curseur: string;
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

/** Filtres du plan de charge lus dans l'URL ; `debut` vide = semaine courante (API). */
export function lireFiltresPlan(p: Record<string, string | string[] | undefined>): FiltresPlan {
  const debut = un(p.debut);
  const semaines = Number(un(p.semaines));
  const type = un(p.type) ?? "";
  const curseur = un(p.curseur) ?? "";
  return {
    debut: estDateIso(debut) ? debut : "",
    semaines: (DUREES_PLAN as readonly number[]).includes(semaines) ? (semaines as DureePlan) : 12,
    equipe: uuidOuVide(un(p.equipe)),
    grade_id: uuidOuVide(un(p.grade_id)),
    type: ["interne", "externe", "sous_traitant"].includes(type)
      ? (type as FiltresPlan["type"])
      : "",
    curseur: CURSEUR.test(curseur) ? curseur : "",
  };
}

/** Requête `GET /api/plan-de-charge?…` (même requête pour les surcharges). */
export function requetePlan(f: FiltresPlan, lundiCourant: string): string {
  const r = new URLSearchParams();
  const debut = f.debut || lundiCourant;
  r.set("debut", debut);
  r.set("fin", ajouterJoursIso(debut, f.semaines * 7 - 1));
  if (f.equipe) r.set("equipe", f.equipe);
  if (f.grade_id) r.set("grade_id", f.grade_id);
  if (f.type) r.set("type", f.type);
  if (f.curseur) r.set("curseur", f.curseur);
  r.set("limite", "50");
  return r.toString();
}

/** Lien vers le plan de charge avec ces filtres (sans curseur sauf s'il est fourni). */
export function hrefPlan(f: FiltresPlan, changements: Partial<FiltresPlan> = {}): string {
  const g = { ...f, curseur: "", ...changements };
  const r = new URLSearchParams();
  if (g.debut) r.set("debut", g.debut);
  if (g.semaines !== 12) r.set("semaines", String(g.semaines));
  if (g.equipe) r.set("equipe", g.equipe);
  if (g.grade_id) r.set("grade_id", g.grade_id);
  if (g.type) r.set("type", g.type);
  if (g.curseur) r.set("curseur", g.curseur);
  const s = r.toString();
  return s ? `/charge?${s}` : "/charge";
}
