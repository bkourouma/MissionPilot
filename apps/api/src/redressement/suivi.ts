import {
  calculerEcheancesJalons,
  controlerEvenementJalon,
  ErreurRedressement,
  evaluerSuivi,
  MOIS_JALONS_PAR_DEFAUT,
  ratiosSuiviDepuisExercice,
  type EvenementJalon,
  type JalonSuiviEntree,
  type RaisonEvenementRefuse,
  type RatiosSuivi,
  type ReleveSuiviEntree,
  type ResultatSuivi,
} from "@missionpilot/engines";
import {
  RED_SUIVI_MENTION,
  type RedSuiviEvenementCreation,
  type RedSuiviEvenementVue,
  type RedSuiviJalonVue,
  type RedSuiviPlanCreation,
  type RedSuiviRatiosVue,
  type RedSuiviReleveCreation,
  type RedSuiviReleveVue,
  type RedSuiviSourceReleve,
  type RedSuiviTypeEvenement,
  type RedSuiviVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import type { DossierRed } from "./acces.js";
import { dateDuJour } from "./dates.js";
import { journalRed } from "./journal.js";
import { verifierDebit } from "./limites.js";
import { calculerRatiosDossier } from "./ratios.js";
import { DEBIT_EVENEMENTS_SUIVI, DEBIT_PLANS_SUIVI, DEBIT_RELEVES_SUIVI } from "./suivi-limites.js";
import { isoOuVide, personne } from "./vues.js";

/*
 * Suivi post-mission (RED-09, lot 2). INTERNE au cabinet : aucun accès du portail, aucun job,
 * aucun envoi externe. Plan, jalons, relevés et événements de jalon sont en AJOUT SEUL
 * (migration 0491) et ne s'écrivent que sur un dossier CLOS (MPZ19), même mission clôturée. Les
 * échéances, l'état des jalons, la comparaison des relevés à la référence de clôture et les alertes
 * sortent du moteur (`suivi.ts` de packages/engines) À CHAQUE LECTURE, à la date du jour du
 * serveur ; rien n'est stocké. Aucun calcul ici. L'instantané d'un relevé est calculé depuis le
 * moteur de ratios (derniers états acceptés, correspondance courante).
 */

const message = (raison: RaisonEvenementRefuse): string => {
  switch (raison) {
    case "jalon_deja_realise":
      return "Ce jalon est déjà réalisé : il ne change plus.";
    case "report_non_posterieur":
      return "Un report vise une date postérieure à la date prévue courante du jalon.";
    case "realisation_avant_cloture":
      return "Un jalon ne se réalise pas avant la clôture du dossier.";
    case "trop_d_evenements":
      return "Le plafond d'événements de ce jalon est atteint.";
  }
};

export function exigerDossierClos(dossier: DossierRed): void {
  if (dossier.statut !== "clos") {
    throw new AppError(
      409,
      "RED_DOSSIER_NON_CLOS",
      "Le suivi post-mission suit la clôture du dossier.",
    );
  }
}

interface PlanLu {
  id: string;
  date_cloture: string;
  reference_ratios: RatiosSuivi;
  reference_exercice: number | null;
  reference_correspondance_version: number | null;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
}

async function lirePlanSuivi(db: Db, dossierId: string): Promise<PlanLu | null> {
  const r = await db.query(
    `SELECT p.id, p.date_cloture::text AS date_cloture, p.reference_ratios, p.reference_exercice,
       p.reference_correspondance_version, p.cree_par, u.nom AS cree_par_nom, p.cree_le
     FROM red_suivi_plans p JOIN utilisateurs u ON u.id = p.cree_par
     WHERE p.dossier_id = $1`,
    [dossierId],
  );
  return (r.rows[0] as PlanLu | undefined) ?? null;
}

interface JalonLu {
  id: string;
  rang: number;
  libelle: string;
  date_prevue: string;
  evenements: (EvenementJalon & { vue: RedSuiviEvenementVue })[];
  releves: (ReleveSuiviEntree & { vue: RedSuiviReleveVue })[];
}

/** Jalons du dossier avec leurs événements et relevés, dans l'ordre chronologique d'enregistrement. */
async function lireJalons(db: Db, dossierId: string): Promise<JalonLu[]> {
  const jalons = await db.query(
    `SELECT j.id, j.rang, j.libelle, j.date_prevue::text AS date_prevue
     FROM red_suivi_jalons j WHERE j.dossier_id = $1 ORDER BY j.rang`,
    [dossierId],
  );
  const evenements = await db.query(
    `SELECT e.id, e.jalon_id, e.type, e.date_effet::text AS date_effet, e.motif, e.cree_par,
       u.nom AS cree_par_nom, e.cree_le
     FROM red_suivi_evenements e JOIN utilisateurs u ON u.id = e.cree_par
     WHERE e.dossier_id = $1 ORDER BY e.cree_le, e.id`,
    [dossierId],
  );
  const releves = await db.query(
    `SELECT r.id, r.jalon_id, r.date_releve::text AS date_releve, r.source, r.ratios,
       r.correspondance_version, r.exercice, r.commentaire, r.cree_par, u.nom AS cree_par_nom, r.cree_le
     FROM red_suivi_releves r JOIN utilisateurs u ON u.id = r.cree_par
     WHERE r.dossier_id = $1 ORDER BY r.cree_le, r.id`,
    [dossierId],
  );
  const lus: JalonLu[] = (jalons.rows as Record<string, unknown>[]).map((j) => ({
    id: j.id as string,
    rang: j.rang as number,
    libelle: j.libelle as string,
    date_prevue: j.date_prevue as string,
    evenements: [],
    releves: [],
  }));
  const parId = new Map(lus.map((j) => [j.id, j]));
  for (const e of evenements.rows as Record<string, unknown>[]) {
    parId.get(e.jalon_id as string)?.evenements.push({
      type: e.type as RedSuiviTypeEvenement,
      dateEffet: e.date_effet as string,
      vue: {
        id: e.id as string,
        type: e.type as RedSuiviTypeEvenement,
        date_effet: e.date_effet as string,
        motif: (e.motif as string | null) ?? null,
        cree_par: personne(e.cree_par as string, e.cree_par_nom as string),
        cree_le: isoOuVide(e.cree_le as Date),
      },
    });
  }
  for (const r of releves.rows as Record<string, unknown>[]) {
    const ratios = r.ratios as RedSuiviRatiosVue;
    parId.get(r.jalon_id as string)?.releves.push({
      id: r.id as string,
      dateReleve: r.date_releve as string,
      ratios,
      vue: {
        id: r.id as string,
        jalon_id: r.jalon_id as string,
        date_releve: r.date_releve as string,
        source: r.source as RedSuiviSourceReleve,
        ratios,
        correspondance_version: (r.correspondance_version as number | null) ?? null,
        exercice: (r.exercice as number | null) ?? null,
        commentaire: (r.commentaire as string | null) ?? null,
        cree_par: personne(r.cree_par as string, r.cree_par_nom as string),
        cree_le: isoOuVide(r.cree_le as Date),
      },
    });
  }
  return lus;
}

const versEntreeMoteur = (j: JalonLu): JalonSuiviEntree => ({
  id: j.id,
  rang: j.rang,
  libelle: j.libelle,
  datePrevue: j.date_prevue,
  evenements: j.evenements.map((e) => ({ type: e.type, dateEffet: e.dateEffet })),
  releves: j.releves.map((r) => ({ id: r.id, dateReleve: r.dateReleve, ratios: r.ratios })),
});

/** Suivi évalué par le moteur à la date du jour : jalons, comparaisons et alertes. */
async function evaluer(
  db: Db,
  dossier: DossierRed,
): Promise<{ plan: PlanLu; jalons: JalonLu[]; date: string; resultat: ResultatSuivi } | null> {
  const plan = await lirePlanSuivi(db, dossier.id);
  if (!plan) return null;
  const jalons = await lireJalons(db, dossier.id);
  const date = dateDuJour();
  const resultat = evaluerSuivi({
    dateReference: date,
    jalons: jalons.map(versEntreeMoteur),
    referenceRatios: plan.reference_ratios,
  });
  return { plan, jalons, date, resultat };
}

/** Lecture du suivi d'un dossier (jalons, relevés, alertes calculées à la date du jour). */
export async function lireSuivi(db: Db, dossier: DossierRed): Promise<RedSuiviVue> {
  const base = {
    dossier_id: dossier.id,
    dossier_clos: dossier.statut === "clos",
    mention: RED_SUIVI_MENTION,
  };
  const e = await evaluer(db, dossier);
  if (!e) {
    return {
      ...base,
      date_reference: dateDuJour(),
      plan: null,
      jalons: [],
      alertes: [],
      synthese: { nombre: 0, attention: 0, information: 0 },
    };
  }
  const evalues = new Map(e.resultat.jalons.map((j) => [j.id, j]));
  const jalons: RedSuiviJalonVue[] = e.jalons.map((j) => {
    const ev = evalues.get(j.id);
    if (!ev) throw new Error("Jalon sans évaluation.");
    return {
      id: j.id,
      rang: j.rang,
      libelle: j.libelle,
      date_prevue: j.date_prevue,
      date_prevue_courante: ev.etat.datePrevueCourante,
      statut: ev.etat.statut,
      realise_le: ev.etat.realiseLe,
      nombre_reports: ev.etat.nombreReports,
      retard_jours: ev.etat.retardJours,
      jours_restants: ev.etat.joursRestants,
      evenements: j.evenements.map((x) => x.vue),
      releves: j.releves.map((x) => x.vue),
      comparaisons: ev.comparaisons.map((c) => ({
        ratio: c.cle,
        reference_pb: c.referencePb,
        releve_pb: c.relevePb,
        variation_pb: c.variationPb,
        sens: c.sens,
        gravite: c.gravite,
      })),
    };
  });
  return {
    ...base,
    date_reference: e.date,
    plan: {
      id: e.plan.id,
      date_cloture: e.plan.date_cloture,
      reference: {
        ratios: e.plan.reference_ratios,
        exercice: e.plan.reference_exercice,
        correspondance_version: e.plan.reference_correspondance_version,
      },
      cree_par: personne(e.plan.cree_par, e.plan.cree_par_nom),
      cree_le: isoOuVide(e.plan.cree_le),
    },
    jalons,
    alertes: e.resultat.alertes.map((a) => ({
      type: a.type,
      gravite: a.gravite,
      jalon_id: a.jalonId,
      jalon_rang: a.jalonRang,
      ratio: a.ratio,
      libelle: a.libelle,
    })),
    synthese: { ...e.resultat.synthese },
  };
}

/**
 * Nombre d'alertes internes du suivi d'un dossier (tableau de bord), calculées à la date du jour ;
 * zéro sans suivi. Lecture seule : l'appelant a déjà établi la visibilité du dossier.
 */
export async function alertesSuiviDossier(
  db: Db,
  _auth: Auth,
  dossier: DossierRed,
): Promise<{ nombre: number; attention: number }> {
  const e = await evaluer(db, dossier);
  if (!e) return { nombre: 0, attention: 0 };
  return { nombre: e.resultat.synthese.nombre, attention: e.resultat.synthese.attention };
}

/** Jour UTC de la clôture du dossier (base des échéances). */
async function dateClotureDossier(db: Db, dossierId: string): Promise<string> {
  const r = await db.query(
    "SELECT (clos_le AT TIME ZONE 'UTC')::date::text AS d FROM red_dossiers WHERE id = $1",
    [dossierId],
  );
  return r.rows[0].d as string;
}

/** Créer le plan de suivi (jalons par défaut à 6 et 12 mois), dossier clos requis. */
export async function creerPlanSuivi(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedSuiviPlanCreation,
): Promise<RedSuiviVue> {
  exigerDossierClos(dossier);
  if (await lirePlanSuivi(db, dossier.id)) {
    throw new AppError(409, "RED_SUIVI_EXISTE", "Ce dossier a déjà un suivi post-mission.");
  }
  await verifierDebit(db, auth, DEBIT_PLANS_SUIVI);
  const dateCloture = await dateClotureDossier(db, dossier.id);
  const echeances = calculerEcheancesJalons(
    dateCloture,
    corps.jalons ? corps.jalons.map((j) => j.mois) : MOIS_JALONS_PAR_DEFAUT,
    corps.jalons ? corps.jalons.map((j) => j.libelle ?? null) : [],
  );
  // Référence de clôture : ratios du dernier état accepté, par le moteur de ratios.
  const calcul = await calculerRatiosDossier(db, dossier);
  const dernier = calcul.exercices[0];
  const reference = dernier ? ratiosSuiviDepuisExercice(dernier.ratios.ratios) : {};
  const plan = await db.query(
    `INSERT INTO red_suivi_plans (cabinet_id, dossier_id, date_cloture, reference_ratios,
       reference_exercice, reference_correspondance_version, cree_par)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      dateCloture,
      JSON.stringify(reference),
      dernier ? dernier.lu.exercice : null,
      dernier ? calcul.correspondanceVersion : null,
      auth.utilisateurId,
    ],
  );
  const planId = plan.rows[0].id as string;
  for (const e of echeances) {
    await db.query(
      `INSERT INTO red_suivi_jalons (cabinet_id, dossier_id, plan_id, rang, mois, libelle, date_prevue, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        auth.cabinetId,
        dossier.id,
        planId,
        e.rang,
        e.mois,
        e.libelle,
        e.datePrevue,
        auth.utilisateurId,
      ],
    );
  }
  await journalRed(db, auth, "red_suivi_plan", "plan_creation", planId, {
    dossier_id: dossier.id,
    jalons: echeances.length,
    reference_ratios: Object.keys(reference).length,
  });
  return lireSuivi(db, dossier);
}

