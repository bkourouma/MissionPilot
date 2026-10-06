import {
  calculerBudget,
  calculerEcheancier,
  controlerEcheancierBudget,
  montant as montantMoteur,
  sommerJours,
  type DefinitionEcheancier,
  type Devise,
  type Echeance,
  type Montant,
  type TempsValide,
} from "@missionpilot/engines";
import type { TypeEcheance } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import {
  chargerGrilleVente,
  chargerVersions,
  resoudreTauxVente,
  versionDeReference,
  versVersionMoteur,
} from "../missions/budget.js";
import { nombre } from "../missions/outils.js";
import { jours } from "../temps/outils.js";

export const COLONNES_ECHEANCE = `e.id, e.mission_id, e.ordre, e.type, e.libelle, e.montant,
  e.pourcentage::float8 AS pourcentage, e.devise, e.date_prevue::text AS date_prevue, e.jalon_id,
  e.statut, e.periode_debut::text AS periode_debut, e.periode_fin::text AS periode_fin, e.cree_par,
  e.cree_le, e.modifie_le,
  (SELECT l.facture_id FROM facturation_liens l
   WHERE l.echeance_id = e.id AND l.libere_le IS NULL) AS facture_id`;

export interface EcheanceDb {
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
  statut: "prevue" | "a_facturer" | "facturee";
  periode_debut: string | null;
  periode_fin: string | null;
  facture_id: string | null;
}

const versEcheanceDb = (r: Record<string, unknown>): EcheanceDb =>
  ({ ...r, montant: nombre(r.montant) }) as unknown as EcheanceDb;

export async function chargerEcheances(db: Db, missionId: string): Promise<EcheanceDb[]> {
  const r = await db.query(
    `SELECT ${COLONNES_ECHEANCE} FROM echeances_facturation e WHERE e.mission_id = $1
     ORDER BY e.date_prevue, e.ordre, e.cree_le, e.id`,
    [missionId],
  );
  return r.rows.map(versEcheanceDb);
}

