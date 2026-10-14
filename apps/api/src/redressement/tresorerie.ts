import {
  echeancesVersLignes,
  projeterTresorerie,
  calculerPointMort,
  type EcheanceRestante,
  type EntreeTresorerie,
  type FluxRealise,
  type LigneTresorerie,
  type RealiseSemaine,
  type ResultatTresorerie,
} from "@missionpilot/engines";
import type {
  RedLigneTresorerieVue,
  RedPointMortEntree,
  RedPointMortVue,
  RedPropositionEcheancesVue,
  RedRealiseVue,
  RedTresorerieVersionCreation,
  RedTresorerieVersionVue,
  RedTresorerieVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";
import type { DossierRed } from "./acces.js";
import { chargerCreanciers, situationDe } from "./creanciers.js";
import { dateDuJour } from "./dates.js";
import { journalRed } from "./journal.js";
import { DEBIT_VERSIONS_TRESORERIE, verifierDebit } from "./limites.js";
import {
  isoOuVide,
  personne,
  vuePointMort,
  vueProjection,
  vuePropositionEcheances,
} from "./vues.js";

/*
 * Trésorerie à 13 semaines (RED-06 en partie, RED-11) : versions de prévision (fenêtre glissante :
 * une nouvelle version par décalage), flux prévus par catégorie, réalisé hebdomadaire (realises.ts).
 * Soldes, écarts, semaines de tension et besoin de financement sont calculés à la LECTURE par le
 * moteur (`projeterTresorerie`) ; la base et l'API ne font aucune addition de montants. « Tension »
 * est un constat de solde projeté, jamais une qualification juridique.
 */

const SEMAINES = 13;
const HISTORIQUE_MAX = 200;

export interface LigneLue {
  id: string;
  rang: number;
  semaine: number;
  sens: "encaissement" | "decaissement";
  categorie: string;
  libelle: string | null;
  montant: number;
  creancier_id: string | null;
  echeance_id: string | null;
}

export interface VersionLue {
  id: string;
  version: number;
  date_debut: string;
  solde_initial: number;
  seuil_tension: number;
  motif: string | null;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  lignes: LigneLue[];
}

export interface RealiseLu {
  id: string;
  semaine_debut: string;
  /** Jours depuis le lundi de la semaine 1 de la version considérée. */
  jours: number;
  flux: FluxRealise;
  solde_constate: number | null;
  commentaire: string | null;
  saisi_par: string;
  saisi_par_nom: string;
  cree_le: Date;
  corrections: number;
}

/** Index 1..13 d'une semaine dans la fenêtre (jours depuis le lundi de la semaine 1), ou null. */
export function indexSemaine(jours: number): number | null {
  if (jours < 0 || jours >= SEMAINES * 7 || jours % 7 !== 0) return null;
  return jours / 7 + 1;
}

/** Version courante (la plus haute) avec ses lignes, ou null. */
export async function versionCourante(db: Db, dossierId: string): Promise<VersionLue | null> {
  const r = await db.query(
    `SELECT v.id, v.version, v.date_debut::text AS date_debut, v.solde_initial::text AS solde_initial,
       v.seuil_tension::text AS seuil_tension, v.motif, v.cree_par, u.nom AS cree_par_nom, v.cree_le
     FROM red_tresorerie_versions v JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT 1`,
    [dossierId],
  );
  const v = r.rows[0] as Record<string, unknown> | undefined;
  if (!v) return null;
  const lignes = await db.query(
    `SELECT l.id, l.rang, l.semaine, l.sens, l.categorie, l.libelle, l.montant::text AS montant,
       l.creancier_id, l.echeance_id
     FROM red_tresorerie_lignes l WHERE l.version_id = $1 ORDER BY l.rang`,
    [v.id],
  );
  return {
    id: v.id as string,
    version: v.version as number,
    date_debut: v.date_debut as string,
    solde_initial: Number(v.solde_initial),
    seuil_tension: Number(v.seuil_tension),
    motif: (v.motif as string | null) ?? null,
    cree_par: v.cree_par as string,
    cree_par_nom: v.cree_par_nom as string,
    cree_le: v.cree_le as Date,
    lignes: (lignes.rows as Record<string, unknown>[]).map((l) => ({
      id: l.id as string,
      rang: l.rang as number,
      semaine: l.semaine as number,
      sens: l.sens as LigneLue["sens"],
      categorie: l.categorie as string,
      libelle: (l.libelle as string | null) ?? null,
      montant: Number(l.montant),
      creancier_id: (l.creancier_id as string | null) ?? null,
      echeance_id: (l.echeance_id as string | null) ?? null,
    })),
  };
}

/** Flux d'un réalisé : seules les deux listes connues sont recopiées (jsonb construit par le code). */
function fluxDepuisJson(json: unknown): FluxRealise {
  const f = (json ?? {}) as {
    encaissement?: Record<string, number>;
    decaissement?: Record<string, number>;
  };
  return {
    ...(f.encaissement ? { encaissement: { ...f.encaissement } } : {}),
    ...(f.decaissement ? { decaissement: { ...f.decaissement } } : {}),
  };
}

/** Réalisés COURANTS (aucune ligne ne les remplace), rapportés à une fenêtre qui débute à `dateDebut`. */
export async function realisesCourants(
  db: Db,
  dossierId: string,
  dateDebut: string,
): Promise<RealiseLu[]> {
  const r = await db.query(
    `SELECT r.id, r.semaine_debut::text AS semaine_debut, (r.semaine_debut - $2::date) AS jours, r.flux,
       r.solde_constate::text AS solde_constate, r.commentaire, r.saisi_par, u.nom AS saisi_par_nom, r.cree_le,
       (SELECT count(*)::int - 1 FROM red_tresorerie_realises x
         WHERE x.dossier_id = r.dossier_id AND x.semaine_debut = r.semaine_debut) AS corrections
     FROM red_tresorerie_realises r JOIN utilisateurs u ON u.id = r.saisi_par
     WHERE r.dossier_id = $1
       AND NOT EXISTS (SELECT 1 FROM red_tresorerie_realises s WHERE s.remplace_id = r.id)
     ORDER BY r.semaine_debut LIMIT 1000`,
    [dossierId, dateDebut],
  );
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: x.id as string,
    semaine_debut: x.semaine_debut as string,
    jours: x.jours as number,
    flux: fluxDepuisJson(x.flux),
    solde_constate: x.solde_constate === null ? null : Number(x.solde_constate),
    commentaire: (x.commentaire as string | null) ?? null,
    saisi_par: x.saisi_par as string,
    saisi_par_nom: x.saisi_par_nom as string,
    cree_le: x.cree_le as Date,
    corrections: x.corrections as number,
  }));
}

