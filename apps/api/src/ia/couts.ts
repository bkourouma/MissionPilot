import {
  calculerBudget,
  consommationBudgetaire,
  convertir,
  figerTauxChange,
  montant,
  multiplierParRationnel,
  type Devise,
  type Montant,
} from "@missionpilot/engines";
import { SEUILS_ALERTE_PLAFOND_IA, type TacheIa } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { encoderCurseur, decoderCurseur } from "../http/outils.js";
import { chargerVersions, versionDeReference, versVersionMoteur } from "../missions/budget.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { associesActifs, notifier, type NotificationCreee } from "../notifications/notifier.js";
import { estimerTokens } from "./fournisseur.js";
import { coutMicroUsd } from "./modeles.js";
import type { SourceCle } from "./parametres.js";

/*
 * Coût et quota IA (PRD : coût API IA d'une mission ≤ 5 % de son prix).
 *
 * - Chaque appel facturé (ou peut-être facturé) au fournisseur est inscrit
 *   dans `ia_consommations` (ajout seul), coût estimé en micro-dollars US par
 *   la table de tarifs (ia/modeles.ts), avec la source de la clé. Un appel
 *   sans réponse exploitable (délai dépassé, réponse illisible ou trop
 *   grande) a pu être facturé : il est inscrit au coût ESTIMÉ avant l'appel.
 *   Les sommes se font ici sur des ENTIERS (aucun arrondi) ; conversion et
 *   ratio passent par les fonctions exactes du moteur finance.
 * - Plafond mensuel du cabinet (mois civil UTC), plafonné par celui de la
 *   plateforme avec la clé de plateforme (parametres.ts, plafondEffectif) :
 *   AVANT chaque appel, le coût ESTIMÉ (jetons d'entrée estimés + plafond de
 *   sortie) est RÉSERVÉ (`ia_reservations`) sous le verrou du cabinet, dans
 *   la transaction même de la vérification ; la réservation compte avec la
 *   consommation (`consommeDuMois`) jusqu'à la clôture, qui la solde et
 *   inscrit le coût réel. Des appels simultanés ne dépassent donc pas le
 *   plafond par leurs estimations ; seul l'écart entre le coût réel et
 *   l'estimation d'un appel (jetons d'entrée sous-estimés) peut le dépasser.
 *   Refus en 409 (ou gabarit si l'appelant l'a demandé). Une réservation
 *   orpheline (processus arrêté pendant l'appel) expire après
 *   DUREE_RESERVATION_MS.
 * - Appels simultanés : au plus APPELS_SIMULTANES_MAX réservations en cours
 *   par cabinet (même verrou) ; au-delà, 429 (immédiat) ou reprise du job.
 * - Alertes à 80 % et 100 % du plafond (consommation réelle) : une
 *   notification aux associés (ia.configurer) par seuil et par mois, sans
 *   montant (règle de notifier).
 * - Ratio coût/prix d'une mission : coût cumulé converti dans la devise de la
 *   mission (taux de conversion de départ ci-dessous, À VALIDER), rapporté
 *   aux honoraires de la dernière version figée du budget ; null sans budget
 *   figé.
 */

/**
 * Taux de conversion de départ : 1 USD = n unités MAJEURES de la devise.
 * À VALIDER par le métier (le dollar flotte) ; seul usage : le ratio
 * coût IA / prix de mission, indicatif.
 */
export const TAUX_USD_DEPART: Readonly<Record<Devise, number>> = {
  XOF: 600,
  XAF: 600,
  EUR: 0.92,
  USD: 1,
};
export const DATE_TAUX_USD_DEPART = "2026-10-06";

const MICRO_PAR_USD = 1_000_000;

