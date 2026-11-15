/**
 * Échéancier de facturation d'une mission (FIN-06, MIS-10) : logique pure, testée dans
 * `echeancier.test.ts`. Le total, le budget signé, le dépassement et le reste à planifier
 * viennent de l'API (moteur) ; l'interface ne fait que les afficher.
 */
import {
  aPermission,
  creerTraduire,
  type Langue,
  PERIODICITES,
  STATUTS_ECHEANCE,
  TYPES_ECHEANCE,
  type ModeFacturation,
  type Role,
  type StatutEcheance,
  type StatutMission,
  type TypeEcheance,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { formaterMontantMineur, type Devise } from "./format";
import { STATUTS_SIGNES } from "./missions";
import { estDateIso } from "./semaine";
import { lireMontant, lireNombre, montantVersSaisie, type Resultat } from "./saisie";

export interface Echeance {
  id: string;
  mission_id: string;
  ordre: number;
  type: TypeEcheance;
  libelle: string;
  montant: number;
  pourcentage: number | null;
  devise: Devise;
  date_prevue: string;
  jalon_id: string | null;
  statut: StatutEcheance;
  periode_debut: string | null;
  periode_fin: string | null;
  facture_id: string | null;
  modifie_le?: string;
}

/** Réponse de GET /api/missions/:id/echeancier. */
export interface Echeancier {
  mission_id: string;
  devise: Devise;
  budget_signe: number | null;
  total: number | null;
  depassement: number | null;
  reste_a_planifier: number | null;
  echeances: Echeance[];
}

export const TYPE_ECHEANCE_LIBELLES: Record<TypeEcheance, string> = {
  acompte: "Acompte",
  jalon: "Jalon",
  avancement: "Avancement",
  regie: "Régie (temps validés)",
  abonnement: "Abonnement",
  part_variable: "Part variable",
};

export const TYPE_ECHEANCE_LIBELLES_EN: Record<TypeEcheance, string> = {
  acompte: "Deposit",
  jalon: "Milestone",
  avancement: "Progress",
  regie: "Time and materials (approved time)",
  abonnement: "Subscription",
  part_variable: "Variable fee",
};

export const libelleTypeEcheance = (t: TypeEcheance, langue: Langue = "fr") =>
  (langue === "en" ? TYPE_ECHEANCE_LIBELLES_EN : TYPE_ECHEANCE_LIBELLES)[t];

/** Types saisis à la main (la régie se calcule sur les temps validés). */
export const OPTIONS_TYPES_SAISIS = TYPES_ECHEANCE.filter((t) => t !== "regie").map((t) => ({
  valeur: t,
  libelle: TYPE_ECHEANCE_LIBELLES[t],
}));

export const STATUT_ECHEANCE: Record<
  StatutEcheance,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  prevue: { libelle: "Prévue", tonalite: "neutre" },
  a_facturer: { libelle: "À facturer", tonalite: "attention" },
  facturee: { libelle: "Facturée", tonalite: "succes" },
};

export const STATUT_ECHEANCE_LIBELLES_EN: Record<StatutEcheance, string> = {
  prevue: "Planned",
  a_facturer: "To invoice",
  facturee: "Invoiced",
};

export const libelleStatutEcheance = (s: StatutEcheance, langue: Langue = "fr") =>
  langue === "en" ? STATUT_ECHEANCE_LIBELLES_EN[s] : STATUT_ECHEANCE[s].libelle;

/** Options des types saisis à la main, dans la langue demandée. */
export const optionsTypesSaisis = (langue: Langue = "fr") =>
  TYPES_ECHEANCE.filter((t) => t !== "regie").map((t) => ({
    valeur: t,
    libelle: libelleTypeEcheance(t, langue),
  }));

export const optionsStatutsEcheance = (langue: Langue = "fr") =>
  STATUTS_ECHEANCE.filter((s) => s !== "facturee").map((s) => ({
    valeur: s,
    libelle: libelleStatutEcheance(s, langue),
  }));

export const OPTIONS_STATUTS_ECHEANCE = STATUTS_ECHEANCE.filter((s) => s !== "facturee").map(
  (s) => ({ valeur: s, libelle: STATUT_ECHEANCE[s].libelle }),
);

export const PERIODICITE_LIBELLES: Record<(typeof PERIODICITES)[number], string> = {
  mensuelle: "Mensuelle",
  trimestrielle: "Trimestrielle",
  semestrielle: "Semestrielle",
  annuelle: "Annuelle",
};

