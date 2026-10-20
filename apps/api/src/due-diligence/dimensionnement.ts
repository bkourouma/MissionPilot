import {
  dimensionnerMarche,
  recouperDimensionnements,
  type Devise,
  type FourchetteDd,
  type ParametreDimensionnement,
} from "@missionpilot/engines";
import {
  PARAMETRES_DIMENSIONNEMENT,
  PLAFONDS_DD,
  type dimensionnementCalculSchema,
  type dimensionnementCreationSchema,
  type dimensionnementVersionSchema,
  type MethodeDimensionnement,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { montantAffiche } from "../rapports/outils.js";
import {
  exigerPlafondDd,
  exigerVersionCourante,
  exigerVersionsRestantes,
  type DossierLu,
} from "./acces.js";
import { ecrireAjustement } from "./ajustements.js";
import { cadrageCourant } from "./dossiers.js";
import { vueRecoupement, vueResultatDimensionnement, type ResultatFige } from "./vues.js";

/*
 * Dimensionnement de marché (DD-12, migration 0504, SPEC-3b §8.5, R30 à R34). Tout nombre sort de
 * `dimensionnerMarche` (arithmétique entière, un seul arrondi) ; le résultat est FIGÉ à l'écriture
 * dans la version (stable si la formule change). Chaque paramètre cite une preuve de la MISSION ou
 * un avis d'expert motivé (400 PARAMETRE_SANS_SOURCE, doublé par MPZ31) ; le calcul à blanc (R34)
 * n'écrit rien et admet l'absence de source, qu'il signale. Données de MARCHÉ de l'opération
 * étudiée : aucune donnée financière interne (FIN-02).
 */

export type CorpsDimensionnementCreation = z.infer<typeof dimensionnementCreationSchema>;
export type CorpsDimensionnementVersion = z.infer<typeof dimensionnementVersionSchema>;
export type CorpsCalcul = z.infer<typeof dimensionnementCalculSchema>;

type ParametreSource = CorpsDimensionnementCreation["parametres"][number];
type ParametreCalcul = CorpsCalcul["parametres"][number];

const unites = new Map<string, string>(
  [...PARAMETRES_DIMENSIONNEMENT.descendant, ...PARAMETRES_DIMENSIONNEMENT.ascendant].map((p) => [
    p.code,
    p.unite,
  ]),
);

function versMoteur(
  parametres: readonly (ParametreSource | ParametreCalcul)[],
): ParametreDimensionnement[] {
  return parametres.map((p) => ({
    code: p.code,
    bas: p.bas,
    base: p.base,
    haut: p.haut,
    source:
      p.source === null
        ? null
        : p.source.type === "preuve"
          ? { type: "preuve", preuveId: p.source.preuve_id }
          : { type: "avis_expert" },
  }));
}

/** R34 : calcul à blanc, sans écriture ; une erreur du moteur devient un 400. */
export function calculerAPerte(c: CorpsCalcul): ResultatFige {
  return vueResultatDimensionnement(
    dimensionnerMarche({
      methode: c.methode,
      parametres: versMoteur(c.parametres),
      ajustements: c.ajustements.map((a) => ({ libelle: a.libelle, facteurBp: a.facteur_bp })),
    }),
  );
}

function sansSource(message: string): AppError {
  return new AppError(400, "PARAMETRE_SANS_SOURCE", message);
}

async function exigerPreuvesDeLaMission(
  db: Db,
  missionId: string,
  parametres: readonly ParametreSource[],
): Promise<void> {
  const ids = [
    ...new Set(parametres.flatMap((p) => (p.source.type === "preuve" ? [p.source.preuve_id] : []))),
  ];
  if (ids.length === 0) return;
  const r = await db.query(
    "SELECT id FROM preuves WHERE mission_id = $1 AND id = ANY ($2::uuid[])",
    [missionId, ids],
  );
  if (r.rows.length !== ids.length) {
    throw sansSource("Une preuve citée n'appartient pas à la mission du dossier.");
  }
}

function parametresStockes(parametres: readonly ParametreSource[]) {
  return parametres.map((p) => ({
    code: p.code,
    unite: unites.get(p.code) ?? "nombre",
    bas: p.bas,
    base: p.base,
    haut: p.haut,
    source:
      p.source.type === "preuve"
        ? { type: "preuve", preuve_id: p.source.preuve_id }
        : { type: "avis_expert", motif: p.source.motif },
  }));
}

/** Calcule, fige et enregistre une version ; écrit un ajustement par ajustement appliqué. */
async function ecrireVersion(
  db: Db,
  auth: Auth,
  dossierId: string,
  dimensionnementId: string,
  methode: MethodeDimensionnement,
  version: number,
  c: {
    libelle: string;
    parametres: readonly ParametreSource[];
    ajustements: CorpsCalcul["ajustements"];
  },
  motif: string | null,
): Promise<ResultatFige> {
  const devise = (await cadrageCourant(db, dossierId)).devise as Devise;
  const resultat = dimensionnerMarche({
    methode,
    parametres: versMoteur(c.parametres),
    ajustements: c.ajustements.map((a) => ({ libelle: a.libelle, facteurBp: a.facteur_bp })),
  });
  const fige = vueResultatDimensionnement(resultat);
  await db.query(
    `INSERT INTO dd_dimensionnement_versions (cabinet_id, dimensionnement_id, version, libelle,
       parametres, ajustements, resultat, motif, auteur_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)`,
    [
      auth.cabinetId,
      dimensionnementId,
      version,
      c.libelle,
      JSON.stringify(parametresStockes(c.parametres)),
      JSON.stringify(c.ajustements),
      JSON.stringify(fige),
      motif,
      auth.utilisateurId,
    ],
  );
  let avant = resultat.avantAjustement.base;
  for (const [i, applique] of resultat.ajustementsAppliques.entries()) {
    await ecrireAjustement(db, auth, {
      dossierId,
      cibleType: "dimensionnement",
      cibleId: dimensionnementId,
      champ: "resultat",
      avant: montantAffiche(avant, devise),
      apres: montantAffiche(applique.base, devise),
      motif: c.ajustements[i]?.motif ?? applique.libelle,
    });
    avant = applique.base;
  }
  return fige;
}

export async function creerDimensionnement(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  c: CorpsDimensionnementCreation,
): Promise<{ id: string; version: 1; resultat: ResultatFige }> {
  await exigerPlafondDd(db, {
    table: "dd_dimensionnements",
    colonne: "dossier_id",
    valeur: dossier.id,
    max: PLAFONDS_DD.dimensionnements_par_dossier,
    quoi: "dimensionnements par dossier",
  });
  await exigerPreuvesDeLaMission(db, dossier.mission_id, c.parametres);
  const r = await db.query(
    `INSERT INTO dd_dimensionnements (cabinet_id, dossier_id, methode, cree_par)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [auth.cabinetId, dossier.id, c.methode, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  const resultat = await ecrireVersion(db, auth, dossier.id, id, c.methode, 1, c, null);
  return { id, version: 1, resultat };
}

export interface DimensionnementCourant {
  id: string;
  methode: MethodeDimensionnement;
  numero: string;
  version: number;
  libelle: string;
  parametres: unknown[];
  ajustements: unknown[];
  resultat: ResultatFige;
  moteur_version: number;
}

const COLONNES = `m.id, m.methode, m.numero::text AS numero, v.version, v.libelle, v.parametres,
  v.ajustements, v.resultat, v.moteur_version`;
const DEPUIS = `FROM dd_dimensionnements m
  JOIN LATERAL (SELECT * FROM dd_dimensionnement_versions dv WHERE dv.dimensionnement_id = m.id
                ORDER BY dv.version DESC LIMIT 1) v ON true`;

export async function lireDimensionnement(
  db: Db,
  id: string,
): Promise<DimensionnementCourant & { dossier_id: string }> {
  const r = await db.query(`SELECT ${COLONNES}, m.dossier_id ${DEPUIS} WHERE m.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Dimensionnement");
  return r.rows[0] as DimensionnementCourant & { dossier_id: string };
}

export async function corrigerDimensionnement(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  courant: DimensionnementCourant,
  c: CorpsDimensionnementVersion,
): Promise<{ version: number; resultat: ResultatFige }> {
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  const attendus = PARAMETRES_DIMENSIONNEMENT[courant.methode].map((p) => p.code) as string[];
  const recus = c.parametres.map((p) => p.code) as string[];
  if (recus.length !== attendus.length || !attendus.every((code) => recus.includes(code))) {
    throw new AppError(
      400,
      "DIMENSIONNEMENT_INVALIDE",
      "Les paramètres ne sont pas ceux de la méthode de ce dimensionnement.",
    );
  }
  await exigerPreuvesDeLaMission(db, dossier.mission_id, c.parametres);
  const resultat = await ecrireVersion(
    db,
    auth,
    dossier.id,
    courant.id,
    courant.methode,
    courant.version + 1,
    c,
    c.motif,
  );
  return { version: courant.version + 1, resultat };
}

/** R33 : versions d'un dimensionnement, plus récente d'abord (au plus 200). */
export async function versionsDuDimensionnement(db: Db, id: string) {
  const r = await db.query(
    `SELECT v.version, v.libelle, v.parametres, v.ajustements, v.resultat, v.moteur_version,
       v.motif, v.auteur_id, u.nom AS auteur_nom, v.cree_le
     FROM dd_dimensionnement_versions v LEFT JOIN utilisateurs u ON u.id = v.auteur_id
     WHERE v.dimensionnement_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return r.rows;
}

/** Dimensionnements courants d'un dossier (au plus 20). */
export async function dimensionnementsDuDossier(
  db: Db,
  dossierId: string,
): Promise<DimensionnementCourant[]> {
  const r = await db.query(
    `SELECT ${COLONNES} ${DEPUIS} WHERE m.dossier_id = $1 ORDER BY m.numero ASC LIMIT $2`,
    [dossierId, PLAFONDS_DD.dimensionnements_par_dossier + 1],
  );
  return r.rows as DimensionnementCourant[];
}

/** Recoupement entre le dernier dimensionnement descendant et le dernier ascendant, s'ils existent. */
export function recoupement(dims: readonly DimensionnementCourant[]) {
  const dernier = (m: MethodeDimensionnement) => [...dims].reverse().find((d) => d.methode === m);
  const d = dernier("descendant");
  const a = dernier("ascendant");
  if (!d || !a) return null;
  return vueRecoupement(
    recouperDimensionnements(
      d.resultat.resultat as FourchetteDd,
      a.resultat.resultat as FourchetteDd,
    ),
  );
}

/** R30 : dimensionnements courants (résultat figé) et recoupement. */
export async function lireDimensionnements(db: Db, dossierId: string) {
  const dims = await dimensionnementsDuDossier(db, dossierId);
  return {
    elements: dims.map((d) => ({
      id: d.id,
      methode: d.methode,
      version: d.version,
      libelle: d.libelle,
      parametres: d.parametres,
      ajustements: d.ajustements,
      resultat: d.resultat,
      couverture: d.resultat.couverture,
    })),
    recoupement: recoupement(dims),
  };
}
