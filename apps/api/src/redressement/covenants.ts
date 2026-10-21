import {
  evaluerCovenants,
  type DefinitionCovenant,
  type EvaluationCovenant,
  type RatioCovenantRed,
  type OperateurCovenantRed,
  type FrequenceCovenantRed,
  type ResultatCovenants,
} from "@missionpilot/engines";
import {
  RED_COVENANT_MENTION,
  type RedCovenantsVersionCreation,
  type RedCovenantsVue,
  type RedCovenantVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { DossierRed } from "./acces.js";
import { DEBIT_VERSIONS_COVENANTS } from "./financement-limites.js";
import { journalRed } from "./journal.js";
import { verifierDebit } from "./limites.js";
import { calculerRatiosDossier } from "./ratios.js";
import { isoOuVide, personne } from "./vues.js";

/*
 * Covenants bancaires financiers (RED-06, lot 2) : versions en AJOUT SEUL (red_covenants_versions
 * et lignes), jamais de résultat stocké. L'évaluation se fait à la LECTURE par le moteur
 * (`evaluerCovenants`) contre les ratios du dernier exercice ACCEPTÉ du dossier client. Un statut
 * « en_defaut » est un constat arithmétique contre un seuil saisi : jamais une qualification
 * juridique.
 */

const HISTORIQUE_MAX = 100;

interface LigneCovenantLue {
  id: string;
  rang: number;
  definition: DefinitionCovenant;
}
interface VersionCovenantsLue {
  id: string;
  version: number;
  motif: string | null;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  lignes: LigneCovenantLue[];
}

/** Version courante (la plus haute) avec ses lignes, ou null. */
async function versionCourante(db: Db, dossierId: string): Promise<VersionCovenantsLue | null> {
  const r = await db.query(
    `SELECT v.id, v.version, v.motif, v.cree_par, u.nom AS cree_par_nom, v.cree_le
     FROM red_covenants_versions v JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT 1`,
    [dossierId],
  );
  const v = r.rows[0] as Record<string, unknown> | undefined;
  if (!v) return null;
  const lignes = await db.query(
    `SELECT l.id, l.rang, l.ratio, l.operateur, l.seuil_pb::text AS seuil_pb, l.preteur, l.frequence
     FROM red_covenants_lignes l WHERE l.version_id = $1 ORDER BY l.rang`,
    [v.id],
  );
  return {
    id: v.id as string,
    version: v.version as number,
    motif: (v.motif as string | null) ?? null,
    cree_par: v.cree_par as string,
    cree_par_nom: v.cree_par_nom as string,
    cree_le: v.cree_le as Date,
    lignes: (lignes.rows as Record<string, unknown>[]).map((l) => ({
      id: l.id as string,
      rang: l.rang as number,
      definition: {
        ratio: l.ratio as RatioCovenantRed,
        operateur: l.operateur as OperateurCovenantRed,
        seuilPb: Number(l.seuil_pb),
        preteur: (l.preteur as string | null) ?? null,
        frequence: l.frequence as FrequenceCovenantRed,
      },
    })),
  };
}

/** Évaluation par le moteur contre le dernier exercice accepté (null sans exercice). */
async function evaluer(
  db: Db,
  dossier: DossierRed,
  definitions: readonly DefinitionCovenant[],
): Promise<{
  resultat: ResultatCovenants;
  exercice: NonNullable<RedCovenantsVue["exercice"]> | null;
}> {
  const calcul = await calculerRatiosDossier(db, dossier);
  const dernier = calcul.exercices[0];
  return {
    resultat: evaluerCovenants(definitions, dernier ? dernier.ratios.ratios : null),
    exercice: dernier
      ? {
          etat_id: dernier.lu.id,
          exercice: dernier.lu.exercice,
          date_cloture: dernier.lu.date_cloture,
          devise: dernier.lu.devise,
          accepte_sous_reserve: dernier.lu.accepte_sous_reserve,
        }
      : null,
  };
}

const vueEvaluation = (e: EvaluationCovenant): RedCovenantVue["evaluation"] => ({
  statut: e.statut,
  valeur_pb: e.valeurPb,
  marge_pb: e.margePb,
  raison: e.raison,
  manquants: [...e.manquants],
});

/** Covenants courants, leur évaluation (moteur) et l'historique des versions. */
export async function lireCovenants(db: Db, dossier: DossierRed): Promise<RedCovenantsVue> {
  const historique = await db.query(
    `SELECT v.id, v.version, v.motif, v.cree_par, u.nom AS cree_par_nom, v.cree_le,
       (SELECT count(*)::int FROM red_covenants_lignes l WHERE l.version_id = v.id) AS nombre
     FROM red_covenants_versions v JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT $2`,
    [dossier.id, HISTORIQUE_MAX],
  );
  const hist = (historique.rows as Record<string, unknown>[]).map((h) => ({
    id: h.id as string,
    version: h.version as number,
    motif: (h.motif as string | null) ?? null,
    cree_par: personne(h.cree_par as string, h.cree_par_nom as string),
    cree_le: isoOuVide(h.cree_le as Date),
    nombre_covenants: h.nombre as number,
  }));
  const courante = await versionCourante(db, dossier.id);
  if (!courante) {
    return {
      version: null,
      exercice: null,
      synthese: null,
      historique: hist,
      mention: RED_COVENANT_MENTION,
    };
  }
  const { resultat, exercice } = await evaluer(
    db,
    dossier,
    courante.lignes.map((l) => l.definition),
  );
  return {
    version: {
      id: courante.id,
      version: courante.version,
      motif: courante.motif,
      cree_par: personne(courante.cree_par, courante.cree_par_nom),
      cree_le: isoOuVide(courante.cree_le),
      covenants: courante.lignes.map((l, i) => ({
        id: l.id,
        rang: l.rang,
        ratio: l.definition.ratio,
        operateur: l.definition.operateur,
        seuil_pb: l.definition.seuilPb,
        preteur: l.definition.preteur,
        frequence: l.definition.frequence,
        evaluation: vueEvaluation(resultat.evaluations[i] as EvaluationCovenant),
      })),
    },
    exercice,
    synthese: {
      nombre: resultat.synthese.nombre,
      respectes: resultat.synthese.respectes,
      en_defaut: resultat.synthese.enDefaut,
      non_calculables: resultat.synthese.nonCalculables,
    },
    historique: hist,
    mention: RED_COVENANT_MENTION,
  };
}

/** Nouvelle version (une transaction), validée par le moteur avant l'écriture. */
export async function creerVersionCovenants(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedCovenantsVersionCreation,
): Promise<RedCovenantsVue> {
  await verifierDebit(db, auth, DEBIT_VERSIONS_COVENANTS);
  const definitions: DefinitionCovenant[] = corps.covenants.map((c) => ({
    ratio: c.ratio,
    operateur: c.operateur,
    seuilPb: c.seuil_pb,
    preteur: c.preteur ?? null,
    frequence: c.frequence,
  }));
  evaluerCovenants(definitions, null); // valide la version (cohérence) avant toute écriture
  const v = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS suivante FROM red_covenants_versions WHERE dossier_id = $1",
    [dossier.id],
  );
  const version = v.rows[0].suivante as number;
  const r = await db.query(
    `INSERT INTO red_covenants_versions (cabinet_id, dossier_id, version, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [auth.cabinetId, dossier.id, version, corps.motif ?? null, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  if (definitions.length > 0) {
    await db.query(
      `INSERT INTO red_covenants_lignes (cabinet_id, dossier_id, version_id, rang, ratio, operateur,
         seuil_pb, preteur, frequence)
       SELECT $1, $2, $3, x.rang, x.ratio, x.operateur, x.seuil_pb, x.preteur, x.frequence
       FROM unnest($4::int[], $5::text[], $6::text[], $7::bigint[], $8::text[], $9::text[])
         AS x(rang, ratio, operateur, seuil_pb, preteur, frequence)`,
      [
        auth.cabinetId,
        dossier.id,
        id,
        definitions.map((_, i) => i + 1),
        definitions.map((d) => d.ratio),
        definitions.map((d) => d.operateur),
        definitions.map((d) => String(d.seuilPb)),
        definitions.map((d) => d.preteur),
        definitions.map((d) => d.frequence),
      ],
    );
  }
  await journalRed(db, auth, "red_covenants", "covenants_version", id, {
    dossier_id: dossier.id,
    version,
    nombre_covenants: definitions.length,
  });
  return lireCovenants(db, dossier);
}

/**
 * Nombre de covenants en défaut (constat arithmétique) de la version courante, ou null si aucun
 * covenant n'est défini. Réutilisable par le tableau de bord ; n'écrit rien.
 */
export async function evaluerCovenantsDossier(
  db: Db,
  _auth: Auth,
  dossier: DossierRed,
): Promise<number | null> {
  const courante = await versionCourante(db, dossier.id);
  if (!courante || courante.lignes.length === 0) return null;
  const { resultat } = await evaluer(
    db,
    dossier,
    courante.lignes.map((l) => l.definition),
  );
  return resultat.synthese.enDefaut;
}
