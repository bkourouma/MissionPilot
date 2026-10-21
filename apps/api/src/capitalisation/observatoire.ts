import {
  appliquerAjustement,
  initialiserAjustements,
  OBSERVATOIRE_CABINETS_MIN,
  OBSERVATOIRE_EFFECTIF_DETAILLE,
  OBSERVATOIRE_ENTREPRISES_MIN,
  OBSERVATOIRE_SECTEURS,
  OBSERVATOIRE_TAILLES,
  observatoireAgreger,
  observatoirePreparerContributions,
  type ObservatoireCaseBrute,
  type ResultatNotation,
  type ScoreAjuste,
} from "@missionpilot/engines";
import type {
  ObservatoireAdhesion,
  ObservatoireAgregats,
  ObservatoireEtatAdhesion,
  ObservatoireIndicateurCode,
  ObservatoireResultatRetrait,
  ObservatoireResultatVersement,
  ObservatoireResumeContributions,
  ObservatoireRetraitAdhesion,
  ObservatoireVolumeCase,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import {
  adhesionInactive,
  dejaAdherent,
  nonAdherent,
  contributionRequise,
  reserveAdherents,
} from "./observatoire-erreurs.js";

/*
 * Observatoire inter-cabinets (CAP-04) : adhésion volontaire, versement des données du cabinet,
 * lecture des agrégats. Toutes les fonctions s'exécutent dans `withTenant` du cabinet appelant :
 * la RLS borne chaque lecture et écriture à ce cabinet ; le SEUL chemin inter-cabinets est la
 * fonction SQL `obs_agregats` (SECURITY DEFINER, 0472), qui ne renvoie que des agrégats au-dessus
 * des seuils, re-vérifiés par le moteur. Aucun nom ni identifiant de client ne quitte le cabinet :
 * une contribution ne porte que (secteur normalisé, taille, valeur au dixième).
 */

const ENTITE = "observatoire";

/** Plafond déclaré de l'historique d'adhésion servi (ajout seul, jamais purgé). */
export const OBSERVATOIRE_HISTORIQUE_MAX = 200;

export async function adhesionActive(db: Db, cabinetId: string): Promise<boolean> {
  const r = await db.query("SELECT obs_adhesion_active($1) AS active", [cabinetId]);
  return r.rows[0]?.active === true;
}

async function periodeCourante(db: Db): Promise<string> {
  const r = await db.query("SELECT obs_periode_courante()::text AS periode");
  return r.rows[0].periode as string;
}

export async function etatAdhesion(db: Db): Promise<ObservatoireEtatAdhesion> {
  const r = await db.query(
    `SELECT e.rang, e.action, e.motif, u.nom AS par_nom, e.le
       FROM obs_adhesion_evenements e JOIN utilisateurs u ON u.id = e.par
      ORDER BY e.rang DESC LIMIT $1`,
    [OBSERVATOIRE_HISTORIQUE_MAX],
  );
  const historique = r.rows as ObservatoireEtatAdhesion["historique"];
  const dernier = historique[0];
  const active = dernier?.action === "adhesion";
  return { active, depuis: active ? dernier.le : null, historique };
}

export async function adherer(
  db: Db,
  auth: Auth,
  corps: ObservatoireAdhesion,
): Promise<ObservatoireEtatAdhesion> {
  if (await adhesionActive(db, auth.cabinetId)) throw dejaAdherent();
  const r = await db.query(
    `INSERT INTO obs_adhesion_evenements (cabinet_id, action, motif, par)
     VALUES ($1, 'adhesion', $2, $3) RETURNING id, rang`,
    [auth.cabinetId, corps.motif ?? null, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "observatoire.adhesion",
    entite: ENTITE,
    entiteId: r.rows[0].id,
    details: { rang: r.rows[0].rang, consentement: true },
  });
  return etatAdhesion(db);
}

/** Retrait d'adhésion : les contributions sortent AUSSITÔT des agrégats (filtre de `obs_agregats`). */
export async function seRetirer(
  db: Db,
  auth: Auth,
  corps: ObservatoireRetraitAdhesion,
): Promise<ObservatoireEtatAdhesion> {
  if (!(await adhesionActive(db, auth.cabinetId))) throw nonAdherent();
  const r = await db.query(
    `INSERT INTO obs_adhesion_evenements (cabinet_id, action, motif, par)
     VALUES ($1, 'retrait', $2, $3) RETURNING id, rang`,
    [auth.cabinetId, corps.motif ?? null, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "observatoire.retrait",
    entite: ENTITE,
    entiteId: r.rows[0].id,
    details: { rang: r.rows[0].rang },
  });
  return etatAdhesion(db);
}

interface LigneNotationPubliee {
  version_id: string;
  secteur: string | null;
  taille: string | null;
  resultat: ResultatNotation;
}

interface LigneAjustement {
  version_id: string;
  dimension: string;
  delta: string;
  motif: string;
  auteur_id: string;
  date_ajustement: string;
}

/**
 * Score global de la DERNIÈRE notation publiée de chaque client du cabinet (lecture seule), score
 * ajusté rejoué par le moteur comme à l'affichage (`notation/notations.ts`). Ne rend ni nom ni
 * identifiant de client.
 */
async function scoresPublies(
  db: Db,
): Promise<{ secteur: string | null; taille: string | null; valeur: number | null }[]> {
  const r = await db.query(
    `SELECT DISTINCT ON (n.client_id) v.id AS version_id, c.secteur, c.taille, v.resultat
       FROM notations n
       JOIN clients c ON c.id = n.client_id
       JOIN notation_versions v ON v.notation_id = n.id
       JOIN notation_evenements e ON e.version_id = v.id AND e.action = 'publication'
      ORDER BY n.client_id, e.le DESC, v.numero DESC`,
  );
  const lignes = r.rows as LigneNotationPubliee[];
  if (lignes.length === 0) return [];
  const a = await db.query(
    `SELECT version_id, dimension, delta::text AS delta, motif, auteur_id,
            date_ajustement::text AS date_ajustement
       FROM notation_ajustements WHERE version_id = ANY($1::uuid[])
      ORDER BY version_id, rang`,
    [lignes.map((l) => l.version_id)],
  );
  const parVersion = new Map<string, LigneAjustement[]>();
  for (const aj of a.rows as LigneAjustement[]) {
    parVersion.set(aj.version_id, [...(parVersion.get(aj.version_id) ?? []), aj]);
  }
  return lignes.map((l) => {
    const etat = (parVersion.get(l.version_id) ?? []).reduce<ScoreAjuste>(
      (e, aj) =>
        appliquerAjustement(e, {
          dimension: aj.dimension,
          delta: Number(aj.delta),
          motif: aj.motif,
          auteur: aj.auteur_id,
          date: aj.date_ajustement,
        }),
      initialiserAjustements(l.resultat),
    );
    return { secteur: l.secteur, taille: l.taille, valeur: etat.notable ? etat.score : null };
  });
}

export async function resumeContributions(
  db: Db,
  cabinetId: string,
  indicateur: ObservatoireIndicateurCode,
): Promise<ObservatoireResumeContributions> {
  const periode = await periodeCourante(db);
  // `apres_adhesion` : même règle que `obs_agregats` (0472), un lot versé avant la dernière
  // adhésion n'est pas retenu (une ré-adhésion ne réactive pas d'anciennes contributions).
  const r = await db.query(
    `SELECT c.periode::text AS periode, count(*)::int AS nombre, max(c.verse_le) AS verse_le,
            coalesce(bool_and(c.verse_le >= a.le), false) AS apres_adhesion
       FROM obs_contributions c
       LEFT JOIN LATERAL (
         SELECT e.le FROM obs_adhesion_evenements e
          WHERE e.cabinet_id = c.cabinet_id AND e.action = 'adhesion'
          ORDER BY e.rang DESC LIMIT 1
       ) a ON true
      WHERE c.cabinet_id = $1 AND c.indicateur = $2
      GROUP BY c.periode ORDER BY c.periode DESC`,
    [cabinetId, indicateur],
  );
  const lots = (
    r.rows as { periode: string; nombre: number; verse_le: string; apres_adhesion: boolean }[]
  ).map(({ apres_adhesion, ...lot }) => ({ lot, apres_adhesion }));
  const enAttente = lots.find((l) => l.lot.periode === periode)?.lot ?? null;
  const retenu = lots.find((l) => l.lot.periode < periode && l.apres_adhesion)?.lot ?? null;
  const reference = enAttente ?? retenu;
  let parCase: ObservatoireVolumeCase[] = [];
  if (reference) {
    const c = await db.query(
      `SELECT secteur, taille, count(*)::int AS nombre FROM obs_contributions
        WHERE cabinet_id = $1 AND indicateur = $2 AND periode = $3::date
        GROUP BY secteur, taille ORDER BY secteur, taille`,
      [cabinetId, indicateur, reference.periode],
    );
    parCase = c.rows as ObservatoireVolumeCase[];
  }
  return {
    indicateur,
    adhesion_active: await adhesionActive(db, cabinetId),
    periode_courante: periode,
    en_attente: enAttente,
    retenu,
    par_case: parCase,
  };
}

/**
 * « Verser mes données » : remplace le versement du mois courant par l'instantané des scores
 * publiés du cabinet ; ne garde, des mois antérieurs, que le dernier versement (celui que
 * retiennent les agrégats jusqu'à la fin du mois). Adhésion active exigée (doublée par MQK22).
 */
export async function verser(
  db: Db,
  auth: Auth,
  indicateur: ObservatoireIndicateurCode,
): Promise<ObservatoireResultatVersement> {
  // Un seul versement à la fois par cabinet : deux versements concurrents supprimeraient chacun le
  // mois courant puis inséreraient chacun leur lot, doublant les entreprises du cabinet (effectif
  // gonflé, seuil des 5 entreprises franchi à tort).
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('obs_versement:' || $1, 0))", [
    auth.cabinetId,
  ]);
  if (!(await adhesionActive(db, auth.cabinetId))) throw adhesionInactive();
  const preparation = observatoirePreparerContributions(await scoresPublies(db));
  await db.query(
    `DELETE FROM obs_contributions
      WHERE cabinet_id = $1 AND indicateur = $2
        AND (periode = obs_periode_courante()
             OR periode < (SELECT max(p.periode) FROM obs_contributions p
                            WHERE p.cabinet_id = $1 AND p.indicateur = $2
                              AND p.periode < obs_periode_courante()))`,
    [auth.cabinetId, indicateur],
  );
  const c = preparation.contributions;
  if (c.length > 0) {
    await db.query(
      `INSERT INTO obs_contributions (cabinet_id, indicateur, secteur, taille, valeur, periode, verse_par)
       SELECT $1, $2, x.secteur, x.taille, x.valeur, obs_periode_courante(), $3
         FROM unnest($4::text[], $5::text[], $6::numeric[]) AS x(secteur, taille, valeur)`,
      [
        auth.cabinetId,
        indicateur,
        auth.utilisateurId,
        c.map((x) => x.secteur),
        c.map((x) => x.taille),
        c.map((x) => x.valeur),
      ],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "observatoire.versement",
    entite: ENTITE,
    details: {
      indicateur,
      versees: c.length,
      ecartees_sans_taille: preparation.sans_taille,
      ecartees_sans_valeur: preparation.sans_valeur,
    },
  });
  return {
    ...(await resumeContributions(db, auth.cabinetId, indicateur)),
    versees: c.length,
    ecartees_sans_taille: preparation.sans_taille,
    ecartees_sans_valeur: preparation.sans_valeur,
  };
}

