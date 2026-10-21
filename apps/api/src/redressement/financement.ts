import {
  calculerPlanFinancement,
  proposerLignesFinancement,
  type EcheanceFinancement,
  type LigneFinancement,
  type ResultatFinancement,
  type SensFinancementRed,
  type TypePeriodeFinancementRed,
} from "@missionpilot/engines";
import type {
  RedFinancementPropositionQuery,
  RedFinancementPropositionVue,
  RedFinancementVersionCreation,
  RedFinancementVersionVue,
  RedFinancementVue,
  RedLigneFinancementVue,
  RedPlanFinancementVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { DossierRed } from "./acces.js";
import { chargerCreanciers, situationDe } from "./creanciers.js";
import { dateDuJour } from "./dates.js";
import { DEBIT_VERSIONS_FINANCEMENT } from "./financement-limites.js";
import { journalRed } from "./journal.js";
import { verifierDebit } from "./limites.js";
import { projectionCourante } from "./tresorerie.js";
import { isoOuVide, personne } from "./vues.js";

/*
 * Plan de financement (RED-06, lot 2) : versions en AJOUT SEUL (red_financement_versions et
 * lignes). Totaux par période et cumulés, soldes, équilibre ou insuffisance et couvertures sont
 * calculés à la LECTURE par le moteur (`calculerPlanFinancement`) ; la proposition d'emplois
 * (`proposerLignesFinancement`) n'écrit rien. L'API ne fait aucune addition de montants.
 */

const HISTORIQUE_MAX = 100;
const TYPE_PAR_DEFAUT: TypePeriodeFinancementRed = "annee";
const PERIODES_PAR_DEFAUT = 3;

interface VersionFinancementLue {
  id: string;
  version: number;
  date_debut: string;
  type_periode: TypePeriodeFinancementRed;
  nombre_periodes: number;
  motif: string | null;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  lignes: RedLigneFinancementVue[];
}

/** Version courante (la plus haute) avec ses lignes, ou null. */
async function versionCourante(db: Db, dossierId: string): Promise<VersionFinancementLue | null> {
  const r = await db.query(
    `SELECT v.id, v.version, v.date_debut::text AS date_debut, v.type_periode, v.nombre_periodes, v.motif,
       v.cree_par, u.nom AS cree_par_nom, v.cree_le
     FROM red_financement_versions v JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT 1`,
    [dossierId],
  );
  const v = r.rows[0] as Record<string, unknown> | undefined;
  if (!v) return null;
  const lignes = await db.query(
    `SELECT l.id, l.rang, l.periode, l.sens, l.nature, l.libelle, l.montant::text AS montant
     FROM red_financement_lignes l WHERE l.version_id = $1 ORDER BY l.rang`,
    [v.id],
  );
  return {
    id: v.id as string,
    version: v.version as number,
    date_debut: v.date_debut as string,
    type_periode: v.type_periode as TypePeriodeFinancementRed,
    nombre_periodes: v.nombre_periodes as number,
    motif: (v.motif as string | null) ?? null,
    cree_par: v.cree_par as string,
    cree_par_nom: v.cree_par_nom as string,
    cree_le: v.cree_le as Date,
    lignes: (lignes.rows as Record<string, unknown>[]).map((l) => ({
      id: l.id as string,
      rang: l.rang as number,
      periode: l.periode as number,
      sens: l.sens as SensFinancementRed,
      nature: l.nature as string,
      libelle: (l.libelle as string | null) ?? null,
      montant: Number(l.montant),
    })),
  };
}

const versLigneMoteur = (l: RedLigneFinancementVue): LigneFinancement => ({
  periode: l.periode,
  sens: l.sens,
  nature: l.nature,
  montant: l.montant,
});

function vuePlan(r: ResultatFinancement): RedPlanFinancementVue {
  return {
    periodes: r.periodes.map((p) => ({
      periode: p.periode,
      debut: p.debut,
      fin: p.fin,
      emplois: p.emplois,
      ressources: p.ressources,
      solde: p.solde,
      statut: p.statut,
      couverture_pb: p.couverturePb,
      cumul_emplois: p.cumulEmplois,
      cumul_ressources: p.cumulRessources,
      solde_cumule: p.soldeCumule,
      couverture_cumulee_pb: p.couvertureCumuleePb,
      statut_cumule: p.statutCumule,
      par_nature: p.parNature.map((n) => ({ sens: n.sens, nature: n.nature, montant: n.montant })),
    })),
    totaux: { emplois: r.totaux.emplois, ressources: r.totaux.ressources, solde: r.totaux.solde },
    couverture_totale_pb: r.couvertureTotalePb,
    periodes_insuffisance: [...r.periodesInsuffisance],
    premiere_periode_insuffisance: r.premierePeriodeInsuffisance,
    insuffisance_maximale_cumulee: r.insuffisanceMaximaleCumulee,
    equilibre: r.equilibre,
  };
}

function vueVersion(v: VersionFinancementLue): RedFinancementVersionVue {
  return {
    id: v.id,
    version: v.version,
    date_debut: v.date_debut,
    type_periode: v.type_periode,
    nombre_periodes: v.nombre_periodes,
    motif: v.motif,
    cree_par: personne(v.cree_par, v.cree_par_nom),
    cree_le: isoOuVide(v.cree_le),
    lignes: v.lignes,
  };
}

/** Plan courant, calculé par le moteur, et historique des versions. */
export async function lireFinancement(db: Db, dossier: DossierRed): Promise<RedFinancementVue> {
  const historique = await db.query(
    `SELECT v.id, v.version, v.date_debut::text AS date_debut, v.type_periode, v.nombre_periodes, v.motif,
       v.cree_par, u.nom AS cree_par_nom, v.cree_le,
       (SELECT count(*)::int FROM red_financement_lignes l WHERE l.version_id = v.id) AS nombre
     FROM red_financement_versions v JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT $2`,
    [dossier.id, HISTORIQUE_MAX],
  );
  const hist = (historique.rows as Record<string, unknown>[]).map((h) => ({
    id: h.id as string,
    version: h.version as number,
    date_debut: h.date_debut as string,
    type_periode: h.type_periode as TypePeriodeFinancementRed,
    nombre_periodes: h.nombre_periodes as number,
    motif: (h.motif as string | null) ?? null,
    cree_par: personne(h.cree_par as string, h.cree_par_nom as string),
    cree_le: isoOuVide(h.cree_le as Date),
    nombre_lignes: h.nombre as number,
  }));
  const courante = await versionCourante(db, dossier.id);
  if (!courante) return { devise: dossier.devise, version: null, plan: null, historique: hist };
  const plan = calculerPlanFinancement({
    dateDebut: courante.date_debut,
    typePeriode: courante.type_periode,
    nombrePeriodes: courante.nombre_periodes,
    lignes: courante.lignes.map(versLigneMoteur),
  });
  return {
    devise: dossier.devise,
    version: vueVersion(courante),
    plan: vuePlan(plan),
    historique: hist,
  };
}

/** Nouvelle version avec ses lignes (une transaction), validée par le moteur avant l'écriture. */
export async function creerVersionFinancement(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedFinancementVersionCreation,
): Promise<RedFinancementVue> {
  await verifierDebit(db, auth, DEBIT_VERSIONS_FINANCEMENT);
  calculerPlanFinancement({
    dateDebut: corps.date_debut,
    typePeriode: corps.type_periode,
    nombrePeriodes: corps.nombre_periodes,
    lignes: corps.lignes.map((l) => ({
      periode: l.periode,
      sens: l.sens,
      nature: l.nature,
      montant: l.montant,
    })),
  });
  const v = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS suivante FROM red_financement_versions WHERE dossier_id = $1",
    [dossier.id],
  );
  const version = v.rows[0].suivante as number;
  const r = await db.query(
    `INSERT INTO red_financement_versions (cabinet_id, dossier_id, version, date_debut, type_periode,
       nombre_periodes, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      version,
      corps.date_debut,
      corps.type_periode,
      corps.nombre_periodes,
      corps.motif ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  if (corps.lignes.length > 0) {
    await db.query(
      `INSERT INTO red_financement_lignes (cabinet_id, dossier_id, version_id, rang, periode, sens, nature,
         libelle, montant)
       SELECT $1, $2, $3, x.rang, x.periode, x.sens, x.nature, x.libelle, x.montant
       FROM unnest($4::int[], $5::int[], $6::text[], $7::text[], $8::text[], $9::bigint[])
         AS x(rang, periode, sens, nature, libelle, montant)`,
      [
        auth.cabinetId,
        dossier.id,
        id,
        corps.lignes.map((_, i) => i + 1),
        corps.lignes.map((l) => l.periode),
        corps.lignes.map((l) => l.sens),
        corps.lignes.map((l) => l.nature),
        corps.lignes.map((l) => l.libelle ?? null),
        corps.lignes.map((l) => String(l.montant)),
      ],
    );
  }
  await journalRed(db, auth, "red_financement", "financement_version", id, {
    dossier_id: dossier.id,
    version,
    nombre_lignes: corps.lignes.length,
  });
  return lireFinancement(db, dossier);
}

/** Échéances restantes des accords en vigueur de créanciers actifs (moteur des créanciers). */
async function echeancesRestantes(db: Db, dossier: DossierRed): Promise<EcheanceFinancement[]> {
  const dateReference = dateDuJour();
  const restantes: EcheanceFinancement[] = [];
  for (const c of await chargerCreanciers(db, dossier.id)) {
    if (!c.actif || !c.accord || c.accord.rompu) continue;
    const s = situationDe(c, dateReference);
    if (!s?.accord) continue;
    const parRang = new Map(c.accord.echeances.map((e) => [e.rang, e.id]));
    for (const e of s.accord.echeancesRestantes) {
      const echeanceId = parRang.get(e.rang);
      if (!echeanceId) continue;
      restantes.push({
        echeanceId,
        creancierId: c.id,
        date: e.date,
        montant: e.montantRestant,
      });
    }
  }
  return restantes;
}

/**
 * Proposition d'emplois (n'écrit RIEN) : besoin de financement de la trésorerie à 13 semaines et
 * échéances restantes des accords, rangés dans les périodes du cadre. Cadre par défaut : celui de la
 * version courante du plan, sinon le mois de la trésorerie (ou du jour), en années sur 3 périodes.
 */
export async function proposerFinancement(
  db: Db,
  dossier: DossierRed,
  query: RedFinancementPropositionQuery,
): Promise<RedFinancementPropositionVue> {
  const courante = await versionCourante(db, dossier.id);
  const tresorerie = await projectionCourante(db, dossier.id);
  const debutParDefaut =
    courante?.date_debut ?? `${(tresorerie?.version.date_debut ?? dateDuJour()).slice(0, 7)}-01`;
  const cadre = {
    dateDebut: query.date_debut ?? debutParDefaut,
    typePeriode: query.type_periode ?? courante?.type_periode ?? TYPE_PAR_DEFAUT,
    nombrePeriodes: query.nombre_periodes ?? courante?.nombre_periodes ?? PERIODES_PAR_DEFAUT,
  };
  let besoin: { montant: number; date: string } | null = null;
  if (tresorerie && tresorerie.projection.besoinFinancement > 0) {
    const semaine = tresorerie.projection.semaines.find(
      (s) => s.semaine === tresorerie.projection.soldeMinimum.semaine,
    );
    if (semaine) besoin = { montant: tresorerie.projection.besoinFinancement, date: semaine.debut };
  }
  const p = proposerLignesFinancement({
    ...cadre,
    besoin,
    echeances: await echeancesRestantes(db, dossier),
  });
  return {
    devise: dossier.devise,
    cadre: {
      date_debut: cadre.dateDebut,
      type_periode: cadre.typePeriode,
      nombre_periodes: cadre.nombrePeriodes,
    },
    lignes: p.lignes.map((l) => ({
      periode: l.periode,
      sens: l.sens,
      nature: l.nature,
      montant: l.montant,
      origine: l.origine,
      nombre_echeances: l.nombreEcheances,
    })),
    anterieures: p.anterieures,
    ulterieures: p.ulterieures,
    besoin_hors_plan: p.besoinHorsPlan,
    besoin_tresorerie: besoin,
  };
}
