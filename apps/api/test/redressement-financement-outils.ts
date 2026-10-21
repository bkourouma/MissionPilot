import type { Db } from "../src/db/pool.js";
import type { Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import { ouvrirDossierRed, type ScenarioRed } from "./redressement-outils.js";

/*
 * Outils des tests de la vue mensuelle, des covenants et du plan de financement (RED-06, lot 2) :
 * corps de requêtes valides, trésorerie semée par l'API, accès SQL (rôle applicatif d'un cabinet)
 * qui rend le SQLSTATE d'un refus.
 */

export const M = 1_000_000;
export const DEBUT = "2026-10-12";

export const urlD = (dossierId: string, suffixe: string): string =>
  `/api/redressement/dossiers/${dossierId}${suffixe}`;

export const ligneTreso = (semaine: number, sens: string, categorie: string, montant: number) => ({
  semaine,
  sens,
  categorie,
  montant,
});

/** Lignes du cas T1 : S1 +30 −40 −25 ; S2 +20 −30 ; S3 +15 −35 (millions) ; solde initial 50 M, seuil 10 M. */
export const LIGNES_TRESO = [
  ligneTreso(1, "encaissement", "clients", 30 * M),
  ligneTreso(1, "decaissement", "fournisseurs", 40 * M),
  ligneTreso(1, "decaissement", "salaires", 25 * M),
  ligneTreso(2, "encaissement", "clients", 20 * M),
  ligneTreso(2, "decaissement", "fournisseurs", 30 * M),
  ligneTreso(3, "encaissement", "clients", 15 * M),
  ligneTreso(3, "decaissement", "fournisseurs", 35 * M),
  ligneTreso(4, "encaissement", "clients", 90 * M),
  ligneTreso(13, "decaissement", "salaires", 5 * M),
];

export const versionTreso = (extra: Record<string, unknown> = {}) => ({
  date_debut: DEBUT,
  solde_initial: 50 * M,
  seuil_tension: 10 * M,
  lignes: LIGNES_TRESO,
  motif: "Prévision initiale",
  ...extra,
});

export const realiseTreso = (semaineDebut: string, extra: Record<string, unknown> = {}) => ({
  semaine_debut: semaineDebut,
  flux: {
    encaissement: { clients: 28 * M },
    decaissement: { fournisseurs: 41 * M, salaires: 25 * M },
  },
  ...extra,
});

export const covenant = (extra: Record<string, unknown> = {}) => ({
  ratio: "liquidite_generale",
  operateur: "min",
  seuil_pb: 13_636,
  frequence: "annuelle",
  ...extra,
});

/** Cas A (états 2025 et 2024) : deux covenants respectés, deux seuils non atteints. */
export const COVENANTS_CAS_A = [
  covenant({ preteur: "Banque de développement" }),
  covenant({ ratio: "endettement", operateur: "max", seuil_pb: 12_000, frequence: "semestrielle" }),
  covenant({
    ratio: "couverture_charges_financieres",
    seuil_pb: 15_000,
    frequence: "trimestrielle",
  }),
  covenant({ ratio: "autonomie_financiere", seuil_pb: 2_000 }),
];

export const ligneFin = (
  periode: number,
  sens: "emploi" | "ressource",
  nature: string,
  montant: number,
  extra: Record<string, unknown> = {},
) => ({ periode, sens, nature, montant, ...extra });

export const LIGNES_FIN = [
  ligneFin(1, "emploi", "remboursement_dettes_accords", 100 * M),
  ligneFin(1, "emploi", "besoin_fonds_roulement", 50 * M, { libelle: "Reconstitution du BFR" }),
  ligneFin(1, "ressource", "apport_associes", 120 * M),
  ligneFin(2, "emploi", "investissements", 80 * M),
  ligneFin(2, "ressource", "nouveaux_concours_bancaires", 30 * M),
  ligneFin(2, "ressource", "autofinancement", 10 * M),
  ligneFin(3, "ressource", "cessions_actifs", 60 * M),
];

export const planFin = (extra: Record<string, unknown> = {}) => ({
  date_debut: "2026-07-01",
  type_periode: "annee",
  nombre_periodes: 3,
  lignes: LIGNES_FIN,
  motif: "Plan initial",
  ...extra,
});

/** Mission et dossier neufs (même client que le cas A, donc mêmes états acceptés). */
export async function nouveauDossier(s: ScenarioRed, intitule: string): Promise<string> {
  const m = await creerMission(s.a, { intitule });
  return (await ouvrirDossierRed(s, m.id)).id;
}

/** Sème une version de trésorerie (et, facultatif, un réalisé de la semaine 1) par l'API. */
export async function semerTresorerie(
  par: Api,
  dossierId: string,
  avecRealise = false,
): Promise<void> {
  attendre(
    201,
    await par.post(urlD(dossierId, "/tresorerie/versions"), versionTreso()),
    "version de trésorerie",
  );
  if (avecRealise) {
    attendre(
      201,
      await par.post(urlD(dossierId, "/tresorerie/realises"), realiseTreso(DEBUT)),
      "réalisé",
    );
  }
}

/** SQLSTATE d'un refus de la base (rôle applicatif, RLS du cabinet) ; « aucun » si accepté. */
export async function codeSql(
  ctx: Contexte,
  cabinetId: string,
  fn: (db: Db) => Promise<unknown>,
): Promise<string> {
  try {
    await ctx.db.withTenant(cabinetId, fn);
  } catch (e) {
    return (e as { code?: string }).code ?? "inconnu";
  }
  return "aucun";
}