/** Entrée du moteur : lignes de la version et réalisés courants DE LA FENÊTRE (index 1..13). */
export function entreeMoteur(
  dateDebut: string,
  soldeInitial: number,
  seuilTension: number,
  lignes: readonly LigneTresorerie[],
  realises: readonly RealiseLu[],
): EntreeTresorerie {
  const dansFenetre: RealiseSemaine[] = [];
  for (const x of realises) {
    const semaine = indexSemaine(x.jours);
    if (semaine === null) continue;
    dansFenetre.push({ semaine, flux: x.flux, soldeConstate: x.solde_constate });
  }
  dansFenetre.sort((a, b) => a.semaine - b.semaine);
  return { dateDebut, soldeInitial, seuilTension, lignes, realises: dansFenetre };
}

const versLigneMoteur = (l: LigneLue): LigneTresorerie => ({
  semaine: l.semaine,
  sens: l.sens,
  categorie: l.categorie,
  montant: l.montant,
});

/** Projection de la version courante (moteur), ou null sans version. */
export async function projectionCourante(
  db: Db,
  dossierId: string,
): Promise<{ version: VersionLue; realises: RealiseLu[]; projection: ResultatTresorerie } | null> {
  const version = await versionCourante(db, dossierId);
  if (!version) return null;
  const realises = await realisesCourants(db, dossierId, version.date_debut);
  const projection = projeterTresorerie(
    entreeMoteur(
      version.date_debut,
      version.solde_initial,
      version.seuil_tension,
      version.lignes.map(versLigneMoteur),
      realises,
    ),
  );
  return { version, realises, projection };
}