export function debutDuMois(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function moisSuivant(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export const libelleMois = (d: Date) => d.toISOString().slice(0, 7);

const somme = (valeurs: readonly number[]) => valeurs.reduce((s, v) => s + v, 0);

/** Durée de vie d'une réservation : au-delà, l'appel est réputé abandonné (processus arrêté). */
export const DUREE_RESERVATION_MS = 30 * 60_000;
/** Appels au fournisseur en cours (réservations) au plus par cabinet. */
export const APPELS_SIMULTANES_MAX = 10;
/** Générations (demandes, gabarits compris) au plus par utilisateur et par jour civil UTC. */
export const QUOTA_GENERATIONS_UTILISATEUR_JOUR = 50;

/** Consommation RÉELLE inscrite (µUSD) du cabinet courant sur le mois de `maintenant`. */
async function consommationsDuMois(db: Db, maintenant: Date): Promise<number> {
  const r = await db.query(
    `SELECT cout_micro_usd::text AS cout FROM ia_consommations
     WHERE cree_le >= $1 AND cree_le < $2`,
    [debutDuMois(maintenant), moisSuivant(maintenant)],
  );
  return somme(r.rows.map((x) => Number(x.cout)));
}

/** Réservations en cours (non expirées) du cabinet courant : coût estimé cumulé et nombre. */
async function reservationsEnCours(
  db: Db,
  maintenant: Date,
): Promise<{ total: number; nombre: number }> {
  const r = await db.query(
    "SELECT cout_estime_micro_usd::text AS cout FROM ia_reservations WHERE expire_le > $1",
    [maintenant],
  );
  return { total: somme(r.rows.map((x) => Number(x.cout))), nombre: r.rows.length };
}

/**
 * Coût (µUSD) du cabinet courant sur le mois de `maintenant` au sens du
 * plafond : consommation inscrite + réservations des appels en cours.
 */
export async function consommeDuMois(db: Db, maintenant: Date): Promise<number> {
  return (
    (await consommationsDuMois(db, maintenant)) + (await reservationsEnCours(db, maintenant)).total
  );
}

/** Coût estimé d'un appel avant de le faire (prudent : plafond de jetons de sortie). */
export function estimerCoutAppel(modele: string, caracteresEntree: number, maxTokens: number) {
  return coutMicroUsd(modele, estimerTokens(caracteresEntree), maxTokens).cout;
}

export interface EtatPlafond {
  consomme: number;
  plafond: number;
  /** Le coût estimé de l'appel ferait dépasser le plafond (ou il est déjà atteint). */
  atteint: boolean;
}

/** Verrou du plafond du cabinet : sérialise vérifications et réservations simultanées. */
async function verrouillerPlafond(db: Db, cabinetId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `ia_plafond:${cabinetId}`,
  ]);
}

/** Plafond du mois (réservations comprises), sous verrou du cabinet, SANS réserver. */
export async function etatPlafond(
  db: Db,
  cabinetId: string,
  plafond: number,
  maintenant: Date,
  estimation: number,
): Promise<EtatPlafond> {
  await verrouillerPlafond(db, cabinetId);
  const consomme = await consommeDuMois(db, maintenant);
  return { consomme, plafond, atteint: consomme + estimation > plafond };
}

export type ResultatReservation =
  | { statut: "reservee"; id: string; cout: number }
  | { statut: "plafond"; consomme: number }
  | { statut: "simultanees" };

/**
 * Vérifie le plafond ET réserve le coût estimé d'un appel, sous le verrou du
 * cabinet, dans la transaction de l'appelant : la réservation est visible des
 * autres appels dès la validation de cette transaction. Une demande déjà
 * réservée (mode immédiat : réservée à la préparation) garde sa réservation.
 */
