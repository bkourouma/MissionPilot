import {
  situationCreancier,
  synthesePassif,
  type AccordSuivi,
  type SituationCreancier,
} from "@missionpilot/engines";
import type {
  RedAccordVue,
  RedCategorieCreancier,
  RedCreanceCreation,
  RedCreanceVue,
  RedCreancierCreation,
  RedCreancierResume,
  RedCreancierVue,
  RedCreanciersVue,
  RedEvenementNegociationVue,
  RedTypeEvenementNegociation,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import {
  exigerDossierRedEcriture,
  exigerDossierRedVisible,
  lireDossier,
  type DossierRed,
} from "./acces.js";
import { dateDuJour } from "./dates.js";
import { journalRed } from "./journal.js";
import { DEBIT_CREANCIERS, verifierDebit } from "./limites.js";
import { isoOuVide, personne, vueSituationCreancier, vueSynthesePassif } from "./vues.js";

/*
 * Registre des créanciers et situation du passif (RED-12). Le registre est vivant mais borné (nom,
 * garantie, référence, actif : journalisés) ; les créances (versions) et la négociation (événements,
 * accords, échéanciers, paiements) sont en AJOUT SEUL. La situation d'un créancier (reste dû, échu,
 * avancement de l'accord) est RECALCULÉE par le moteur à chaque lecture et n'est jamais stockée ;
 * la date de référence est le jour UTC courant. Aucune addition de montants dans l'API.
 */

export interface EcheanceLue {
  id: string;
  rang: number;
  date: string;
  montant: number;
}

export interface AccordLu {
  id: string;
  date_evenement: string;
  montant_convenu: number;
  conditions: string | null;
  echeances: EcheanceLue[];
  /** Paiements NON annulés (un paiement annulé ne compte plus dans le total payé). */
  paiements: { id: string; date: string; montant: number; echeance_rang: number | null }[];
  rompu: boolean;
}

export interface CreanceCourante {
  id: string;
  version: number;
  principal: number;
  interets: number;
  date_arrete: string;
  echeance_initiale: string | null;
  nature: string | null;
}

export interface CreancierLu {
  id: string;
  dossier_id: string;
  nom: string;
  categorie: RedCategorieCreancier;
  garanti: boolean;
  reference: string | null;
  actif: boolean;
  cree_le: Date;
  modifie_le: Date;
  creance: CreanceCourante | null;
  /** Dernier accord (en vigueur, ou rompu s'il n'y en a pas eu d'autre depuis). */
  accord: AccordLu | null;
}

const COLONNES_CREANCIER = `c.id, c.dossier_id, c.nom, c.categorie, c.garanti, c.reference, c.actif, c.cree_le,
  c.modifie_le`;

/**
 * Créanciers d'un dossier (200 au plus), leur créance courante et leur DERNIER accord (les événements
 * et échéances des accords antérieurs ne sont pas lus : lecture bornée). `actifsSeulement` borne la
 * lecture aux créanciers actifs.
 */
export async function chargerCreanciers(
  db: Db,
  dossierId: string,
  creancierId: string | null = null,
  actifsSeulement = false,
): Promise<CreancierLu[]> {
  const cr = await db.query(
    `SELECT ${COLONNES_CREANCIER} FROM red_creanciers c
     WHERE c.dossier_id = $1 AND ($2::uuid IS NULL OR c.id = $2) AND (NOT $3::boolean OR c.actif)
     ORDER BY lower(c.nom), c.id LIMIT 200`,
    [dossierId, creancierId, actifsSeulement],
  );
  if (cr.rows.length === 0) return [];
  const creances = await db.query(
    `SELECT DISTINCT ON (x.creancier_id) x.id, x.creancier_id, x.version, x.principal::text AS principal,
       x.interets::text AS interets, x.date_arrete::text AS date_arrete,
       x.echeance_initiale::text AS echeance_initiale, x.nature
     FROM red_creances x
     WHERE x.dossier_id = $1 AND ($2::uuid IS NULL OR x.creancier_id = $2)
       AND ($3::boolean IS NOT TRUE OR x.creancier_id IN (SELECT c.id FROM red_creanciers c WHERE c.dossier_id = $1 AND c.actif))
     ORDER BY x.creancier_id, x.version DESC`,
    [dossierId, creancierId, actifsSeulement],
  );
  const evenements = await db.query(
    `WITH dernier AS (
       SELECT DISTINCT ON (a.creancier_id) a.id FROM red_negociation_evenements a
       WHERE a.dossier_id = $1 AND ($2::uuid IS NULL OR a.creancier_id = $2) AND a.type = 'accord'
       ORDER BY a.creancier_id, a.cree_le DESC, a.id DESC)
     SELECT e.id, e.creancier_id, e.type, e.date_evenement::text AS date_evenement, e.montant::text AS montant,
       e.conditions, e.accord_id, e.echeance_rang, e.paiement_annule_id
     FROM red_negociation_evenements e
     WHERE e.dossier_id = $1 AND ($2::uuid IS NULL OR e.creancier_id = $2)
       AND e.type IN ('accord', 'rupture', 'paiement', 'annulation_paiement')
       AND (e.id IN (SELECT id FROM dernier) OR e.accord_id IN (SELECT id FROM dernier))
       AND ($3::boolean IS NOT TRUE OR e.creancier_id IN (SELECT c.id FROM red_creanciers c WHERE c.dossier_id = $1 AND c.actif))
     ORDER BY e.cree_le, e.id`,
    [dossierId, creancierId, actifsSeulement],
  );
  const echeances = await db.query(
    `WITH dernier AS (
       SELECT DISTINCT ON (a.creancier_id) a.id FROM red_negociation_evenements a
       WHERE a.dossier_id = $1 AND ($2::uuid IS NULL OR a.creancier_id = $2) AND a.type = 'accord'
       ORDER BY a.creancier_id, a.cree_le DESC, a.id DESC)
     SELECT e.id, e.accord_id, e.rang, e.date_echeance::text AS date_echeance, e.montant::text AS montant
     FROM red_echeances e
     WHERE e.dossier_id = $1 AND ($2::uuid IS NULL OR e.creancier_id = $2)
       AND e.accord_id IN (SELECT id FROM dernier)
     ORDER BY e.accord_id, e.rang`,
    [dossierId, creancierId],
  );
  const creanceDe = new Map<string, CreanceCourante>();
  for (const x of creances.rows) {
    creanceDe.set(x.creancier_id as string, {
      id: x.id as string,
      version: x.version as number,
      principal: Number(x.principal),
      interets: Number(x.interets),
      date_arrete: x.date_arrete as string,
      echeance_initiale: (x.echeance_initiale as string | null) ?? null,
      nature: (x.nature as string | null) ?? null,
    });
  }
  const ruptures = new Set<string>();
  const dernierAccord = new Map<string, Record<string, unknown>>();
  const paiementsDe = new Map<string, AccordLu["paiements"]>();
  const annules = new Set<string>();
  for (const e of evenements.rows as Record<string, unknown>[]) {
    if (e.type === "annulation_paiement") annules.add(e.paiement_annule_id as string);
  }
  for (const e of evenements.rows as Record<string, unknown>[]) {
    if (e.type === "annulation_paiement" || annules.has(e.id as string)) continue;
    if (e.type === "rupture") ruptures.add(e.accord_id as string);
    else if (e.type === "accord") dernierAccord.set(e.creancier_id as string, e);
    else {
      const liste = paiementsDe.get(e.accord_id as string) ?? [];
      liste.push({
        id: e.id as string,
        date: e.date_evenement as string,
        montant: Number(e.montant),
        echeance_rang: (e.echeance_rang as number | null) ?? null,
      });
      paiementsDe.set(e.accord_id as string, liste);
    }
  }
  const echeancesDe = new Map<string, EcheanceLue[]>();
  for (const e of echeances.rows) {
    const liste = echeancesDe.get(e.accord_id as string) ?? [];
    liste.push({
      id: e.id as string,
      rang: e.rang as number,
      date: e.date_echeance as string,
      montant: Number(e.montant),
    });
    echeancesDe.set(e.accord_id as string, liste);
  }
  return (cr.rows as Record<string, unknown>[]).map((c) => {
    const a = dernierAccord.get(c.id as string);
    return {
      id: c.id as string,
      dossier_id: c.dossier_id as string,
      nom: c.nom as string,
      categorie: c.categorie as RedCategorieCreancier,
      garanti: c.garanti as boolean,
      reference: (c.reference as string | null) ?? null,
      actif: c.actif as boolean,
      cree_le: c.cree_le as Date,
      modifie_le: c.modifie_le as Date,
      creance: creanceDe.get(c.id as string) ?? null,
      accord: a
        ? {
            id: a.id as string,
            date_evenement: a.date_evenement as string,
            montant_convenu: Number(a.montant),
            conditions: (a.conditions as string | null) ?? null,
            echeances: echeancesDe.get(a.id as string) ?? [],
            paiements: paiementsDe.get(a.id as string) ?? [],
            rompu: ruptures.has(a.id as string),
          }
        : null,
    };
  });
}

/** Accord au format du moteur (suivi), ou null. */
export function accordSuivi(c: CreancierLu): AccordSuivi | null {
  const a = c.accord;
  if (!a) return null;
  return {
    montantConvenu: a.montant_convenu,
    echeances: a.echeances.map((e) => ({ rang: e.rang, date: e.date, montant: e.montant })),
    paiements: a.paiements.map((p) => ({ date: p.date, montant: p.montant })),
    rompu: a.rompu,
  };
}

/** Situation d'un créancier à la date de référence, par le moteur ; null sans créance. */
export function situationDe(c: CreancierLu, dateReference: string): SituationCreancier | null {
  if (!c.creance) return null;
  return situationCreancier({
    principal: c.creance.principal,
    interets: c.creance.interets,
    echeanceInitiale: c.creance.echeance_initiale,
    accord: accordSuivi(c),
    dateReference,
  });
}

function resume(c: CreancierLu, s: SituationCreancier): RedCreancierResume {
  const creance = c.creance as CreanceCourante;
  return {
    id: c.id,
    nom: c.nom,
    categorie: c.categorie,
    garanti: c.garanti,
    reference: c.reference,
    actif: c.actif,
    version_creance: creance.version,
    principal: creance.principal,
    interets: creance.interets,
    date_arrete: creance.date_arrete,
    echeance_initiale: creance.echeance_initiale,
    nature: creance.nature,
    situation: vueSituationCreancier(s),
    cree_le: isoOuVide(c.cree_le),
    modifie_le: isoOuVide(c.modifie_le),
  };
}

/** Synthèse du passif (moteur) d'une liste de créanciers à la date de référence. */
export function syntheseDe(lus: readonly CreancierLu[], dateReference: string) {
  const lignes = lus.flatMap((c) => {
    const s = situationDe(c, dateReference);
    return s
      ? [
          {
            creancierId: c.id,
            categorie: c.categorie,
            garanti: c.garanti,
            encours: s.encoursRestant,
            echu: s.echu,
          },
        ]
      : [];
  });
  return synthesePassif(lignes);
}

/** Route 23 : créanciers (200 au plus) et synthèse du passif. */
export async function lireCreanciers(
  db: Db,
  dossier: DossierRed,
  actifs: "true" | "false" | "tous",
): Promise<RedCreanciersVue> {
  const dateReference = dateDuJour();
  const tous = await chargerCreanciers(db, dossier.id, null, actifs === "true");
  const lus = tous.filter((c) => actifs === "tous" || c.actif === (actifs === "true"));
  return {
    elements: lus.flatMap((c) => {
      const s = situationDe(c, dateReference);
      return s ? [resume(c, s)] : [];
    }),
    synthese: vueSynthesePassif(syntheseDe(lus, dateReference)),
    date_reference: dateReference,
  };
}

/** Synthèse du passif des créanciers ACTIFS (résumé du dossier). */
export async function resumePassif(db: Db, dossierId: string) {
  const dateReference = dateDuJour();
  const lus = await chargerCreanciers(db, dossierId, null, true);
  const s = syntheseDe(lus, dateReference);
  return { nombre: s.nombre, encours_total: s.totalEncours, echu_total: s.totalEchu };
}

/** Créancier visible (404 identique pour inconnu, d'autrui ou de mission invisible). */
export async function creancierVisible(db: Db, auth: Auth, id: string) {
  const r = await db.query("SELECT dossier_id FROM red_creanciers WHERE id = $1", [id]);
  if (!r.rows[0]) throw introuvable("Créancier");
  const acces = await exigerDossierRedVisible(db, auth, r.rows[0].dossier_id as string).catch(
    () => {
      throw introuvable("Créancier");
    },
  );
  return { acces, dossierId: acces.dossier.id };
}

/** Créancier ouvert à l'écriture : dossier verrouillé AVANT la relecture de son état (404 / 403 / 409). */
export async function creancierEcriture(db: Db, auth: Auth, id: string) {
  const r = await db.query("SELECT dossier_id FROM red_creanciers WHERE id = $1", [id]);
  if (!r.rows[0]) throw introuvable("Créancier");
  const dossierId = r.rows[0].dossier_id as string;
  // Même 404 qu'un créancier inconnu tant que la mission n'est pas visible.
  const dossier = await lireDossier(db, dossierId);
  if (!dossier) throw introuvable("Créancier");
  await exigerDossierRedVisible(db, auth, dossierId).catch(() => {
    throw introuvable("Créancier");
  });
  const acces = await exigerDossierRedEcriture(db, auth, dossierId);
  const lus = await chargerCreanciers(db, dossierId, id);
  if (!lus[0]) throw introuvable("Créancier");
  return { acces, creancier: lus[0] };
}

/** Détail d'un créancier (route 25) : résumé, créances (100), événements (300), accord en vigueur. */
export async function detailCreancier(
  db: Db,
  dossierId: string,
  id: string,
): Promise<RedCreancierVue> {
  const lus = await chargerCreanciers(db, dossierId, id);
  const c = lus[0];
  if (!c) throw introuvable("Créancier");
  const s = situationDe(c, dateDuJour());
  if (!s) throw introuvable("Créancier");
  const creances = await db.query(
    `SELECT x.id, x.version, x.principal::text AS principal, x.interets::text AS interets,
       x.date_arrete::text AS date_arrete, x.echeance_initiale::text AS echeance_initiale, x.nature,
       x.commentaire, x.saisi_par, u.nom AS saisi_par_nom, x.cree_le
     FROM red_creances x JOIN utilisateurs u ON u.id = x.saisi_par
     WHERE x.creancier_id = $1 ORDER BY x.version DESC LIMIT 100`,
    [id],
  );
  const evenements = await db.query(
    `SELECT e.id, e.type, e.date_evenement::text AS date_evenement, e.montant::text AS montant, e.conditions,
       e.accord_id, e.echeance_rang, e.paiement_annule_id, e.auteur_id, u.nom AS auteur_nom, e.cree_le
     FROM red_negociation_evenements e JOIN utilisateurs u ON u.id = e.auteur_id
     WHERE e.creancier_id = $1 ORDER BY e.cree_le DESC, e.id DESC LIMIT 300`,
    [id],
  );
  const accord = c.accord && !c.accord.rompu ? c.accord : null;
  const accordVue: RedAccordVue | null = accord
    ? {
        id: accord.id,
        date_evenement: accord.date_evenement,
        montant_convenu: accord.montant_convenu,
        conditions: accord.conditions,
        echeances: accord.echeances.map((e) => ({
          rang: e.rang,
          date: e.date,
          montant: e.montant,
        })),
        paiements: accord.paiements.map((p) => ({
          id: p.id,
          date: p.date,
          montant: p.montant,
          echeance_rang: p.echeance_rang,
        })),
      }
    : null;
  return {
    ...resume(c, s),
    creances: (creances.rows as Record<string, unknown>[]).map((x): RedCreanceVue => ({
      id: x.id as string,
      version: x.version as number,
      principal: Number(x.principal),
      interets: Number(x.interets),
      date_arrete: x.date_arrete as string,
      echeance_initiale: (x.echeance_initiale as string | null) ?? null,
      nature: (x.nature as string | null) ?? null,
      commentaire: (x.commentaire as string | null) ?? null,
      saisi_par: personne(x.saisi_par as string, x.saisi_par_nom as string),
      cree_le: isoOuVide(x.cree_le as Date),
    })),
    evenements: (evenements.rows as Record<string, unknown>[]).map(
      (e): RedEvenementNegociationVue & { paiement_annule_id: string | null } => ({
        id: e.id as string,
        type: e.type as RedTypeEvenementNegociation,
        date_evenement: e.date_evenement as string,
        montant: e.montant === null ? null : Number(e.montant),
        conditions: (e.conditions as string | null) ?? null,
        accord_id: (e.accord_id as string | null) ?? null,
        echeance_rang: (e.echeance_rang as number | null) ?? null,
        paiement_annule_id: (e.paiement_annule_id as string | null) ?? null,
        auteur: personne(e.auteur_id as string, e.auteur_nom as string),
        cree_le: isoOuVide(e.cree_le as Date),
      }),
    ),
    accord_en_vigueur: accordVue,
  };
}

/** Route 24 : créancier et créance n° 1 dans la même transaction (dossier verrouillé par l'appelant). */
export async function creerCreancier(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedCreancierCreation,
): Promise<RedCreancierVue> {
  await verifierDebit(db, auth, DEBIT_CREANCIERS);
  const r = await db.query(
    `INSERT INTO red_creanciers (cabinet_id, dossier_id, nom, categorie, garanti, reference, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      corps.nom,
      corps.categorie,
      corps.garanti,
      corps.reference ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await db.query(
    `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, interets,
       date_arrete, echeance_initiale, nature, saisi_par)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)`,
    [
      auth.cabinetId,
      dossier.id,
      id,
      corps.principal,
      corps.interets,
      corps.date_arrete,
      corps.echeance_initiale ?? null,
      corps.nature ?? null,
      auth.utilisateurId,
    ],
  );
  await journalRed(db, auth, "red_creancier", "creation", id, {
    dossier_id: dossier.id,
    categorie: corps.categorie,
  });
  return detailCreancier(db, dossier.id, id);
}

/** Route 26 : modification bornée (nom, garantie, référence, actif) ; journal : noms de champs. */
export async function modifierCreancier(
  db: Db,
  auth: Auth,
  creancier: CreancierLu,
  corps: { nom?: string; garanti?: boolean; reference?: string | null; actif?: boolean },
): Promise<RedCreancierVue> {
  const set = clauseSet(corps, 3);
  await db.query(`UPDATE red_creanciers SET ${set.sql}, modifie_par = $2 WHERE id = $1`, [
    creancier.id,
    auth.utilisateurId,
    ...set.valeurs,
  ]);
  await journalRed(db, auth, "red_creancier", "modification", creancier.id, {
    dossier_id: creancier.dossier_id,
    champs: Object.keys(corps).filter((k) => (corps as Record<string, unknown>)[k] !== undefined),
    // Valeurs avant et après des seuls indicateurs (jamais le nom ni la référence).
    ...(corps.actif !== undefined ? { actif: { de: creancier.actif, vers: corps.actif } } : {}),
    ...(corps.garanti !== undefined
      ? { garanti: { de: creancier.garanti, vers: corps.garanti } }
      : {}),
  });
  return detailCreancier(db, creancier.dossier_id, creancier.id);
}

/** Route 27 : nouvelle version de la créance (ajout seul). */
export async function ajouterCreance(
  db: Db,
  auth: Auth,
  creancier: CreancierLu,
  corps: RedCreanceCreation,
): Promise<RedCreancierVue> {
  const v = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS suivante FROM red_creances WHERE creancier_id = $1",
    [creancier.id],
  );
  const version = v.rows[0].suivante as number;
  await db.query(
    `INSERT INTO red_creances (cabinet_id, dossier_id, creancier_id, version, principal, interets,
       date_arrete, echeance_initiale, nature, commentaire, saisi_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      auth.cabinetId,
      creancier.dossier_id,
      creancier.id,
      version,
      corps.principal,
      corps.interets,
      corps.date_arrete,
      corps.echeance_initiale ?? null,
      corps.nature ?? null,
      corps.commentaire ?? null,
      auth.utilisateurId,
    ],
  );
  await journalRed(db, auth, "red_creancier", "creance", creancier.id, {
    dossier_id: creancier.dossier_id,
    version,
  });
  return detailCreancier(db, creancier.dossier_id, creancier.id);
}
