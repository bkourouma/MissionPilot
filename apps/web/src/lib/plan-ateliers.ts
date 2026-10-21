/**
 * Ateliers stratégiques en ligne (PLA-15) : types des réponses de l'API, chemins, contrôle des
 * saisies (atelier, vote, classement, matrice), libellés et droits d'affichage. Logique pure, testée
 * dans `plan-ateliers.test.ts`.
 *
 * Aucun agrégat n'est calculé ici : points, parts, rangs, moyennes et taux de participation sortent du
 * moteur côté API (figés à la clôture). Les conversions de ce module ne font que PRÉSENTER des entiers
 * du moteur (centièmes → décimales). Le portail ne reçoit jamais d'agrégat ni la contribution d'un
 * autre : seuls les types `…Portail` lui servent.
 */
import {
  METHODES_ATELIER,
  METHODE_ATELIER_LIBELLES,
  OPTIONS_ATELIER_MAX,
  OPTIONS_ATELIER_MIN,
  STATUT_ATELIER_LIBELLES,
  aPermission,
  type MethodeAtelier,
  type Role,
  type StatutAtelier,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import { formaterNombre } from "./format";
import { CHEMIN_PORTAIL } from "./portail-routes";
import { cheminPlan, hrefPlan, type DroitsPlan } from "./plan-strategique";
import { lireNombre } from "./saisie";

export { METHODES_ATELIER, METHODE_ATELIER_LIBELLES, OPTIONS_ATELIER_MAX, OPTIONS_ATELIER_MIN };
export type { MethodeAtelier, StatutAtelier };

/* ----- Contrats de l'API (cabinet) ----- */

export interface OptionAtelierApi {
  id: string;
  rang: number;
  libelle: string;
  description: string | null;
}

export interface AtelierResume {
  id: string;
  titre: string;
  statut: StatutAtelier;
  methodes: MethodeAtelier[];
  nombre_options: number;
  nombre_participants: number;
  cree_le: string;
  ouvert_le: string | null;
  clos_le: string | null;
}

export interface PageAteliers {
  elements: AtelierResume[];
  curseur_suivant: string | null;
}

export interface ParticipantAtelier {
  id: string;
  utilisateur_id: string;
  partie: "cabinet" | "client";
  nom: string;
  invite_le: string;
}

export interface ParticipationAtelier {
  invites: number;
  ayant_contribue: number | null;
  /** Centièmes de pourcent (6667 = 66,67 %), calculé par le moteur. */
  taux_centiemes_pourcent: number | null;
}

interface ParticipationMoteur {
  participants: number;
  invites: number;
  tauxCentiemesPourcent: number | null;
}

export interface LigneVoteResultat {
  optionId: string;
  points: number;
  votants: number;
  partCentiemesPourcent: number;
  rang: number;
}
export interface LignePriorisationResultat {
  optionId: string;
  pointsBorda: number;
  rangMoyenCentiemes: number | null;
  nombreClassements: number;
  foisPremiere: number;
  rang: number;
}
export interface LigneMatriceResultat {
  optionId: string;
  moyenneXCentiemes: number | null;
  moyenneYCentiemes: number | null;
  dispersionX: number;
  dispersionY: number;
  contributeurs: number;
  quadrant: string | null;
  consensus: boolean;
  rang: number;
}

/** Agrégats figés à la clôture (sortie du moteur `synthetiserAtelier`). */
export interface ResultatsAtelier {
  moteur: string;
  invites: number;
  vote?: {
    resultat: {
      budgetPoints: number;
      totalPoints: number;
      options: LigneVoteResultat[];
      participation: ParticipationMoteur;
    };
  };
  priorisation?: {
    resultat: { options: LignePriorisationResultat[]; participation: ParticipationMoteur };
  };
  matrice?: {
    resultat: {
      axes: {
        x: { libelle: string; inverse?: boolean };
        y: { libelle: string; inverse?: boolean };
      };
      options: LigneMatriceResultat[];
      participation: ParticipationMoteur;
    };
  };
}

export interface AtelierDetail {
  id: string;
  plan_id: string;
  titre: string;
  consigne: string;
  statut: StatutAtelier;
  methodes: MethodeAtelier[];
  budget_points: number;
  plafond_par_option: number | null;
  axes: {
    x: { libelle: string; inverse: boolean };
    y: { libelle: string; inverse: boolean };
  };
  cree_le: string;
  ouvert_le: string | null;
  clos_le: string | null;
  options: OptionAtelierApi[];
  participants: ParticipantAtelier[];
  participation: ParticipationAtelier;
  resultats: ResultatsAtelier | null;
}

export interface Candidats {
  cabinet: { id: string; nom: string }[];
  dirigeants: { id: string; nom: string }[];
}

/** SA contribution courante (cabinet ou portail) : jamais celle d'un autre. */
export interface MaContribution {
  version: number;
  depose_le: string;
  points?: { option_id: string; points: number }[];
  classement?: string[];
  positions?: { option_id: string; x: number; y: number }[];
}
export type MesContributions = Partial<Record<MethodeAtelier, MaContribution>>;

/* ----- Contrats de l'API (portail) ----- */

export interface AtelierPortailResume {
  id: string;
  titre: string;
  methodes: MethodeAtelier[];
  ouvert_le: string;
  a_contribue: boolean;
}

export interface AtelierPortail {
  id: string;
  titre: string;
  consigne: string;
  methodes: MethodeAtelier[];
  points_a_repartir: number;
  plafond_points_par_option: number | null;
  axes: AtelierDetail["axes"];
  ouvert_le: string;
  options: { id: string; libelle: string; description: string | null }[];
  ma_contribution: MesContributions;
}

/* ----- Présentation ----- */

export const TONALITE_STATUT_ATELIER: Record<StatutAtelier, TonaliteStatut> = {
  brouillon: "neutre",
  ouvert: "succes",
  clos: "neutre",
};
export const libelleStatutAtelier = (s: string) =>
  STATUT_ATELIER_LIBELLES[s as StatutAtelier] ?? "—";
export const libelleMethode = (m: string) => METHODE_ATELIER_LIBELLES[m as MethodeAtelier] ?? m;

export const QUADRANT_LIBELLES: Record<string, string> = {
  gains_rapides: "Gains rapides",
  projets_majeurs: "Projets majeurs",
  complements: "Compléments",
  a_ecarter: "À écarter",
};
export const libelleQuadrant = (q: string | null) =>
  q === null ? "Non placée" : (QUADRANT_LIBELLES[q] ?? q);

/** Centièmes de pourcent du moteur → « 66,67 % » (présentation seule). */
export function formaterTauxCentiemes(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${formaterNombre(n / 100, 2)} %`;
}

/** Centièmes du moteur (moyenne, rang moyen) → « 4,00 » (présentation seule). */
export function formaterCentiemes(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : formaterNombre(n / 100, 2);
}

/** Phrase de participation pendant l'atelier. */
export function phraseParticipation(p: ParticipationAtelier): string {
  if (p.ayant_contribue === null)
    return `${p.invites} personne${p.invites > 1 ? "s" : ""} invitée${p.invites > 1 ? "s" : ""}.`;
  return `${p.ayant_contribue} participant${p.ayant_contribue > 1 ? "s" : ""} sur ${p.invites} invité${p.invites > 1 ? "s" : ""} (${formaterTauxCentiemes(p.taux_centiemes_pourcent)}).`;
}

export const libelleOption = (options: readonly { id: string; libelle: string }[], id: string) =>
  options.find((o) => o.id === id)?.libelle ?? "Option retirée";

/** Lignes d'un tableau de résultats, dans l'ordre des rangs (le moteur a déjà tranché les égalités). */
export function lignesParRang<T extends { rang: number }>(lignes: readonly T[]): T[] {
  return [...lignes].sort((a, b) => a.rang - b.rang);
}

/* ----- Droits d'affichage (l'API décide) ----- */

export interface DroitsAtelier {
  lire: boolean;
  /** Créer, modifier, ouvrir, clore, inviter un membre du cabinet. */
  ecrire: boolean;
  /** Inviter un dirigeant du client. */
  inviterClient: boolean;
  /** Générer la synthèse IA d'un atelier clos. */
  synthese: boolean;
  /** La mission est clôturée : tout est en lecture seule. */
  cloturee: boolean;
}

export function droitsAtelier(roles: readonly Role[], droitsPlan: DroitsPlan): DroitsAtelier {
  return {
    lire: aPermission(roles, "plan.lire"),
    ecrire: droitsPlan.rediger,
    inviterClient: droitsPlan.rediger && aPermission(roles, "portail.gerer"),
    synthese: droitsPlan.rediger && aPermission(roles, "ia.utiliser"),
    cloturee: droitsPlan.cloturee,
  };
}

/** Le membre du cabinet est-il invité à cet atelier (et l'atelier ouvert) ? */
export function peutContribuerCabinet(
  a: Pick<AtelierDetail, "statut" | "participants">,
  moi: string,
) {
  return a.statut === "ouvert" && a.participants.some((p) => p.utilisateur_id === moi);
}

/** Pourquoi « Ouvrir » n'est pas proposé (null s'il l'est). */
export function raisonOuvertureImpossible(
  a: Pick<AtelierDetail, "statut" | "options" | "participants">,
): string | null {
  if (a.statut !== "brouillon") return "Seul un atelier en brouillon s'ouvre.";
  if (a.options.length < OPTIONS_ATELIER_MIN) return "Ajoutez au moins deux options.";
  if (a.participants.length < 1) return "Invitez au moins un participant.";
  return null;
}

/* ----- Saisie d'un atelier ----- */

export interface SaisieOptionAtelier {
  libelle: string;
  description: string;
}

export interface SaisieAtelier {
  titre: string;
  consigne: string;
  methodes: MethodeAtelier[];
  budget_points: string;
  plafond_par_option: string;
  axe_x_libelle: string;
  axe_x_inverse: boolean;
  axe_y_libelle: string;
  axe_y_inverse: boolean;
  options: SaisieOptionAtelier[];
}

export type ChampAtelier =
  | "titre"
  | "consigne"
  | "methodes"
  | "budget_points"
  | "plafond_par_option"
  | "axe_x_libelle"
  | "axe_y_libelle"
  | "options";

export function saisieAtelierVide(): SaisieAtelier {
  return {
    titre: "",
    consigne: "",
    methodes: ["vote"],
    budget_points: "10",
    plafond_par_option: "",
    axe_x_libelle: "Valeur / impact",
    axe_x_inverse: false,
    axe_y_libelle: "Effort",
    axe_y_inverse: true,
    options: [
      { libelle: "", description: "" },
      { libelle: "", description: "" },
    ],
  };
}

export function saisieDepuisAtelier(a: AtelierDetail): SaisieAtelier {
  return {
    titre: a.titre,
    consigne: a.consigne,
    methodes: [...a.methodes],
    budget_points: String(a.budget_points),
    plafond_par_option: a.plafond_par_option === null ? "" : String(a.plafond_par_option),
    axe_x_libelle: a.axes.x.libelle,
    axe_x_inverse: a.axes.x.inverse,
    axe_y_libelle: a.axes.y.libelle,
    axe_y_inverse: a.axes.y.inverse,
    options: a.options.map((o) => ({ libelle: o.libelle, description: o.description ?? "" })),
  };
}

const CONTROLE = /\p{Cc}/u;

function entierBorne(v: string, min: number, max: number): number | null {
  const n = lireNombre(v);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function validerAtelier(s: SaisieAtelier) {
  const erreurs: Partial<Record<ChampAtelier, string>> = {};
  const titre = s.titre.trim();
  if (titre === "" || titre.length > 200 || CONTROLE.test(titre)) {
    erreurs.titre = "Titre obligatoire, 200 caractères au plus.";
  }
  if (s.consigne.trim().length > 4000) erreurs.consigne = "4 000 caractères au plus.";
  if (s.methodes.length === 0) erreurs.methodes = "Choisissez au moins une méthode.";
  const budget = entierBorne(s.budget_points, 1, 100);
  if (budget === null) erreurs.budget_points = "Entier de 1 à 100.";
  let plafond: number | null = null;
  if (s.plafond_par_option.trim() !== "") {
    plafond = entierBorne(s.plafond_par_option, 1, 100);
    if (plafond === null || (budget !== null && plafond > budget)) {
      erreurs.plafond_par_option = "Entier de 1 au budget de points.";
    }
  }
  for (const [cle, v] of [
    ["axe_x_libelle", s.axe_x_libelle],
    ["axe_y_libelle", s.axe_y_libelle],
  ] as const) {
    if (v.trim() === "" || v.trim().length > 60 || CONTROLE.test(v)) {
      erreurs[cle] = "Libellé obligatoire, 60 caractères au plus.";
    }
  }
  const options = s.options.map((o) => ({
    libelle: o.libelle.trim(),
    description: o.description.trim(),
  }));
  if (
    options.length < OPTIONS_ATELIER_MIN ||
    options.length > OPTIONS_ATELIER_MAX ||
    options.some(
      (o) =>
        o.libelle === "" ||
        o.libelle.length > 200 ||
        o.description.length > 500 ||
        CONTROLE.test(o.libelle),
    )
  ) {
    erreurs.options = `De ${OPTIONS_ATELIER_MIN} à ${OPTIONS_ATELIER_MAX} options, chacune avec un libellé (200 caractères au plus) et une description facultative (500 au plus).`;
  }
  if (Object.keys(erreurs).length) return { erreurs, corps: null };
  return {
    erreurs,
    corps: {
      titre,
      consigne: s.consigne.trim(),
      methodes: METHODES_ATELIER.filter((m) => s.methodes.includes(m)),
      budget_points: budget,
      plafond_par_option: plafond,
      axes: {
        x: { libelle: s.axe_x_libelle.trim(), inverse: s.axe_x_inverse },
        y: { libelle: s.axe_y_libelle.trim(), inverse: s.axe_y_inverse },
      },
      options: options.map((o) => ({
        libelle: o.libelle,
        ...(o.description === "" ? {} : { description: o.description }),
      })),
    },
  };
}

/* ----- Saisie d'une contribution ----- */

/** Points saisis par option (texte). */
export type SaisieVote = Record<string, string>;

export function saisieVote(
  options: readonly { id: string }[],
  existante?: MaContribution,
): SaisieVote {
  const connus = new Map((existante?.points ?? []).map((p) => [p.option_id, String(p.points)]));
  return Object.fromEntries(options.map((o) => [o.id, connus.get(o.id) ?? ""]));
}

/** Total des points déjà répartis (aide à la saisie ; le contrôle reste celui de l'API et du moteur). */
export function pointsRepartis(s: SaisieVote): number {
  return Object.values(s).reduce((somme, v) => {
    const n = entierBorne(v, 0, 100);
    return somme + (n ?? 0);
  }, 0);
}

export function validerVote(s: SaisieVote, budget: number, plafond: number | null) {
  const erreurs: Record<string, string> = {};
  const points: { option_id: string; points: number }[] = [];
  for (const [id, v] of Object.entries(s)) {
    if (v.trim() === "") continue;
    const n = entierBorne(v, 0, 100);
    if (n === null) erreurs[id] = "Entier de 0 à 100.";
    else if (plafond !== null && n > plafond)
      erreurs[id] = `${plafond} points au plus sur une option.`;
    else points.push({ option_id: id, points: n });
  }
  const somme = points.reduce((t, p) => t + p.points, 0);
  let global: string | null = null;
  if (somme > budget) global = `Vous répartissez ${somme} points ; le budget est de ${budget}.`;
  else if (somme === 0 && Object.keys(erreurs).length === 0)
    global = "Répartissez au moins un point.";
  if (Object.keys(erreurs).length || global) return { erreurs, global, corps: null };
  return { erreurs, global, corps: { points: points.filter((p) => p.points > 0) } };
}

/** Ordre initial d'un classement : le sien, complété des options non classées. */
export function ordreInitial(
  options: readonly { id: string }[],
  existante?: MaContribution,
): string[] {
  const classes = (existante?.classement ?? []).filter((id) => options.some((o) => o.id === id));
  return [...classes, ...options.map((o) => o.id).filter((id) => !classes.includes(id))];
}

/** Déplace l'élément `index` de `delta` rangs (borné). */
export function deplacer(ordre: readonly string[], index: number, delta: number): string[] {
  const cible = index + delta;
  if (index < 0 || index >= ordre.length || cible < 0 || cible >= ordre.length) return [...ordre];
  const copie = [...ordre];
  const [x] = copie.splice(index, 1);
  copie.splice(cible, 0, x as string);
  return copie;
}

export function validerClassement(ordre: readonly string[]) {
  if (ordre.length === 0) return { corps: null, global: "Classez au moins une option." };
  return { corps: { classement: [...ordre] }, global: null };
}

export type SaisieMatrice = Record<string, { x: string; y: string }>;

export function saisieMatrice(
  options: readonly { id: string }[],
  existante?: MaContribution,
): SaisieMatrice {
  const connues = new Map((existante?.positions ?? []).map((p) => [p.option_id, p]));
  return Object.fromEntries(
    options.map((o) => {
      const p = connues.get(o.id);
      return [o.id, { x: p ? String(p.x) : "", y: p ? String(p.y) : "" }];
    }),
  );
}

export const OPTIONS_NOTE_MATRICE = ["1", "2", "3", "4", "5"].map((v) => ({
  valeur: v,
  libelle: v,
}));

export function validerMatrice(s: SaisieMatrice) {
  const erreurs: Record<string, string> = {};
  const positions: { option_id: string; x: number; y: number }[] = [];
  for (const [id, p] of Object.entries(s)) {
    if (p.x === "" && p.y === "") continue;
    const x = /^[1-5]$/.test(p.x) ? Number(p.x) : null;
    const y = /^[1-5]$/.test(p.y) ? Number(p.y) : null;
    if (x === null || y === null) erreurs[id] = "Les deux notes, de 1 à 5.";
    else positions.push({ option_id: id, x, y });
  }
  let global: string | null = null;
  if (positions.length === 0 && Object.keys(erreurs).length === 0) {
    global = "Placez au moins une option.";
  }
  if (Object.keys(erreurs).length || global) return { erreurs, global, corps: null };
  return { erreurs, global, corps: { positions } };
}

/* ----- Messages ----- */

export function messageAtelier(e: unknown): string {
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "ATELIER_ETAT":
      case "ATELIER_FIGE":
        return "L'atelier n'est plus dans l'état attendu : rechargez la page.";
      case "ATELIER_INCOHERENT":
        return "Pour ouvrir l'atelier : au moins deux options et un participant.";
      case "ATELIER_PLAFOND":
        return "Plafond atteint (100 ateliers par plan, 50 options, 100 participants, 20 versions d'une contribution).";
      case "ATELIER_PARTICIPANT_REFUSE":
        return "Cette personne ne peut pas être invitée à cet atelier.";
      case "ATELIER_OPTION_INCONNUE":
        return "Une option n'existe plus dans cet atelier : rechargez la page.";
      case "ATELIER_CONTRIBUTION_INVALIDE":
      case "ATELIER_CONTRIBUTION_INCOMPLETE":
      case "ATELIER_INVALIDE":
        return "Contribution refusée : vérifiez le budget de points, les options et les notes.";
    }
    if (e.statut === 403) return "Votre rôle ne permet pas cette action sur les ateliers.";
    if (e.statut === 404) return "Cet atelier est introuvable ou ne vous est plus accessible.";
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

/* ----- Chemins ----- */

const seg = (id: string) => encodeURIComponent(id);

export const hrefAteliers = (missionId: string, planId: string) =>
  `${hrefPlan(missionId, planId)}/ateliers`;
export const hrefAtelier = (missionId: string, planId: string, atelierId: string) =>
  `${hrefAteliers(missionId, planId)}/${seg(atelierId)}`;
export const cheminAteliers = (planId: string) => `${cheminPlan(planId)}/ateliers`;
export const cheminListeAteliers = (planId: string, limite = 30) =>
  `${cheminAteliers(planId)}?limite=${limite}`;
export const cheminAtelier = (planId: string, atelierId: string) =>
  `${cheminAteliers(planId)}/${seg(atelierId)}`;
export const cheminOuvrirAtelier = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/ouvrir`;
export const cheminCloreAtelier = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/clore`;
export const cheminParticipants = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/participants`;
export const cheminCandidats = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/candidats`;
export const cheminContributions = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/contribution`;
export const cheminContribution = (planId: string, atelierId: string, m: MethodeAtelier) =>
  `${cheminContributions(planId, atelierId)}/${m}`;
export const cheminSynthese = (planId: string, atelierId: string) =>
  `${cheminAtelier(planId, atelierId)}/synthese`;

/** Espace client. */
export const CHEMIN_ATELIERS_PORTAIL = `${CHEMIN_PORTAIL}/ateliers`;
export const API_ATELIERS_PORTAIL = "/api/portail/ateliers";
export const cheminAtelierPortail = (id: string) => `${CHEMIN_ATELIERS_PORTAIL}/${seg(id)}`;
export const cheminApiAtelierPortail = (id: string) => `${API_ATELIERS_PORTAIL}/${seg(id)}`;
export const cheminApiContributionPortail = (id: string, m: MethodeAtelier) =>
  `${cheminApiAtelierPortail(id)}/contribution/${m}`;