export async function reserverAppel(
  db: Db,
  r: {
    cabinetId: string;
    demandeId: string | null;
    estimation: number;
    plafond: number;
    maintenant: Date;
  },
): Promise<ResultatReservation> {
  await verrouillerPlafond(db, r.cabinetId);
  await db.query("DELETE FROM ia_reservations WHERE expire_le <= $1", [r.maintenant]);
  if (r.demandeId) {
    const existante = await db.query(
      "SELECT id, cout_estime_micro_usd::text AS cout FROM ia_reservations WHERE demande_id = $1",
      [r.demandeId],
    );
    const e = existante.rows[0];
    if (e) return { statut: "reservee", id: e.id as string, cout: Number(e.cout) };
  }
  const consomme = await consommationsDuMois(db, r.maintenant);
  const enCours = await reservationsEnCours(db, r.maintenant);
  if (consomme + enCours.total + r.estimation > r.plafond) {
    return { statut: "plafond", consomme: consomme + enCours.total };
  }
  if (enCours.nombre >= APPELS_SIMULTANES_MAX) return { statut: "simultanees" };
  const ins = await db.query(
    `INSERT INTO ia_reservations (cabinet_id, demande_id, cout_estime_micro_usd, cree_le, expire_le)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      r.cabinetId,
      r.demandeId,
      r.estimation,
      r.maintenant,
      new Date(r.maintenant.getTime() + DUREE_RESERVATION_MS),
    ],
  );
  return { statut: "reservee", id: ins.rows[0].id as string, cout: r.estimation };
}

/** Solde une réservation (clôture de l'appel, ou appel abandonné avant reprise). */
export async function solderReservation(db: Db, id: string): Promise<void> {
  await db.query("DELETE FROM ia_reservations WHERE id = $1", [id]);
}

export type IssueConsommation =
  "succes" | "sortie_invalide" | "annulee" | "test" | "delai_depasse" | "reponse_invalide";

export interface Consommation {
  cabinetId: string;
  demandeId: string | null;
  /**
   * Appel d'une évaluation de non-régression (rejeu réel, AGT-04) : sans demande de génération,
   * rattaché à la demande d'évaluation (migration 0270) ; compté dans le plafond mensuel.
   */
  evaluationDemandeId?: string | null;
  missionId: string | null;
  tache: TacheIa;
  modele: string;
  issue: IssueConsommation;
  sourceCle: SourceCle;
  tokensEntree: number;
  tokensSortie: number;
  dureeMs: number;
}

/**
 * Inscrit un appel facturé et envoie, au besoin, les alertes de plafond.
 * Renvoie le coût estimé et les notifications (e-mails après validation).
 */
export async function enregistrerConsommation(
  db: Db,
  c: Consommation,
  plafond: number,
  maintenant: Date,
): Promise<{ cout: number; tarifConnu: boolean; notifications: (NotificationCreee | null)[] }> {
  const { cout, connu } = coutMicroUsd(c.modele, c.tokensEntree, c.tokensSortie);
  await db.query(
    `INSERT INTO ia_consommations (cabinet_id, demande_id, mission_id, tache, modele, issue,
       source_cle, tokens_entree, tokens_sortie, cout_micro_usd, tarif_connu, duree_ms, cree_le,
       evaluation_demande_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      c.cabinetId,
      c.demandeId,
      c.missionId,
      c.tache,
      c.modele,
      c.issue,
      c.sourceCle,
      c.tokensEntree,
      c.tokensSortie,
      cout,
      connu,
      c.dureeMs,
      maintenant,
      c.evaluationDemandeId ?? null,
    ],
  );
  const notifications = await alertesPlafond(db, c.cabinetId, plafond, maintenant);
  return { cout, tarifConnu: connu, notifications };
}

/** Alerte une fois par seuil franchi (consommation réelle) et par mois (80 %, 100 %). */
export async function alertesPlafond(
  db: Db,
  cabinetId: string,
  plafond: number,
  maintenant: Date,
): Promise<(NotificationCreee | null)[]> {
  if (plafond <= 0) return [];
  const consomme = await consommationsDuMois(db, maintenant);
  const notifications: (NotificationCreee | null)[] = [];
  for (const seuil of SEUILS_ALERTE_PLAFOND_IA) {
    // Comparaison exacte sur entiers : consommé ≥ seuil % du plafond.
    if (consomme * 100 < plafond * seuil) continue;
    const r = await db.query(
      `INSERT INTO ia_alertes_plafond (cabinet_id, mois, seuil) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING seuil`,
      [cabinetId, debutDuMois(maintenant).toISOString().slice(0, 10), seuil],
    );
    if (!r.rows[0]) continue;
    for (const associe of await associesActifs(db)) {
      notifications.push(
        await notifier(db, {
          cabinetId,
          destinataireId: associe,
          type: "ia_plafond_alerte",
          titre:
            seuil >= 100
              ? "IA : plafond mensuel atteint, repli sur les gabarits"
              : `IA : ${seuil} % du plafond mensuel consommés`,
          corps:
            seuil >= 100
              ? "Les générations IA sont refusées jusqu'au mois prochain ou au relèvement du plafond."
              : "Vérifiez la consommation IA du cabinet et, au besoin, le plafond mensuel.",
          lien: "/parametres/ia",
          email: true,
        }),
      );
    }
  }
  return notifications;
}

/* ----- Rapports (GET /api/ia/couts) ----- */

/** Coût en µUSD → montant dans la devise (unités mineures), par les fonctions exactes du moteur. */
export function convertirCout(microUsd: number, devise: Devise): Montant {
  // µUSD → centimes de dollar (arrondi exact du moteur), puis conversion au taux de départ.
  const centimes = multiplierParRationnel(montant(microUsd, "USD"), {
    num: 1n,
    den: BigInt(MICRO_PAR_USD / 100),
  });
  if (devise === "USD") return centimes;
  return convertir(
    centimes,
    figerTauxChange("USD", devise, TAUX_USD_DEPART[devise], DATE_TAUX_USD_DEPART),
  );
}