export const PERIODICITE_LIBELLES_EN: Record<(typeof PERIODICITES)[number], string> = {
  mensuelle: "Monthly",
  trimestrielle: "Quarterly",
  semestrielle: "Semiannual",
  annuelle: "Annual",
};

export const libellePeriodicite = (p: (typeof PERIODICITES)[number], langue: Langue = "fr") =>
  (langue === "en" ? PERIODICITE_LIBELLES_EN : PERIODICITE_LIBELLES)[p];

/**
 * Gérer l'échéancier (miroir de `peutGererEcheancier`) : « facture.emettre », ou
 * « budget.ecrire » ET être responsable de la mission ; uniquement après la signature.
 */
export function peutGererEcheancier(
  m: { statut: StatutMission; chef_id: string | null; directeur_id: string | null },
  roles: readonly Role[],
  utilisateurId: string,
): boolean {
  if (!STATUTS_SIGNES.includes(m.statut)) return false;
  const responsable =
    aPermission(roles, "mission.modifier_toutes") ||
    m.chef_id === utilisateurId ||
    m.directeur_id === utilisateurId;
  return (
    aPermission(roles, "facture.emettre") || (aPermission(roles, "budget.ecrire") && responsable)
  );
}

/** Une échéance se modifie ou se supprime tant qu'elle n'est ni facturée ni en facture. */
export const echeanceModifiable = (e: Pick<Echeance, "statut" | "facture_id">) =>
  e.statut !== "facturee" && e.facture_id === null;

/** Échéances prêtes pour un brouillon de facture. */
export const echeancesFacturables = (liste: readonly Echeance[]) =>
  liste.filter((e) => e.statut === "a_facturer" && e.facture_id === null);

// --- Saisie d'une échéance -------------------------------------------------------------------

export interface SaisieEcheance {
  type: string;
  libelle: string;
  mode: "montant" | "pourcentage";
  valeur: string;
  date_prevue: string;
  jalon_id: string;
  statut: string;
}

export type ChampEcheance = "type" | "libelle" | "valeur" | "date_prevue" | "statut";

export const SAISIE_ECHEANCE_VIDE: SaisieEcheance = {
  type: "jalon",
  libelle: "",
  mode: "pourcentage",
  valeur: "",
  date_prevue: "",
  jalon_id: "",
  statut: "prevue",
};

export function saisieDepuisEcheance(e: Echeance): SaisieEcheance {
  const pourcentage = e.pourcentage !== null;
  return {
    type: e.type,
    libelle: e.libelle,
    mode: pourcentage ? "pourcentage" : "montant",
    valeur: pourcentage
      ? String(e.pourcentage).replace(".", ",")
      : montantVersSaisie(e.montant, e.devise),
    date_prevue: e.date_prevue,
    jalon_id: e.jalon_id ?? "",
    statut: e.statut,
  };
}

const dateValide = (d: string) => estDateIso(d) && d >= "2000-01-01" && d <= "2100-12-31";

function lireValeur(
  s: Pick<SaisieEcheance, "mode" | "valeur">,
  devise: Devise,
  langue: Langue = "fr",
): { montant: number } | { pourcentage: number } | string {
  const t = creerTraduire(langue);
  if (s.mode === "pourcentage") {
    const p = lireNombre(s.valeur);
    if (p === null || Number.isNaN(p) || p <= 0 || p > 100)
      return t(
        "Pourcentage du budget signé, supérieur à 0 et au plus 100 (ex. 30).",
        "Percentage of the signed budget, greater than 0 and at most 100 (e.g. 30).",
      );
    if (Math.abs(p * 10_000 - Math.round(p * 10_000)) > 1e-6)
      return t("Quatre décimales au plus.", "Four decimal places at most.");
    return { pourcentage: p };
  }
  const m = lireMontant(s.valeur, devise);
  if (m === null || Number.isNaN(m) || m <= 0)
    return devise === "XOF" || devise === "XAF"
      ? t(
          "Montant positif, sans décimale (ex. 1 500 000).",
          "Positive amount, no decimals (e.g. 1,500,000).",
        )
      : t(
          "Montant positif, deux décimales au plus.",
          "Positive amount, two decimal places at most.",
        );
  return { montant: m };
}