function vueVersion(v: VersionLue): RedTresorerieVersionVue {
  return {
    id: v.id,
    version: v.version,
    date_debut: v.date_debut,
    solde_initial: v.solde_initial,
    seuil_tension: v.seuil_tension,
    motif: v.motif,
    cree_par: personne(v.cree_par, v.cree_par_nom),
    cree_le: isoOuVide(v.cree_le),
    lignes: v.lignes.map((l): RedLigneTresorerieVue => ({
      id: l.id,
      rang: l.rang,
      semaine: l.semaine,
      sens: l.sens,
      categorie: l.categorie,
      libelle: l.libelle,
      montant: l.montant,
      creancier_id: l.creancier_id,
      echeance_id: l.echeance_id,
    })),
  };
}

/** Route 18 : version courante, réalisés de la fenêtre, projection du moteur et historique. */
export async function lireTresorerie(db: Db, dossier: DossierRed): Promise<RedTresorerieVue> {
  const historique = await db.query(
    `SELECT v.id, v.version, v.date_debut::text AS date_debut, v.motif, v.cree_par, u.nom AS cree_par_nom, v.cree_le
     FROM red_tresorerie_versions v JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT $2`,
    [dossier.id, HISTORIQUE_MAX],
  );
  const hist = (historique.rows as Record<string, unknown>[]).map((h) => ({
    id: h.id as string,
    version: h.version as number,
    date_debut: h.date_debut as string,
    cree_par: personne(h.cree_par as string, h.cree_par_nom as string),
    cree_le: isoOuVide(h.cree_le as Date),
    motif: (h.motif as string | null) ?? null,
  }));
  const courant = await projectionCourante(db, dossier.id);
  if (!courant) {
    return {
      version: null,
      realises: [],
      realises_hors_fenetre: 0,
      projection: null,
      historique: hist,
    };
  }
  const realises: RedRealiseVue[] = [];
  let horsFenetre = 0;
  for (const x of courant.realises) {
    const semaine = indexSemaine(x.jours);
    if (semaine === null) {
      horsFenetre += 1;
      continue;
    }
    realises.push({
      id: x.id,
      semaine_debut: x.semaine_debut,
      semaine,
      flux: x.flux,
      solde_constate: x.solde_constate,
      commentaire: x.commentaire,
      saisi_par: personne(x.saisi_par, x.saisi_par_nom),
      cree_le: isoOuVide(x.cree_le),
      corrections: x.corrections,
    });
  }
  return {
    version: vueVersion(courant.version),
    realises,
    realises_hors_fenetre: horsFenetre,
    projection: vueProjection(courant.projection),
    historique: hist,
  };
}

/** Résumé de la trésorerie pour le dossier (route 5), ou null sans version. */
export async function resumeTresorerie(db: Db, dossierId: string) {
  const c = await projectionCourante(db, dossierId);
  if (!c) return null;
  const p = c.projection;
  return {
    version: c.version.version,
    date_debut: c.version.date_debut,
    semaines_tension: [...p.semainesTension],
    premiere_semaine_tension: p.premiereSemaineTension,
    solde_minimum: { semaine: p.soldeMinimum.semaine, montant: p.soldeMinimum.montant },
    besoin_financement: p.besoinFinancement,
    derniere_semaine_realisee: p.derniereSemaineRealisee,
  };
}