export interface CoutsMois {
  mois: string;
  cout_micro_usd: number;
  appels: number;
}

/**
 * Coûts du cabinet : mois demandé, 12 derniers mois, plafond du cabinet,
 * plafond effectif (plafonné par celui de la plateforme) et part consommée de
 * ce dernier.
 */
export async function coutsCabinet(
  db: Db,
  mois: Date,
  plafond: number,
  plafondEffectif: number = plafond,
) {
  const debut = debutDuMois(mois);
  const debutHistorique = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() - 11, 1));
  const r = await db.query(
    `SELECT to_char(cree_le AT TIME ZONE 'UTC', 'YYYY-MM') AS mois, cout_micro_usd::text AS cout, issue
     FROM ia_consommations WHERE cree_le >= $1 AND cree_le < $2`,
    [debutHistorique, moisSuivant(debut)],
  );
  const parMois = new Map<string, CoutsMois>();
  for (let i = 0; i < 12; i++) {
    const m = libelleMois(new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() - i, 1)));
    parMois.set(m, { mois: m, cout_micro_usd: 0, appels: 0 });
  }
  for (const ligne of r.rows) {
    const m = parMois.get(ligne.mois as string);
    if (!m) continue;
    m.cout_micro_usd += Number(ligne.cout);
    m.appels += 1;
  }
  const courant = parMois.get(libelleMois(debut)) as CoutsMois;
  return {
    mois: courant.mois,
    cout_micro_usd: courant.cout_micro_usd,
    appels: courant.appels,
    plafond_mensuel_micro_usd: plafond,
    plafond_effectif_micro_usd: plafondEffectif,
    part_plafond: consommationBudgetaire(courant.cout_micro_usd, plafondEffectif),
    historique: [...parMois.values()],
  };
}

/** Coût IA cumulé des missions (paginé par curseur), avec le ratio coût/prix. */
export async function coutsMissions(
  db: Db,
  auth: Auth,
  curseur: string | undefined,
  limite: number,
) {
  const apres = decoderCurseur(curseur);
  const ids = await db.query(
    `SELECT DISTINCT c.mission_id::text AS id FROM ia_consommations c
     JOIN missions m ON m.id = c.mission_id
     WHERE ${filtreVisibilite(1, 2)} AND ($3::uuid IS NULL OR c.mission_id > $3::uuid)
     ORDER BY 1 LIMIT $4`,
    [voitToutesLesMissions(auth), auth.utilisateurId, apres?.[1] ?? null, limite + 1],
  );
  const page = ids.rows.slice(0, limite).map((x) => x.id as string);
  const suivant =
    ids.rows.length > limite && page.length > 0
      ? encoderCurseur(["", page[page.length - 1] as string])
      : null;
  if (page.length === 0) return { elements: [], curseur_suivant: null };
  const couts = await db.query(
    `SELECT mission_id::text AS mission_id, cout_micro_usd::text AS cout FROM ia_consommations
     WHERE mission_id = ANY ($1::uuid[])`,
    [page],
  );
  const missions = await db.query(
    "SELECT id::text AS id, intitule, devise FROM missions WHERE id = ANY ($1::uuid[])",
    [page],
  );
  const infos = new Map(missions.rows.map((m) => [m.id as string, m]));
  const elements = [];
  for (const id of page) {
    const lignes = couts.rows.filter((c) => c.mission_id === id);
    const cout = somme(lignes.map((c) => Number(c.cout)));
    const info = infos.get(id);
    const reference = versionDeReference(await chargerVersions(db, id));
    const prix = reference ? calculerBudget(versVersionMoteur(reference)).honoraires : null;
    const devise = (prix?.devise ?? info?.devise ?? "XOF") as Devise;
    const coutDevise = convertirCout(cout, devise);
    elements.push({
      mission_id: id,
      intitule: (info?.intitule as string | undefined) ?? null,
      cout_micro_usd: cout,
      appels: lignes.length,
      devise,
      cout_devise: coutDevise.valeur,
      prix_mission: prix?.valeur ?? null,
      ratio_cout_prix: prix ? consommationBudgetaire(coutDevise.valeur, prix.valeur) : null,
      // Seuil de 5 % comparé sur les entiers exacts : coût × 20 > prix.
      depasse_seuil: prix && prix.valeur > 0 ? coutDevise.valeur * 20 > prix.valeur : null,
    });
  }
  return { elements, curseur_suivant: suivant };
}