function verifierCommun(
  s: SaisieEcheance,
  erreurs: Partial<Record<ChampEcheance, string>>,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const libelle = s.libelle.trim();
  if (libelle === "")
    erreurs.libelle = t(
      "Saisissez le libellé (ex. Acompte à la signature).",
      "Enter the label (e.g. Deposit at signing).",
    );
  else if (libelle.length > 200)
    erreurs.libelle = t("200 caractères au plus.", "200 characters at most.");
  if (!dateValide(s.date_prevue))
    erreurs.date_prevue = t(
      "Saisissez la date prévue de facturation.",
      "Enter the planned invoicing date.",
    );
  return libelle;
}

/** Nouvelle échéance saisie : montant OU pourcentage du budget signé. */
export function validerEcheance(
  s: SaisieEcheance,
  devise: Devise,
  langue: Langue = "fr",
): Resultat<Record<string, unknown>, ChampEcheance> {
  const erreurs: Partial<Record<ChampEcheance, string>> = {};
  if (!(TYPES_ECHEANCE as readonly string[]).includes(s.type) || s.type === "regie")
    erreurs.type = creerTraduire(langue)(
      "Choisissez le type d'échéance.",
      "Choose the due date type.",
    );
  const libelle = verifierCommun(s, erreurs, langue);
  const valeur = lireValeur(s, devise, langue);
  if (typeof valeur === "string") erreurs.valeur = valeur;
  if (Object.keys(erreurs).length > 0 || typeof valeur === "string") return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      type: s.type,
      libelle,
      ...valeur,
      date_prevue: s.date_prevue,
      jalon_id: s.jalon_id || null,
    },
  };
}

/** Modification d'une échéance ; la régie garde son montant (calculé sur les temps). */
export function validerModificationEcheance(
  s: SaisieEcheance,
  devise: Devise,
  type: TypeEcheance,
  langue: Langue = "fr",
): Resultat<Record<string, unknown>, ChampEcheance> {
  const erreurs: Partial<Record<ChampEcheance, string>> = {};
  const libelle = verifierCommun(s, erreurs, langue);
  if (s.statut !== "prevue" && s.statut !== "a_facturer")
    erreurs.statut = creerTraduire(langue)("Choisissez le statut.", "Choose the status.");
  const valeur = type === "regie" ? {} : lireValeur(s, devise, langue);
  if (typeof valeur === "string") erreurs.valeur = valeur;
  if (Object.keys(erreurs).length > 0 || typeof valeur === "string") return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      libelle,
      ...valeur,
      date_prevue: s.date_prevue,
      jalon_id: s.jalon_id || null,
      statut: s.statut,
    },
  };
}

// --- Génération ------------------------------------------------------------------------------

export interface SaisieGeneration {
  pv_libelle: string;
  pv_montant_maximum: string;
  pv_atteinte: string;
  pv_date: string;
  ab_libelle: string;
  ab_montant: string;
  ab_date_debut: string;
  ab_nombre: string;
  ab_periodicite: string;
}

export type ChampGeneration = keyof SaisieGeneration;

export const SAISIE_GENERATION_VIDE: SaisieGeneration = {
  pv_libelle: "Part variable",
  pv_montant_maximum: "",
  pv_atteinte: "",
  pv_date: "",
  ab_libelle: "Abonnement",
  ab_montant: "",
  ab_date_debut: "",
  ab_nombre: "",
  ab_periodicite: "mensuelle",
};

/** Ce que la génération demande selon le mode de facturation de la mission. */
export function besoinGeneration(
  mode: ModeFacturation,
): "aucun" | "part_variable" | "abonnement" | "regie" {
  if (mode === "forfait_variable") return "part_variable";
  if (mode === "abonnement") return "abonnement";
  if (mode === "regie") return "regie";
  return "aucun";
}

function genererPartVariable(
  s: SaisieGeneration,
  devise: Devise,
  erreurs: Partial<Record<ChampGeneration, string>>,
  langue: Langue = "fr",
) {
  const t = creerTraduire(langue);
  const libelle = s.pv_libelle.trim();
  if (libelle === "" || libelle.length > 200)
    erreurs.pv_libelle = t("Libellé de 1 à 200 caractères.", "Label of 1 to 200 characters.");
  const max = lireMontant(s.pv_montant_maximum, devise);
  if (max === null || Number.isNaN(max))
    erreurs.pv_montant_maximum = t(
      "Montant maximum de la part variable.",
      "Maximum amount of the variable fee.",
    );
  const atteinte = lireNombre(s.pv_atteinte);
  if (atteinte === null || Number.isNaN(atteinte) || atteinte < 0 || atteinte > 100)
    erreurs.pv_atteinte = t(
      "Taux d'atteinte prévu, de 0 à 100 %.",
      "Expected achievement rate, from 0 to 100%.",
    );
  if (!dateValide(s.pv_date))
    erreurs.pv_date = t(
      "Date de facturation de la part variable.",
      "Invoicing date of the variable fee.",
    );
  return { libelle, montant_maximum: max, atteinte, date: s.pv_date };
}

