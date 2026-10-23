import {
  calculerEtatVoyant,
  type EntreesVoyant,
  type EtatVoyant,
  type NiveauAlerte,
  type VoyantUrgence,
} from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { DossierRed } from "./acces.js";
import { dernierScore } from "./alerte.js";
import { resumeCloture } from "./cloture.js";
import { evaluerCovenantsDossier } from "./covenants.js";
import { resumePlan } from "./plan.js";
import { alertesSuiviDossier } from "./suivi.js";
import { resumeTresorerie } from "./tresorerie.js";
import { derniereUrgence } from "./urgence.js";

/*
 * Voyant de pilotage d'un dossier (RED-15, version interne). Rassemble les entrées déjà calculées
 * par les services du module (dernier voyant d'urgence, dernier niveau d'alerte précoce, semaines
 * de tension de la trésorerie, covenants en défaut, actions en retard, suivi post-mission, bilan
 * de clôture) et les passe au moteur `calculerEtatVoyant`. Aucune règle ni aucun chiffre ici.
 *
 * Utilisable sans HTTP (brief quotidien, automatisation) : l'appelant a déjà établi la
 * visibilité du dossier. Lecture seule, aucun journal. Le voyant est INDICATIF.
 */

export type ResumeTresorerieDossier = Awaited<ReturnType<typeof resumeTresorerie>>;
export type ResumePlanDossier = Awaited<ReturnType<typeof resumePlan>>;

/** Entrées du moteur et données lues pour les produire (réutilisées par le tableau de bord). */
export interface DonneesVoyant {
  entrees: EntreesVoyant;
  urgence: { voyant: string; cree_le: Date } | null;
  alerte: { niveau: string; score: number | null; cree_le: Date } | null;
  tresorerie: ResumeTresorerieDossier;
  plan: ResumePlanDossier;
  covenantsEnDefaut: number | null;
}

/**
 * Lit les entrées du voyant. Le suivi et le bilan de clôture ne concernent qu'un dossier clos ;
 * un suivi sans aucune alerte ne compte pas comme une donnée (le voyant reste fondé sur le reste).
 */
export async function rassemblerDonneesVoyant(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
): Promise<DonneesVoyant> {
  const urgence = await derniereUrgence(db, dossier.id);
  const alerte = await dernierScore(db, dossier.id);
  const tresorerie = await resumeTresorerie(db, dossier.id);
  const covenantsEnDefaut = await evaluerCovenantsDossier(db, auth, dossier);
  const plan = await resumePlan(db, dossier);
  const clos = dossier.statut === "clos";
  const suivi = clos ? await alertesSuiviDossier(db, auth, dossier) : null;
  const cloture = clos ? await resumeCloture(db, dossier.id) : null;
  const entrees: EntreesVoyant = {
    voyantUrgence: (urgence?.voyant as VoyantUrgence | undefined) ?? null,
    niveauAlerte: (alerte?.niveau as NiveauAlerte | undefined) ?? null,
    semainesTension: tresorerie ? tresorerie.semaines_tension.length : null,
    covenantsEnDefaut,
    actionsEnRetard: plan.en_retard,
    alertesSuivi: suivi && suivi.nombre > 0 ? suivi : null,
    statutCloture: cloture ? cloture.statut : null,
  };
  return {
    entrees,
    urgence: urgence ? { voyant: urgence.voyant, cree_le: urgence.cree_le } : null,
    alerte: alerte ? { niveau: alerte.niveau, score: alerte.score, cree_le: alerte.cree_le } : null,
    tresorerie,
    plan,
    covenantsEnDefaut,
  };
}

/** Voyant de pilotage et motifs d'un dossier (moteur `calculerEtatVoyant`). */
export async function etatVoyantDossier(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
): Promise<EtatVoyant> {
  return calculerEtatVoyant((await rassemblerDonneesVoyant(db, auth, dossier)).entrees);
}