async function jalonDuDossier(db: Db, dossierId: string, jalonId: string): Promise<JalonLu> {
  const jalon = (await lireJalons(db, dossierId)).find((j) => j.id === jalonId);
  if (!jalon) throw introuvable("Jalon de suivi");
  return jalon;
}

/** Enregistrer un relevé (indicateurs saisis, ou instantané des ratios du dernier état accepté). */
export async function enregistrerReleve(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedSuiviReleveCreation,
): Promise<RedSuiviVue> {
  exigerDossierClos(dossier);
  await jalonDuDossier(db, dossier.id, corps.jalon_id);
  await verifierDebit(db, auth, DEBIT_RELEVES_SUIVI);
  let ratios: Record<string, number> = {};
  let correspondanceVersion: number | null = null;
  let exercice: number | null = null;
  if (corps.source === "instantane") {
    const calcul = await calculerRatiosDossier(db, dossier);
    const dernier = calcul.exercices[0];
    if (!dernier) {
      throw new ErreurRedressement(
        "BASE_INCOMPLETE",
        "Aucun état financier accepté pour ce client : l'instantané des ratios est impossible.",
      );
    }
    ratios = { ...ratiosSuiviDepuisExercice(dernier.ratios.ratios) };
    if (Object.keys(ratios).length === 0) {
      throw new ErreurRedressement(
        "BASE_INCOMPLETE",
        "Aucun ratio calculable sur le dernier état accepté : renseignez la correspondance de postes.",
      );
    }
    correspondanceVersion = calcul.correspondanceVersion;
    exercice = dernier.lu.exercice;
  } else {
    for (const [cle, valeur] of Object.entries(corps.ratios ?? {})) {
      if (valeur !== undefined) ratios[cle] = valeur;
    }
  }
  const r = await db.query(
    `INSERT INTO red_suivi_releves (cabinet_id, dossier_id, jalon_id, date_releve, source, ratios,
       correspondance_version, exercice, commentaire, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      corps.jalon_id,
      corps.date_releve,
      corps.source,
      JSON.stringify(ratios),
      correspondanceVersion,
      exercice,
      corps.commentaire ?? null,
      auth.utilisateurId,
    ],
  );
  await journalRed(db, auth, "red_suivi_releve", "releve", r.rows[0].id as string, {
    dossier_id: dossier.id,
    jalon_id: corps.jalon_id,
    source: corps.source,
    ratios: Object.keys(ratios).length,
  });
  return lireSuivi(db, dossier);
}

/** Marquer un jalon réalisé, ou le reporter (nouvelle date prévue et motif). */
export async function enregistrerEvenement(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  jalonId: string,
  corps: RedSuiviEvenementCreation,
): Promise<RedSuiviVue> {
  exigerDossierClos(dossier);
  const jalon = await jalonDuDossier(db, dossier.id, jalonId);
  const plan = await lirePlanSuivi(db, dossier.id);
  if (!plan) throw introuvable("Suivi post-mission");
  const refus = controlerEvenementJalon(
    versEntreeMoteur(jalon),
    { type: corps.type, dateEffet: corps.date_effet },
    plan.date_cloture,
  );
  if (refus) throw new AppError(409, "RED_SUIVI_INCOHERENT", message(refus));
  await verifierDebit(db, auth, DEBIT_EVENEMENTS_SUIVI);
  const r = await db.query(
    `INSERT INTO red_suivi_evenements (cabinet_id, dossier_id, jalon_id, type, date_effet, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      jalonId,
      corps.type,
      corps.date_effet,
      corps.motif ?? null,
      auth.utilisateurId,
    ],
  );
  await journalRed(db, auth, "red_suivi_evenement", "evenement", r.rows[0].id as string, {
    dossier_id: dossier.id,
    jalon_id: jalonId,
    type: corps.type,
  });
  return lireSuivi(db, dossier);
}
