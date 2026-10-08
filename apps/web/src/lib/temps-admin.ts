/**
 * Administration des temps (TPS-02, TPS-07, TPS-09, TPS-10) : paramètres de saisie, activités
 * internes, clôture mensuelle, corrections tracées et import de l'historique. Logique pure,
 * testée dans `temps-admin.test.ts`.
 */
import { aPermission, type Role } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { lireNombre, texteOuNull, type Resultat } from "./saisie";
import { estDateIso } from "./semaine";
import type { UniteSaisie } from "./temps";

// --- Paramètres (TPS-01, TPS-07) -------------------------------------------------------------

export interface ParametresTemps {
  unite_saisie_temps: UniteSaisie;
  heures_par_jour: number;
  controle_capacite: "signaler" | "refuser";
  seuil_consommation_pct: number;
}

export const CONTROLE_LIBELLES: Record<ParametresTemps["controle_capacite"], string> = {
  signaler: "Signaler le dépassement (avertissement, la saisie est acceptée)",
  refuser: "Refuser la saisie qui dépasse la capacité du jour",
};

export function validerParametresTemps(s: {
  controle_capacite: string;
  seuil_consommation_pct: string;
}): Resultat<
  { controle_capacite: "signaler" | "refuser"; seuil_consommation_pct: number },
  "controle_capacite" | "seuil_consommation_pct"
> {
  const erreurs: Partial<Record<"controle_capacite" | "seuil_consommation_pct", string>> = {};
  if (s.controle_capacite !== "signaler" && s.controle_capacite !== "refuser")
    erreurs.controle_capacite = "Choisissez le contrôle de capacité.";
  const seuil = lireNombre(s.seuil_consommation_pct);
  if (seuil === null || Number.isNaN(seuil) || !Number.isInteger(seuil) || seuil < 1 || seuil > 100)
    erreurs.seuil_consommation_pct = "Nombre entier entre 1 et 100 (ex. 80).";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      controle_capacite: s.controle_capacite as "signaler" | "refuser",
      seuil_consommation_pct: seuil as number,
    },
  };
}

const CODE = /^[a-z0-9_]{1,40}$/;

export function validerActivite(s: {
  code: string;
  libelle: string;
  est_absence: boolean;
}): Resultat<{ code: string; libelle: string; est_absence: boolean }, "code" | "libelle"> {
  const erreurs: Partial<Record<"code" | "libelle", string>> = {};
  const code = s.code.trim();
  const libelle = s.libelle.trim();
  if (!CODE.test(code))
    erreurs.code = "Minuscules, chiffres et tiret bas, 40 caractères au plus (ex. formation).";
  if (libelle === "") erreurs.libelle = "Saisissez le libellé de l'activité.";
  else if (libelle.length > 120) erreurs.libelle = "120 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { code, libelle, est_absence: s.est_absence } };
}

// --- Clôture mensuelle (TPS-09) -------------------------------------------------------------

export interface PeriodeTemps {
  mois: string;
  statut: "ouverte" | "cloturee";
  cloturee_par?: string | null;
  cloturee_le?: string | null;
  rouverte_par?: string | null;
  rouverte_le?: string | null;
  motif_reouverture?: string | null;
}