function genererAbonnement(
  s: SaisieGeneration,
  devise: Devise,
  erreurs: Partial<Record<ChampGeneration, string>>,
  langue: Langue = "fr",
) {
  const t = creerTraduire(langue);
  const libelle = s.ab_libelle.trim();
  if (libelle === "" || libelle.length > 200)
    erreurs.ab_libelle = t("Libellé de 1 à 200 caractères.", "Label of 1 to 200 characters.");
  const montant = lireMontant(s.ab_montant, devise);
  if (montant === null || Number.isNaN(montant) || montant <= 0)
    erreurs.ab_montant = t(
      "Montant positif facturé à chaque période.",
      "Positive amount invoiced each period.",
    );
  if (!dateValide(s.ab_date_debut))
    erreurs.ab_date_debut = t("Date de la première échéance.", "Date of the first due date.");
  const n = lireNombre(s.ab_nombre);
  if (n === null || Number.isNaN(n) || !Number.isInteger(n) || n < 1 || n > 120)
    erreurs.ab_nombre = t(
      "Nombre entier de périodes, de 1 à 120.",
      "Whole number of periods, from 1 to 120.",
    );
  if (!(PERIODICITES as readonly string[]).includes(s.ab_periodicite))
    erreurs.ab_periodicite = t("Choisissez la périodicité.", "Choose the frequency.");
  return {
    libelle,
    montant_periodique: montant,
    date_debut: s.ab_date_debut,
    nombre_periodes: n,
    periodicite: s.ab_periodicite,
  };
}

/**
 * Corps de POST /api/missions/:id/echeancier/generer. Forfait : corps vide (30 % à la
 * signature, 70 % à la fin, calculés par le moteur) ; forfait variable et abonnement : leurs
 * paramètres.
 */
export function validerGeneration(
  mode: ModeFacturation,
  s: SaisieGeneration,
  devise: Devise,
  langue: Langue = "fr",
): Resultat<Record<string, unknown>, ChampGeneration> {
  const besoin = besoinGeneration(mode);
  const erreurs: Partial<Record<ChampGeneration, string>> = {};
  let charge: Record<string, unknown> = {};
  if (besoin === "part_variable")
    charge = { part_variable: genererPartVariable(s, devise, erreurs, langue) };
  if (besoin === "abonnement")
    charge = { abonnement: genererAbonnement(s, devise, erreurs, langue) };
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge };
}

/** Régie : temps validés jusqu'à une date (aujourd'hui par défaut côté API). */
export function validerRegie(
  jusquAu: string,
  langue: Langue = "fr",
): Resultat<{ jusqu_au?: string }, "jusqu_au"> {
  if (jusquAu === "") return { ok: true, charge: {} };
  if (!dateValide(jusquAu))
    return {
      ok: false,
      erreurs: { jusqu_au: creerTraduire(langue)("Date invalide.", "Invalid date.") },
    };
  return { ok: true, charge: { jusqu_au: jusquAu } };
}

/** Message d'un refus de l'échéancier, avec le plafond du budget signé quand il est connu. */
export function messageEcheancier(
  e: unknown,
  budgetSigne: number | null,
  devise: Devise,
  langue: Langue = "fr",
): string | null {
  if (!(e instanceof ErreurApi)) return null;
  if (e.code === "ECHEANCIER_DEPASSE_BUDGET") {
    const t = creerTraduire(langue);
    const montant = budgetSigne === null ? "" : formaterMontantMineur(budgetSigne, devise, langue);
    const plafond =
      budgetSigne === null ? "" : t(` (${montant} d'honoraires)`, ` (${montant} in fees)`);
    return t(
      `Le total des échéances dépasserait le budget signé${plafond}. Réduisez le montant ou faites d'abord valider une révision du budget (onglet Budget).`,
      `The total of the due dates would exceed the signed budget${plafond}. Reduce the amount or first get a budget revision approved (Budget tab).`,
    );
  }
  if (e.code === "CONFLIT") return e.message;
  return null;
}
