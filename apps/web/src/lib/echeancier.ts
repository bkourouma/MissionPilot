/**
 * Échéancier de facturation d'une mission (FIN-06, MIS-10) : logique pure, testée dans
 * `echeancier.test.ts`. Le total, le budget signé, le dépassement et le reste à planifier
 * viennent de l'API (moteur) ; l'interface ne fait que les afficher.
 */
import {
  aPermission,
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

export const OPTIONS_STATUTS_ECHEANCE = STATUTS_ECHEANCE.filter((s) => s !== "facturee").map(
  (s) => ({ valeur: s, libelle: STATUT_ECHEANCE[s].libelle }),
);

export const PERIODICITE_LIBELLES: Record<(typeof PERIODICITES)[number], string> = {
  mensuelle: "Mensuelle",
  trimestrielle: "Trimestrielle",
  semestrielle: "Semestrielle",
  annuelle: "Annuelle",
};

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
): { montant: number } | { pourcentage: number } | string {
  if (s.mode === "pourcentage") {
    const p = lireNombre(s.valeur);
    if (p === null || Number.isNaN(p) || p <= 0 || p > 100)
      return "Pourcentage du budget signé, supérieur à 0 et au plus 100 (ex. 30).";
    if (Math.abs(p * 10_000 - Math.round(p * 10_000)) > 1e-6) return "Quatre décimales au plus.";
    return { pourcentage: p };
  }
  const m = lireMontant(s.valeur, devise);
  if (m === null || Number.isNaN(m) || m <= 0)
    return devise === "XOF" || devise === "XAF"
      ? "Montant positif, sans décimale (ex. 1 500 000)."
      : "Montant positif, deux décimales au plus.";
  return { montant: m };
}

function verifierCommun(
  s: SaisieEcheance,
  erreurs: Partial<Record<ChampEcheance, string>>,
): string {
  const libelle = s.libelle.trim();
  if (libelle === "") erreurs.libelle = "Saisissez le libellé (ex. Acompte à la signature).";
  else if (libelle.length > 200) erreurs.libelle = "200 caractères au plus.";
  if (!dateValide(s.date_prevue)) erreurs.date_prevue = "Saisissez la date prévue de facturation.";
  return libelle;
}

/** Nouvelle échéance saisie : montant OU pourcentage du budget signé. */
export function validerEcheance(
  s: SaisieEcheance,
  devise: Devise,
): Resultat<Record<string, unknown>, ChampEcheance> {
  const erreurs: Partial<Record<ChampEcheance, string>> = {};
  if (!(TYPES_ECHEANCE as readonly string[]).includes(s.type) || s.type === "regie")
    erreurs.type = "Choisissez le type d'échéance.";
  const libelle = verifierCommun(s, erreurs);
  const valeur = lireValeur(s, devise);
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
): Resultat<Record<string, unknown>, ChampEcheance> {
  const erreurs: Partial<Record<ChampEcheance, string>> = {};
  const libelle = verifierCommun(s, erreurs);
  if (s.statut !== "prevue" && s.statut !== "a_facturer") erreurs.statut = "Choisissez le statut.";
  const valeur = type === "regie" ? {} : lireValeur(s, devise);
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
) {
  const libelle = s.pv_libelle.trim();
  if (libelle === "" || libelle.length > 200) erreurs.pv_libelle = "Libellé de 1 à 200 caractères.";
  const max = lireMontant(s.pv_montant_maximum, devise);
  if (max === null || Number.isNaN(max))
    erreurs.pv_montant_maximum = "Montant maximum de la part variable.";
  const atteinte = lireNombre(s.pv_atteinte);
  if (atteinte === null || Number.isNaN(atteinte) || atteinte < 0 || atteinte > 100)
    erreurs.pv_atteinte = "Taux d'atteinte prévu, de 0 à 100 %.";
  if (!dateValide(s.pv_date)) erreurs.pv_date = "Date de facturation de la part variable.";
  return { libelle, montant_maximum: max, atteinte, date: s.pv_date };
}

function genererAbonnement(
  s: SaisieGeneration,
  devise: Devise,
  erreurs: Partial<Record<ChampGeneration, string>>,
) {
  const libelle = s.ab_libelle.trim();
  if (libelle === "" || libelle.length > 200) erreurs.ab_libelle = "Libellé de 1 à 200 caractères.";
  const montant = lireMontant(s.ab_montant, devise);
  if (montant === null || Number.isNaN(montant) || montant <= 0)
    erreurs.ab_montant = "Montant positif facturé à chaque période.";
  if (!dateValide(s.ab_date_debut)) erreurs.ab_date_debut = "Date de la première échéance.";
  const n = lireNombre(s.ab_nombre);
  if (n === null || Number.isNaN(n) || !Number.isInteger(n) || n < 1 || n > 120)
    erreurs.ab_nombre = "Nombre entier de périodes, de 1 à 120.";
  if (!(PERIODICITES as readonly string[]).includes(s.ab_periodicite))
    erreurs.ab_periodicite = "Choisissez la périodicité.";
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
): Resultat<Record<string, unknown>, ChampGeneration> {
  const besoin = besoinGeneration(mode);
  const erreurs: Partial<Record<ChampGeneration, string>> = {};
  let charge: Record<string, unknown> = {};
  if (besoin === "part_variable")
    charge = { part_variable: genererPartVariable(s, devise, erreurs) };
  if (besoin === "abonnement") charge = { abonnement: genererAbonnement(s, devise, erreurs) };
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge };
}

/** Régie : temps validés jusqu'à une date (aujourd'hui par défaut côté API). */
export function validerRegie(jusquAu: string): Resultat<{ jusqu_au?: string }, "jusqu_au"> {
  if (jusquAu === "") return { ok: true, charge: {} };
  if (!dateValide(jusquAu)) return { ok: false, erreurs: { jusqu_au: "Date invalide." } };
  return { ok: true, charge: { jusqu_au: jusquAu } };
}

/** Message d'un refus de l'échéancier, avec le plafond du budget signé quand il est connu. */
export function messageEcheancier(
  e: unknown,
  budgetSigne: number | null,
  devise: Devise,
): string | null {
  if (!(e instanceof ErreurApi)) return null;
  if (e.code === "ECHEANCIER_DEPASSE_BUDGET") {
    const plafond =
      budgetSigne === null ? "" : ` (${formaterMontantMineur(budgetSigne, devise)} d'honoraires)`;
    return `Le total des échéances dépasserait le budget signé${plafond}. Réduisez le montant ou faites d'abord valider une révision du budget (onglet Budget).`;
  }
  if (e.code === "CONFLIT") return e.message;
  return null;
}