export async function exigerEcheance(db: Db, id: string, verrouiller = false): Promise<EcheanceDb> {
  const r = await db.query(
    `SELECT ${COLONNES_ECHEANCE} FROM echeances_facturation e WHERE e.id = $1
     ${verrouiller ? "FOR UPDATE OF e" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Échéance");
  return versEcheanceDb(r.rows[0]);
}

/**
 * Budget signé de la mission (FIN-03) : honoraires de la version de
 * référence (dernière version figée), calculés par le moteur. Il borne le
 * total de l'échéancier.
 */
export async function honorairesSignes(db: Db, mission: MissionAcces): Promise<Montant> {
  const reference = versionDeReference(await chargerVersions(db, mission.id));
  if (!reference) {
    throw conflit("La mission n'a pas de budget signé : signer la lettre de mission d'abord.");
  }
  return calculerBudget(versVersionMoteur(reference)).honoraires;
}

const versMoteur = (e: Pick<EcheanceDb, "libelle" | "date_prevue" | "montant" | "devise">) => ({
  libelle: e.libelle,
  date: e.date_prevue,
  montant: montantMoteur(e.montant, e.devise),
});

/**
 * Contrôle par le moteur que le total de l'échéancier ne dépasse pas le
 * budget signé (409 ECHEANCIER_DEPASSE_BUDGET sinon).
 */
export function exigerDansLeBudget(
  echeances: readonly Echeance[],
  budget: Montant,
): { total: Montant; depassement: Montant } {
  const c = controlerEcheancierBudget(echeances, budget);
  if (!c.conforme) {
    throw new AppError(
      409,
      "ECHEANCIER_DEPASSE_BUDGET",
      "Le total de l'échéancier dépasserait le budget signé : réviser le budget d'abord.",
    );
  }
  return c;
}

export function echeancesMoteur(echeances: readonly EcheanceDb[]): Echeance[] {
  return echeances.map(versMoteur);
}

export interface NouvelleEcheance {
  type: TypeEcheance;
  libelle: string;
  montant: number;
  pourcentage: number | null;
  date_prevue: string;
  jalon_id: string | null;
  statut: "prevue" | "a_facturer";
  periode_debut?: string | null;
  periode_fin?: string | null;
}

export async function insererEcheance(
  db: Db,
  cabinetId: string,
  mission: MissionAcces,
  e: NouvelleEcheance,
  ordre: number,
  auteurId: string,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO echeances_facturation (cabinet_id, mission_id, ordre, type, libelle, montant,
       pourcentage, devise, date_prevue, jalon_id, statut, periode_debut, periode_fin, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      cabinetId,
      mission.id,
      ordre,
      e.type,
      e.libelle,
      e.montant,
      e.pourcentage,
      mission.devise,
      e.date_prevue,
      e.jalon_id,
      e.statut,
      e.periode_debut ?? null,
      e.periode_fin ?? null,
      auteurId,
    ],
  );
  return r.rows[0].id as string;
}

/** Définition du moteur selon le mode de facturation de la mission (MIS-10). */
export interface DemandeGeneration {
  jalons?: {
    libelle: string;
    pourcentage: number;
    date: string;
    type: "acompte" | "jalon" | "avancement";
    jalon_id: string | null;
  }[];
  part_fixe?: number;
  part_variable?: { libelle: string; montant_maximum: number; atteinte: number; date: string };
  abonnement?: {
    libelle: string;
    montant_periodique: number;
    date_debut: string;
    nombre_periodes: number;
    periodicite: "mensuelle" | "trimestrielle" | "semestrielle" | "annuelle";
  };
}

/**
 * Échéances générées par le moteur depuis le mode de facturation : forfait
 * (jalons, par défaut 30 % à la signature et 70 % à la fin), forfait avec
 * part variable, abonnement. La régie se calcule sur les temps validés.
 */
export function genererEcheances(
  mission: MissionAcces & { date_fin: string | null; mode_facturation: string },
  budget: Montant,
  demande: DemandeGeneration,
): NouvelleEcheance[] {
  const devise = mission.devise as Devise;
  const signature = mission.date_signature ?? mission.date_debut ?? "2000-01-01";
  const jalons = demande.jalons ?? [
    {
      libelle: "Acompte à la signature",
      pourcentage: 30,
      date: signature,
      type: "acompte" as const,
      jalon_id: null,
    },
    {
      libelle: "Solde à la fin de la mission",
      pourcentage: 70,
      date: mission.date_fin ?? signature,
      type: "jalon" as const,
      jalon_id: null,
    },
  ];
  const jalonsMoteur = jalons.map((j) => ({
    libelle: j.libelle,
    pourcentage: j.pourcentage,
    date: j.date,
  }));
  let definition: DefinitionEcheancier;
  switch (mission.mode_facturation) {
    case "forfait":
      definition = { mode: "forfait", montant: budget, jalons: jalonsMoteur };
      break;
    case "forfait_variable": {
      const pv = demande.part_variable;
      if (!pv) {
        throw new AppError(
          400,
          "REQUETE_INVALIDE",
          "Forfait avec part variable : indiquer la part variable (montant maximum, atteinte, date).",
        );
      }
      definition = {
        mode: "forfait_variable",
        partFixe: montantMoteur(demande.part_fixe ?? budget.valeur, devise),
        jalons: jalonsMoteur,
        partVariable: {
          libelle: pv.libelle,
          montantMaximum: montantMoteur(pv.montant_maximum, devise),
          atteinte: pv.atteinte,
          date: pv.date,
        },
      };
      break;
    }
    case "abonnement": {
      const a = demande.abonnement;
      if (!a) {
        throw new AppError(
          400,
          "REQUETE_INVALIDE",
          "Abonnement : indiquer le montant périodique, la date de début, le nombre de périodes et la périodicité.",
        );
      }
      definition = {
        mode: "abonnement",
        libelle: a.libelle,
        montantPeriodique: montantMoteur(a.montant_periodique, devise),
        dateDebut: a.date_debut,
        nombrePeriodes: a.nombre_periodes,
        periodicite: a.periodicite,
      };
      break;
    }
    default:
      throw conflit(
        "Mission en régie : les échéances se calculent sur les temps validés (échéancier de régie).",
      );
  }
  const calculees = calculerEcheancier(definition);
  return calculees.map((e, i) => {
    const jalon = jalons[i];
    const type: TypeEcheance =
      definition.mode === "abonnement"
        ? "abonnement"
        : definition.mode === "forfait_variable" && i === calculees.length - 1
          ? "part_variable"
          : (jalon?.type ?? "jalon");
    return {
      type,
      libelle: e.libelle,
      montant: e.montant.valeur,
      pourcentage:
        jalon && type !== "abonnement" && type !== "part_variable" ? jalon.pourcentage : null,
      date_prevue: e.date,
      jalon_id: jalon && type !== "abonnement" && type !== "part_variable" ? jalon.jalon_id : null,
      statut: "prevue" as const,
    };
  });
}

/* ----- Régie sur temps validés (FIN-06) ----- */

interface ElementTemps {
  ligne_temps_id: string | null;
  correction_id: string | null;
  date: string;
  periode: string;
  centiemes: number;
  collaborateur_id: string;
  grade_code: string | null;
}

/**
 * Temps VALIDÉS de la mission (feuilles validées ou verrouillées, corrections
 * validées) jusqu'à une date, pas encore rattachés à une échéance. La
 * période est le dernier jour du mois de la prestation.
 */
async function tempsNonRattaches(
  db: Db,
  missionId: string,
  jusquAu: string,
): Promise<ElementTemps[]> {
  const r = await db.query(
    `SELECT l.id AS ligne_temps_id, NULL::uuid AS correction_id, l.date::text AS date,
       (date_trunc('month', l.date) + interval '1 month - 1 day')::date::text AS periode,
       l.centiemes, f.collaborateur_id, g.code AS grade_code
     FROM lignes_temps l JOIN feuilles_temps f ON f.id = l.feuille_id
     JOIN collaborateurs c ON c.id = f.collaborateur_id LEFT JOIN grades g ON g.id = c.grade_id
     WHERE l.mission_id = $1 AND f.statut IN ('validee', 'verrouillee') AND l.date <= $2
       AND NOT EXISTS (SELECT 1 FROM echeance_temps et WHERE et.ligne_temps_id = l.id)
     UNION ALL
     SELECT NULL::uuid, x.id, x.date::text,
       (date_trunc('month', x.date) + interval '1 month - 1 day')::date::text,
       x.nouvelle_centiemes - x.ancienne_centiemes, x.collaborateur_id, g.code
     FROM corrections_temps x JOIN collaborateurs c ON c.id = x.collaborateur_id
     LEFT JOIN grades g ON g.id = c.grade_id
     WHERE x.mission_id = $1 AND x.statut = 'validee' AND x.date <= $2
       AND NOT EXISTS (SELECT 1 FROM echeance_temps et WHERE et.correction_id = x.id)
     ORDER BY 3, 1, 2`,
    [missionId, jusquAu],
  );
  return r.rows.map((l) => ({ ...l, centiemes: Number(l.centiemes) })) as ElementTemps[];
}

export interface EcheanceRegie {
  echeance: NouvelleEcheance;
  temps: (ElementTemps & { taux: number })[];
}

/**
 * Échéances de régie (une par mois) sur les temps validés non encore
 * rattachés : jours × taux résolu, calculés par le moteur (`calculerEcheancier`
 * en mode régie). Taux d'un collaborateur : prix journalier du budget signé
 * pour lui, sinon pour son grade, sinon taux fixé, négocié ou standard du
 * grade à la date (moteur). Une période dont les corrections rendent le total
 * négatif est refusée (à traiter par avoir).
 */
export async function calculerRegie(
  db: Db,
  mission: MissionAcces,
  jusquAu: string,
): Promise<EcheanceRegie[]> {
  const devise = mission.devise as Devise;
  const elements = await tempsNonRattaches(db, mission.id, jusquAu);
  if (elements.length === 0) return [];
  const reference = versionDeReference(await chargerVersions(db, mission.id));
  const prixBudget = new Map(
    (reference?.lignes ?? [])
      .filter((l) => l.nature === "honoraires" && l.prix_journalier !== null)
      .map((l) => [l.cle, l.prix_journalier as number]),
  );
  const grille = await chargerGrilleVente(db, mission);
  const tauxDe = (e: ElementTemps): number =>
    prixBudget.get(`honoraires:collaborateur:${e.collaborateur_id}`) ??
    prixBudget.get(`honoraires:grade:${e.grade_code ?? ""}`) ??
    resoudreTauxVente(grille, e.grade_code ?? "", e.date).valeur;
  const avecTaux = elements.map((e) => ({ ...e, taux: tauxDe(e) }));

  // Regroupement par période et taux ; les jours sont sommés au centième.
  const groupes = new Map<string, { periode: string; taux: number; jours: number[] }>();
  for (const e of avecTaux) {
    const cle = `${e.periode}|${e.taux}`;
    const g = groupes.get(cle) ?? { periode: e.periode, taux: e.taux, jours: [] };
    g.jours.push(jours(e.centiemes));
    groupes.set(cle, g);
  }
  const temps: TempsValide[] = [];
  for (const g of groupes.values()) {
    const total = sommerJours(g.jours);
    if (total < 0) {
      throw conflit(
        `Corrections négatives sur la période du ${g.periode} : traiter l'écart par un avoir.`,
      );
    }
    temps.push({ periode: g.periode, jours: total, tauxJournalier: montantMoteur(g.taux, devise) });
  }
  const echeances = calculerEcheancier({ mode: "regie", temps });
  return echeances.map((e) => {
    const rattaches = avecTaux.filter((t) => t.periode === e.date);
    const dates = rattaches.map((t) => t.date).sort();
    return {
      echeance: {
        type: "regie",
        libelle: e.libelle,
        montant: e.montant.valeur,
        pourcentage: null,
        date_prevue: e.date,
        jalon_id: null,
        statut: "a_facturer",
        periode_debut: dates[0] as string,
        periode_fin: dates[dates.length - 1] as string,
      },
      temps: rattaches,
    };
  });
}

export async function rattacherTemps(
  db: Db,
  cabinetId: string,
  missionId: string,
  echeanceId: string,
  temps: EcheanceRegie["temps"],
): Promise<void> {
  for (const t of temps) {
    if (t.centiemes === 0) continue;
    await db.query(
      `INSERT INTO echeance_temps (cabinet_id, mission_id, echeance_id, ligne_temps_id, correction_id,
         centiemes, taux_journalier)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [cabinetId, missionId, echeanceId, t.ligne_temps_id, t.correction_id, t.centiemes, t.taux],
    );
  }
}