/** Route 19 : nouvelle version avec ses lignes (une transaction), validée par le moteur avant l'écriture. */
export async function creerVersionTresorerie(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedTresorerieVersionCreation,
): Promise<RedTresorerieVue> {
  await verifierDebit(db, auth, DEBIT_VERSIONS_TRESORERIE);
  // Créanciers et échéances rattachés : ceux de CE dossier, l'échéance étant celle du créancier de la ligne.
  const creanciers = [
    ...new Set(corps.lignes.flatMap((l) => (l.creancier_id ? [l.creancier_id] : []))),
  ];
  const echeances = [
    ...new Set(corps.lignes.flatMap((l) => (l.echeance_id ? [l.echeance_id] : []))),
  ];
  if (creanciers.length > 0) {
    const r = await db.query(
      "SELECT id FROM red_creanciers WHERE dossier_id = $1 AND id = ANY ($2::uuid[])",
      [dossier.id, creanciers],
    );
    if (r.rows.length !== creanciers.length) {
      throw requeteInvalide("Un créancier rattaché n'appartient pas à ce dossier.");
    }
  }
  if (echeances.length > 0) {
    const r = await db.query(
      "SELECT id, creancier_id FROM red_echeances WHERE dossier_id = $1 AND id = ANY ($2::uuid[])",
      [dossier.id, echeances],
    );
    const parId = new Map(
      (r.rows as { id: string; creancier_id: string }[]).map((e) => [e.id, e.creancier_id]),
    );
    for (const l of corps.lignes) {
      if (!l.echeance_id) continue;
      if (!parId.has(l.echeance_id)) {
        throw requeteInvalide("Une échéance rattachée n'appartient pas à ce dossier.");
      }
      if (parId.get(l.echeance_id) !== l.creancier_id) {
        throw new AppError(
          400,
          "RED_RATTACHEMENT_INCOHERENT",
          "Une échéance rattachée n'appartient pas au créancier de la ligne.",
        );
      }
    }
  }
  // Validation et projection par le moteur, avec les réalisés courants rapportés à la nouvelle fenêtre.
  const realises = await realisesCourants(db, dossier.id, corps.date_debut);
  projeterTresorerie(
    entreeMoteur(
      corps.date_debut,
      corps.solde_initial,
      corps.seuil_tension,
      corps.lignes.map((l) => ({
        semaine: l.semaine,
        sens: l.sens,
        categorie: l.categorie,
        montant: l.montant,
      })),
      realises,
    ),
  );
  const v = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS suivante FROM red_tresorerie_versions WHERE dossier_id = $1",
    [dossier.id],
  );
  const version = v.rows[0].suivante as number;
  const r = await db.query(
    `INSERT INTO red_tresorerie_versions (cabinet_id, dossier_id, version, date_debut, solde_initial,
       seuil_tension, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      version,
      corps.date_debut,
      corps.solde_initial,
      corps.seuil_tension,
      corps.motif ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  if (corps.lignes.length > 0) {
    await db.query(
      `INSERT INTO red_tresorerie_lignes (cabinet_id, dossier_id, version_id, rang, semaine, sens, categorie,
         libelle, montant, creancier_id, echeance_id)
       SELECT $1, $2, $3, x.rang, x.semaine, x.sens, x.categorie, x.libelle, x.montant, x.creancier_id, x.echeance_id
       FROM unnest($4::int[], $5::int[], $6::text[], $7::text[], $8::text[], $9::bigint[], $10::uuid[], $11::uuid[])
         AS x(rang, semaine, sens, categorie, libelle, montant, creancier_id, echeance_id)`,
      [
        auth.cabinetId,
        dossier.id,
        id,
        corps.lignes.map((_, i) => i + 1),
        corps.lignes.map((l) => l.semaine),
        corps.lignes.map((l) => l.sens),
        corps.lignes.map((l) => l.categorie),
        corps.lignes.map((l) => l.libelle ?? null),
        corps.lignes.map((l) => String(l.montant)),
        corps.lignes.map((l) => l.creancier_id ?? null),
        corps.lignes.map((l) => l.echeance_id ?? null),
      ],
    );
  }
  await journalRed(db, auth, "red_tresorerie", "tresorerie_version", id, {
    dossier_id: dossier.id,
    version,
    nombre_lignes: corps.lignes.length,
  });
  return lireTresorerie(db, dossier);
}

/**
 * Route 21 : échéances restantes des accords en vigueur de créanciers ACTIFS, proposées comme
 * lignes de la fenêtre courante. N'écrit RIEN : le consultant choisit ce qu'il retient.
 */
export async function proposerEcheancesAccords(
  db: Db,
  dossier: DossierRed,
): Promise<RedPropositionEcheancesVue> {
  const version = await versionCourante(db, dossier.id);
  if (!version) {
    throw new AppError(
      409,
      "RED_TRESORERIE_ABSENTE",
      "Aucune version de trésorerie n'existe encore.",
    );
  }
  const dateReference = dateDuJour();
  const restantes: EcheanceRestante[] = [];
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
        categorieCreancier: c.categorie,
        date: e.date,
        montant: e.montantRestant,
      });
    }
  }
  return vuePropositionEcheances(echeancesVersLignes(restantes, version.date_debut));
}

/** Route 22 : point mort, calcul pur du moteur (aucune écriture, aucun journal). */
export function calculerPointMortRed(corps: RedPointMortEntree): RedPointMortVue {
  return vuePointMort(
    calculerPointMort({
      chiffreAffaires: corps.chiffre_affaires,
      chargesVariables: corps.charges_variables,
      chargesFixes: corps.charges_fixes,
      ...(corps.periode_jours !== undefined ? { periodeJours: corps.periode_jours } : {}),
    }),
  );
}