const NOMS_MOIS = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** « 2026-09 » → « Septembre 2026 ». */
export function libelleMois(mois: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  if (!m) return mois;
  const t = NOMS_MOIS.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Dernier jour d'un mois « AAAA-MM » (date civile). */
export function finDuMois(mois: string): string {
  const [a, m] = mois.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export const STATUT_PERIODE: Record<
  PeriodeTemps["statut"],
  { libelle: string; tonalite: TonaliteStatut }
> = {
  ouverte: { libelle: "Ouverte", tonalite: "succes" },
  cloturee: { libelle: "Clôturée", tonalite: "neutre" },
};

/**
 * Actions sur un mois : clôturer un mois terminé et ouvert (temps.cloturer) ; rouvrir un mois
 * clôturé (associé uniquement, motif obligatoire). L'API vérifie aussi qu'aucune feuille du
 * mois n'attend de validation.
 */
export function actionsPeriode(
  p: Pick<PeriodeTemps, "mois" | "statut">,
  roles: readonly Role[],
  aujourdhui: string,
): { cloturer: boolean; rouvrir: boolean } {
  const peut = aPermission(roles, "temps.cloturer");
  return {
    cloturer: peut && p.statut === "ouverte" && finDuMois(p.mois) < aujourdhui,
    rouvrir: peut && roles.includes("associe") && p.statut === "cloturee",
  };
}

// --- Corrections (TPS-09) ----------------------------------------------------------------------

export type StatutCorrection = "demandee" | "validee" | "rejetee";

export const STATUT_CORRECTION: Record<
  StatutCorrection,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  demandee: { libelle: "En attente de décision", tonalite: "attention" },
  validee: { libelle: "Validée", tonalite: "succes" },
  rejetee: { libelle: "Rejetée", tonalite: "danger" },
};

export interface Correction {
  id: string;
  collaborateur_id: string;
  collaborateur_nom: string;
  date: string;
  mission_id: string | null;
  tache_id: string | null;
  tache_libelle: string | null;
  activite_id: string | null;
  activite_libelle: string | null;
  ancienne_valeur: number;
  nouvelle_valeur: number;
  motif: string;
  statut: StatutCorrection;
  demandee_par: string;
  demandee_le: string;
  decidee_par: string | null;
  decidee_le: string | null;
  motif_rejet: string | null;
}

export interface SaisieCorrection {
  /** « t:<id> » (tâche) ou « a:<id> » (activité interne). */
  cible: string;
  date: string;
  valeur: string;
  motif: string;
}

const CIBLE = /^[ta]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Demande de correction pour soi : nouvelle valeur (0 pour retirer) dans l'unité du cabinet. */
export function validerCorrection(
  s: SaisieCorrection,
  collaborateurId: string,
  unite: UniteSaisie,
): Resultat<Record<string, unknown>, keyof SaisieCorrection> {
  const erreurs: Partial<Record<keyof SaisieCorrection, string>> = {};
  if (!CIBLE.test(s.cible)) erreurs.cible = "Choisissez la tâche ou l'activité.";
  if (!estDateIso(s.date)) erreurs.date = "Indiquez le jour à corriger.";
  const v = lireNombre(s.valeur);
  if (v === null || Number.isNaN(v) || v < 0)
    erreurs.valeur = "Valeur positive ou nulle (0 pour retirer).";
  else if (unite === "demi_journee" && (v > 3 || Math.abs(v * 2 - Math.round(v * 2)) > 1e-9))
    erreurs.valeur = "Jours par pas de 0,5, 3 au plus.";
  else if (unite === "heure" && (v > 24 || Math.abs(v * 60 - Math.round(v * 60)) > 1e-6))
    erreurs.valeur = "Heures en minutes entières, 24 au plus.";
  const motif = texteOuNull(s.motif);
  if (!motif) erreurs.motif = "Indiquez le motif de la correction.";
  else if (motif.length > 500) erreurs.motif = "500 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const id = s.cible.slice(2);
  return {
    ok: true,
    charge: {
      collaborateur_id: collaborateurId,
      date: s.date,
      ...(s.cible.startsWith("t:") ? { tache_id: id } : { activite_id: id }),
      ...(unite === "heure" ? { heures: v } : { jours: v }),
      motif,
    },
  };
}

/** Décision d'une correction : temps.cloturer, en attente, ni demandeur ni auteur des temps. */
export function peutDeciderCorrection(
  k: Pick<Correction, "statut" | "demandee_par">,
  roles: readonly Role[],
  utilisateurId: string,
  monCollaborateurId: string | null,
  collaborateurId: string,
): boolean {
  return (
    aPermission(roles, "temps.cloturer") &&
    k.statut === "demandee" &&
    k.demandee_par !== utilisateurId &&
    (monCollaborateurId === null || monCollaborateurId !== collaborateurId)
  );
}

// --- Import de l'historique (TPS-10) -------------------------------------------------------------

export const IMPORT_MAX_CARACTERES = 500_000;
export const IMPORT_MAX_OCTETS_FICHIER = 1_000_000;

export interface RapportImport {
  simulation: boolean;
  executee: boolean;
  lignes_lues: number;
  lignes_valides: number;
  feuilles: number;
  jours_total: number;
  erreurs: { ligne: number; message: string }[];
  avertissements: { ligne: number; message: string }[];
}

export function validerCsv(csv: string): Resultat<{ csv: string }, "csv"> {
  if (csv.trim() === "")
    return {
      ok: false,
      erreurs: { csv: "Collez le contenu du fichier CSV ou choisissez un fichier." },
    };
  if (csv.length > IMPORT_MAX_CARACTERES)
    return {
      ok: false,
      erreurs: { csv: "Fichier trop volumineux : 500 000 caractères au plus. Découpez-le." },
    };
  const entete = (csv.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "").toLowerCase();
  const manquantes = ["collaborateur", "mission", "tache", "date", "jours"].filter(
    (c) => !entete.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(c),
  );
  if (manquantes.length > 0)
    return {
      ok: false,
      erreurs: { csv: `En-tête incomplet : colonne(s) ${manquantes.join(", ")} manquante(s).` },
    };
  return { ok: true, charge: { csv } };
}

/** L'exécution n'est proposée qu'après une simulation sans erreur du même contenu. */
export const executionPossible = (r: RapportImport | null, memeContenu: boolean) =>
  r !== null && r.simulation && r.erreurs.length === 0 && r.lignes_valides > 0 && memeContenu;
