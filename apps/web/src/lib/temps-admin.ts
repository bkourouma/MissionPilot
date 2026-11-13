/**
 * Administration des temps (TPS-02, TPS-07, TPS-09, TPS-10) : paramètres de saisie, activités
 * internes, clôture mensuelle, corrections tracées et import de l'historique. Logique pure,
 * testée dans `temps-admin.test.ts`.
 */
import {
  aPermission,
  creerTraduire,
  LOCALES_INTL,
  type Langue,
  type Role,
} from "@missionpilot/shared";
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

export const CONTROLE_LIBELLES_EN: Record<ParametresTemps["controle_capacite"], string> = {
  signaler: "Flag the overrun (warning, the entry is accepted)",
  refuser: "Reject any entry that exceeds the day's capacity",
};

export const libelleControle = (c: ParametresTemps["controle_capacite"], langue: Langue = "fr") =>
  (langue === "en" ? CONTROLE_LIBELLES_EN : CONTROLE_LIBELLES)[c];

export function validerParametresTemps(
  s: {
    controle_capacite: string;
    seuil_consommation_pct: string;
  },
  langue: Langue = "fr",
): Resultat<
  { controle_capacite: "signaler" | "refuser"; seuil_consommation_pct: number },
  "controle_capacite" | "seuil_consommation_pct"
> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"controle_capacite" | "seuil_consommation_pct", string>> = {};
  if (s.controle_capacite !== "signaler" && s.controle_capacite !== "refuser")
    erreurs.controle_capacite = t(
      "Choisissez le contrôle de capacité.",
      "Choose the capacity check.",
    );
  const seuil = lireNombre(s.seuil_consommation_pct);
  if (seuil === null || Number.isNaN(seuil) || !Number.isInteger(seuil) || seuil < 1 || seuil > 100)
    erreurs.seuil_consommation_pct = t(
      "Nombre entier entre 1 et 100 (ex. 80).",
      "Whole number between 1 and 100 (e.g. 80).",
    );
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

export function validerActivite(
  s: {
    code: string;
    libelle: string;
    est_absence: boolean;
  },
  langue: Langue = "fr",
): Resultat<{ code: string; libelle: string; est_absence: boolean }, "code" | "libelle"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"code" | "libelle", string>> = {};
  const code = s.code.trim();
  const libelle = s.libelle.trim();
  if (!CODE.test(code))
    erreurs.code = t(
      "Minuscules, chiffres et tiret bas, 40 caractères au plus (ex. formation).",
      "Lowercase letters, digits and underscores, 40 characters maximum (e.g. training).",
    );
  if (libelle === "")
    erreurs.libelle = t("Saisissez le libellé de l'activité.", "Enter the activity label.");
  else if (libelle.length > 120)
    erreurs.libelle = t("120 caractères au plus.", "120 characters maximum.");
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

const NOMS_MOIS = {
  fr: new Intl.DateTimeFormat(LOCALES_INTL.fr, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }),
  en: new Intl.DateTimeFormat(LOCALES_INTL.en, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }),
};

/** « 2026-09 » → « Septembre 2026 ». */
export function libelleMois(mois: string, langue: Langue = "fr"): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  if (!m) return mois;
  const t = NOMS_MOIS[langue].format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
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

export const STATUT_PERIODE_EN: Record<
  PeriodeTemps["statut"],
  { libelle: string; tonalite: TonaliteStatut }
> = {
  ouverte: { libelle: "Open", tonalite: "succes" },
  cloturee: { libelle: "Closed", tonalite: "neutre" },
};

export const statutPeriode = (s: PeriodeTemps["statut"], langue: Langue = "fr") =>
  (langue === "en" ? STATUT_PERIODE_EN : STATUT_PERIODE)[s];

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

export const STATUT_CORRECTION_EN: Record<
  StatutCorrection,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  demandee: { libelle: "Awaiting decision", tonalite: "attention" },
  validee: { libelle: "Approved", tonalite: "succes" },
  rejetee: { libelle: "Rejected", tonalite: "danger" },
};

export const statutCorrection = (s: StatutCorrection, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_CORRECTION_EN : STATUT_CORRECTION)[s];

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
  langue: Langue = "fr",
): Resultat<Record<string, unknown>, keyof SaisieCorrection> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieCorrection, string>> = {};
  if (!CIBLE.test(s.cible))
    erreurs.cible = t("Choisissez la tâche ou l'activité.", "Choose the task or activity.");
  if (!estDateIso(s.date))
    erreurs.date = t("Indiquez le jour à corriger.", "Enter the day to correct.");
  const v = lireNombre(s.valeur);
  if (v === null || Number.isNaN(v) || v < 0)
    erreurs.valeur = t(
      "Valeur positive ou nulle (0 pour retirer).",
      "Zero or positive value (0 to remove).",
    );
  else if (unite === "demi_journee" && (v > 3 || Math.abs(v * 2 - Math.round(v * 2)) > 1e-9))
    erreurs.valeur = t("Jours par pas de 0,5, 3 au plus.", "Days in steps of 0.5, 3 maximum.");
  else if (unite === "heure" && (v > 24 || Math.abs(v * 60 - Math.round(v * 60)) > 1e-6))
    erreurs.valeur = t(
      "Heures en minutes entières, 24 au plus.",
      "Hours in whole minutes, 24 maximum.",
    );
  const motif = texteOuNull(s.motif);
  if (!motif)
    erreurs.motif = t(
      "Indiquez le motif de la correction.",
      "Enter the reason for the correction.",
    );
  else if (motif.length > 500)
    erreurs.motif = t("500 caractères au plus.", "500 characters maximum.");
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

export function validerCsv(csv: string, langue: Langue = "fr"): Resultat<{ csv: string }, "csv"> {
  const t = creerTraduire(langue);
  if (csv.trim() === "")
    return {
      ok: false,
      erreurs: {
        csv: t(
          "Collez le contenu du fichier CSV ou choisissez un fichier.",
          "Paste the CSV file content or choose a file.",
        ),
      },
    };
  if (csv.length > IMPORT_MAX_CARACTERES)
    return {
      ok: false,
      erreurs: {
        csv: t(
          "Fichier trop volumineux : 500 000 caractères au plus. Découpez-le.",
          "File too large: 500,000 characters maximum. Split it.",
        ),
      },
    };
  const entete = (csv.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "").toLowerCase();
  const manquantes = ["collaborateur", "mission", "tache", "date", "jours"].filter(
    (c) => !entete.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(c),
  );
  if (manquantes.length > 0)
    return {
      ok: false,
      erreurs: {
        csv: t(
          `En-tête incomplet : colonne(s) ${manquantes.join(", ")} manquante(s).`,
          `Incomplete header: missing column(s) ${manquantes.join(", ")}.`,
        ),
      },
    };
  return { ok: true, charge: { csv } };
}

/** L'exécution n'est proposée qu'après une simulation sans erreur du même contenu. */
export const executionPossible = (r: RapportImport | null, memeContenu: boolean) =>
  r !== null && r.simulation && r.erreurs.length === 0 && r.lignes_valides > 0 && memeContenu;