/** Retrait de TOUTES les contributions du cabinet (minimisation) : effet immédiat. */
export async function retirerContributions(
  db: Db,
  auth: Auth,
): Promise<ObservatoireResultatRetrait> {
  const r = await db.query("DELETE FROM obs_contributions WHERE cabinet_id = $1", [auth.cabinetId]);
  const retirees = r.rowCount ?? 0;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "observatoire.retrait_contributions",
    entite: ENTITE,
    details: { retirees },
  });
  return { retirees };
}

interface LigneAgregat {
  secteur: string;
  taille: string;
  effectif_entreprises: number;
  effectif_cabinets: number;
  effectif_entreprises_autres: number;
  effectif_cabinets_autres: number;
  somme: string;
  histogramme: number[];
}

/** Agrégats : adhésion active exigée (doublée par MQK25 dans `obs_agregats`). */
export async function agregats(
  db: Db,
  auth: Auth,
  indicateur: ObservatoireIndicateurCode,
): Promise<ObservatoireAgregats> {
  if (!(await adhesionActive(db, auth.cabinetId))) throw reserveAdherents();
  // Réservé aux CONTRIBUTEURS (doublé par MQK27 dans `obs_agregats`) : un versement retenu.
  if ((await resumeContributions(db, auth.cabinetId, indicateur)).retenu === null) {
    throw contributionRequise();
  }
  const r = await db.query(
    `SELECT secteur, taille, effectif_entreprises, effectif_cabinets, effectif_entreprises_autres,
            effectif_cabinets_autres, somme::text AS somme,
            histogramme
       FROM obs_agregats($1)`,
    [indicateur],
  );
  const brutes: ObservatoireCaseBrute[] = (r.rows as LigneAgregat[]).map((l) => ({
    secteur: l.secteur,
    taille: l.taille,
    effectif_entreprises: l.effectif_entreprises,
    effectif_cabinets: l.effectif_cabinets,
    effectif_entreprises_autres: l.effectif_entreprises_autres,
    effectif_cabinets_autres: l.effectif_cabinets_autres,
    somme: l.somme,
    histogramme: l.histogramme.map(Number),
  }));
  const resultat = observatoireAgreger(brutes);
  return {
    indicateur,
    periode_courante: await periodeCourante(db),
    seuils: {
      entreprises_min: OBSERVATOIRE_ENTREPRISES_MIN,
      cabinets_min: OBSERVATOIRE_CABINETS_MIN,
      effectif_detaille: OBSERVATOIRE_EFFECTIF_DETAILLE,
    },
    secteurs: [...OBSERVATOIRE_SECTEURS],
    tailles: [...OBSERVATOIRE_TAILLES],
    cases: resultat.cases,
    marges: resultat.marges,
  };
}
