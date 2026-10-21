import {
  rapprocherVeille,
  veilleAnalyserImport,
  veilleCleDedoublonnage,
  veilleDedoublonner,
  veilleProfilCabinet,
  PROFIL_COMPETENCES_MAX,
  PROFIL_REFERENCES_MAX,
  type ReferenceCabinet,
  type VeilleAvisBrut,
  type VeilleErreurLigne,
  type VeilleFormat,
  type VeilleProfil,
} from "@missionpilot/engines";
import {
  VEILLE_RESULTATS_MAX,
  type AppelOffresCreation,
  type VeilleAvisSaisie,
  type VeilleResultatsQuery,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { inserer, lireFiche, lireProfilCabinet, type FicheAo } from "./fiches.js";
import {
  SOURCE_FICHIER,
  SOURCE_SAISIE,
  SOURCES_VEILLE,
  sourceVeille,
  type SourceVeille,
} from "./veille-sources.js";

/*
 * Veille multi-sources des appels d'offres (AO-01) : collecte DÉCLENCHÉE À LA MAIN (aucune
 * planification), import manuel (saisie, CSV, JSON), dédoublonnage et rapprochement par le
 * moteur, décisions en ajout seul, création d'une fiche. Aucun appel réseau : les adaptateurs
 * sont simulés (veille-sources.ts) et les URL des avis ne sont jamais visitées.
 *
 * Profil étendu lu en base : compétences des collaborateurs, compétences de la matrice (au
 * moins un niveau validé), secteurs, missions, fiches gagnées et références de la banque (AO-05).
 * Seuls des comptes sortent du rapprochement, et aucune donnée FIN-02 n'y entre.
 */

const FICHES_CLES_MAX = 20_000;

export interface BilanIngestion {
  lus: number;
  nouveaux: number;
  doublons: number;
  plafond: number;
}

/** Profil étendu du cabinet pour la veille, borné. */
export async function lireProfilVeille(db: Db): Promise<VeilleProfil> {
  const base = await lireProfilCabinet(db);
  const matrice = await db.query(
    `SELECT c.libelle FROM competences c
     WHERE c.active AND EXISTS (
       SELECT 1 FROM competence_declarations d
       JOIN competence_decisions x ON x.declaration_id = d.id AND x.decision = 'validee'
       WHERE d.competence_id = c.id)
     ORDER BY c.libelle LIMIT $1`,
    [PROFIL_COMPETENCES_MAX],
  );
  const banque = await db.query(
    `SELECT DISTINCT ON (v.reference_id) v.pays, v.secteurs, v.bailleur
     FROM ao_reference_versions v ORDER BY v.reference_id, v.version DESC LIMIT $1`,
    [PROFIL_REFERENCES_MAX],
  );
  const referencesBanque: ReferenceCabinet[] = [];
  for (const r of banque.rows as { pays: string; secteurs: string[]; bailleur: string | null }[]) {
    const secteurs: (string | null)[] = r.secteurs.length > 0 ? r.secteurs : [null];
    for (const secteur of secteurs) {
      referencesBanque.push({ secteur, pays: r.pays, bailleur: r.bailleur });
    }
  }
  return {
    base,
    competencesMatrice: (matrice.rows as { libelle: string }[]).map((x) => x.libelle),
    referencesBanque: referencesBanque.slice(0, PROFIL_REFERENCES_MAX),
  };
}

export interface VueSource {
  code: string;
  libelle: string;
  simulee: boolean;
  active: boolean;
  modifie_le: string | null;
}

export async function listerSources(db: Db): Promise<VueSource[]> {
  const r = await db.query(
    "SELECT code, active, modifie_le FROM ao_veille_sources WHERE code = ANY($1::text[])",
    [SOURCES_VEILLE.map((s) => s.code)],
  );
  const etat = new Map(
    (r.rows as { code: string; active: boolean; modifie_le: Date }[]).map((x) => [x.code, x]),
  );
  return SOURCES_VEILLE.map((s) => ({
    code: s.code,
    libelle: s.libelle,
    simulee: true,
    active: etat.get(s.code)?.active ?? false,
    modifie_le: etat.get(s.code)?.modifie_le.toISOString() ?? null,
  }));
}

export async function activerSource(
  db: Db,
  auth: Auth,
  code: string,
  active: boolean,
): Promise<VueSource> {
  const source = sourceVeille(code);
  if (!source) throw introuvable("Source de veille");
  await db.query(
    `INSERT INTO ao_veille_sources (cabinet_id, code, active, modifie_par)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cabinet_id, code)
     DO UPDATE SET active = EXCLUDED.active, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
    [auth.cabinetId, code, active, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: active ? "activation" : "desactivation",
    entite: "ao_veille_source",
    details: { code },
  });
  return (await listerSources(db)).find((s) => s.code === code) as VueSource;
}

const verrou = (db: Db, auth: Auth) =>
  db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `ao_veille:${auth.cabinetId}`,
  ]);

/** Clés des fiches déjà présentes (référence, sinon titre + bailleur + date limite). */
async function clesDesFiches(db: Db): Promise<Map<string, string>> {
  const r = await db.query(
    `SELECT id, reference, titre, bailleur, date_limite::text AS date_limite
     FROM appels_offres ORDER BY cree_le DESC, id DESC LIMIT $1`,
    [FICHES_CLES_MAX],
  );
  const cles = new Map<string, string>();
  for (const f of r.rows as {
    id: string;
    reference: string | null;
    titre: string;
    bailleur: string | null;
    date_limite: string | null;
  }[]) {
    cles.set(veilleCleDedoublonnage(f), f.id);
  }
  return cles;
}

/**
 * Ingère des avis bruts : dédoublonnage (autres sources, imports, fiches existantes), création
 * des résultats nouveaux avec leur rapprochement, ajout d'une occurrence (source, jour) sinon.
 */
export async function ingerer(
  db: Db,
  auth: Auth,
  source: { code: string; libelle: string },
  avis: readonly VeilleAvisBrut[],
  maintenant: Date,
): Promise<BilanIngestion> {
  await verrou(db, auth);
  const bilan: BilanIngestion = { lus: avis.length, nouveaux: 0, doublons: 0, plafond: 0 };
  if (avis.length === 0) return bilan;
  const connus = await db.query(
    "SELECT id, cle FROM ao_veille_resultats WHERE cle = ANY($1::text[])",
    [avis.map((a) => veilleCleDedoublonnage(a))],
  );
  const ids = new Map((connus.rows as { id: string; cle: string }[]).map((x) => [x.cle, x.id]));
  const entrees = veilleDedoublonner(avis, new Set(ids.keys()));
  const fiches = entrees.some((e) => !ids.has(e.cle)) ? await clesDesFiches(db) : new Map();
  const profil = entrees.some((e) => !ids.has(e.cle)) ? await lireProfilVeille(db) : null;
  const existants = (await db.query("SELECT count(*)::int AS n FROM ao_veille_resultats")).rows[0]
    .n as number;
  let restant = VEILLE_RESULTATS_MAX - existants;
  const jour = maintenant.toISOString().slice(0, 10);

  for (const e of entrees) {
    let id = ids.get(e.cle);
    if (id) bilan.doublons += 1;
    else if (restant <= 0) {
      bilan.plafond += 1;
      continue;
    } else {
      const ficheId = (fiches.get(e.cle) as string | undefined) ?? null;
      const rap = rapprocherVeille(e.avis, profil as VeilleProfil);
      const explique = { ...rap };
      delete (explique as { rapprochement?: unknown }).rapprochement;
      const a = e.avis;
      const r = await db.query(
        `INSERT INTO ao_veille_resultats (cabinet_id, cle, reference, titre, objet, bailleur, pays,
           secteur, montant_estime, devise, date_publication, date_limite, url, mots_cles, statut,
           fiche_id, score_rapprochement, rapprochement)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id`,
        [
          auth.cabinetId,
          e.cle,
          a.reference,
          a.titre,
          a.objet,
          a.bailleur,
          a.pays,
          a.secteur,
          a.montant_estime,
          a.devise ?? "XOF",
          a.date_publication,
          a.date_limite,
          a.url,
          a.mots_cles,
          ficheId ? "fiche_creee" : "nouveau",
          ficheId,
          rap.score,
          JSON.stringify(explique),
        ],
      );
      id = r.rows[0].id as string;
      ids.set(e.cle, id);
      restant -= 1;
      if (ficheId) bilan.doublons += 1;
      else bilan.nouveaux += 1;
    }
    await db.query(
      `INSERT INTO ao_veille_occurrences (cabinet_id, resultat_id, source_code, source_libelle,
         jour, vu_le, cree_par)
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE (SELECT count(*) FROM ao_veille_occurrences WHERE resultat_id = $2) < 500
       ON CONFLICT (resultat_id, source_code, jour) DO NOTHING`,
      [
        auth.cabinetId,
        id,
        source.code,
        source.libelle,
        jour,
        maintenant.toISOString(),
        auth.utilisateurId,
      ],
    );
  }
  return bilan;
}

export interface BilanCollecte extends BilanIngestion {
  sources: ({ code: string; libelle: string } & BilanIngestion)[];
}

/** Collecte à la main : sources demandées (ou toutes les actives), qui doivent être activées. */
export async function collecter(
  db: Db,
  auth: Auth,
  codes: readonly string[] | undefined,
  maintenant: Date,
): Promise<BilanCollecte> {
  const etat = await listerSources(db);
  const actives = etat.filter((s) => s.active).map((s) => s.code);
  const demandees = codes && codes.length > 0 ? [...new Set(codes)] : actives;
  for (const c of demandees) {
    if (!sourceVeille(c)) throw introuvable("Source de veille");
    if (!actives.includes(c)) throw conflit("Une source demandée n'est pas activée.");
  }
  if (demandees.length === 0) throw conflit("Aucune source de veille n'est activée.");
  const total: BilanCollecte = { lus: 0, nouveaux: 0, doublons: 0, plafond: 0, sources: [] };
  for (const code of demandees) {
    const s = sourceVeille(code) as SourceVeille;
    const bilan = await ingerer(db, auth, s, await s.collecter({ maintenant }), maintenant);
    total.sources.push({ code: s.code, libelle: s.libelle, ...bilan });
    for (const k of ["lus", "nouveaux", "doublons", "plafond"] as const) total[k] += bilan[k];
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "collecte",
    entite: "ao_veille",
    details: { sources: demandees, nouveaux: total.nouveaux, doublons: total.doublons },
  });
  return total;
}

export interface BilanImport extends BilanIngestion {
  format: VeilleFormat;
  erreurs: VeilleErreurLigne[];
}

/** Import d'un fichier CSV ou JSON (texte lu par la page) : lignes valides ingérées, erreurs rendues. */
export async function importerTexte(
  db: Db,
  auth: Auth,
  texte: string,
  format: VeilleFormat | undefined,
  maintenant: Date,
): Promise<BilanImport> {
  const analyse = veilleAnalyserImport(texte, format);
  const bilan = await ingerer(db, auth, SOURCE_FICHIER, analyse.avis, maintenant);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "import",
    entite: "ao_veille",
    details: { format: analyse.format, nouveaux: bilan.nouveaux, erreurs: analyse.erreurs.length },
  });
  return { ...bilan, format: analyse.format, erreurs: analyse.erreurs };
}

/** Saisie manuelle d'un avis. */
export async function saisirAvis(
  db: Db,
  auth: Auth,
  s: VeilleAvisSaisie,
  maintenant: Date,
): Promise<{ bilan: BilanIngestion; id: string }> {
  const avis: VeilleAvisBrut = {
    reference: s.reference ?? null,
    titre: s.titre,
    objet: s.objet ?? null,
    bailleur: s.bailleur ?? null,
    pays: s.pays ?? null,
    secteur: s.secteur ?? null,
    montant_estime: s.montant_estime ?? null,
    devise: s.devise ?? null,
    date_publication: s.date_publication ?? null,
    date_limite: s.date_limite ?? null,
    url: s.url ?? null,
    mots_cles: s.mots_cles ?? [],
  };
  const bilan = await ingerer(db, auth, SOURCE_SAISIE, [avis], maintenant);
  if (bilan.plafond > 0)
    throw new AppError(409, "AO_VEILLE_PLAFOND", "Plafond de résultats atteint.");
  const r = await db.query("SELECT id FROM ao_veille_resultats WHERE cle = $1", [
    veilleCleDedoublonnage(avis),
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "saisie",
    entite: "ao_veille_resultat",
    entiteId: r.rows[0].id as string,
    details: { nouveau: bilan.nouveaux === 1 },
  });
  return { bilan, id: r.rows[0].id as string };
}

const COLONNES_RESULTAT = `r.id, r.reference, r.titre, r.objet, r.bailleur, r.pays, r.secteur,
  r.montant_estime, r.devise, r.date_publication::text AS date_publication,
  r.date_limite::text AS date_limite, r.url, r.mots_cles, r.statut, r.fiche_id,
  r.score_rapprochement, r.rapprochement, r.cree_le, r.modifie_le`;

const vue = <T extends Record<string, unknown>>(l: T): T => ({
  ...l,
  montant_estime:
    l.montant_estime === null || l.montant_estime === undefined ? null : Number(l.montant_estime),
});

export async function listerResultats(db: Db, q: VeilleResultatsQuery) {
  const motif = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const filtre = `($1::text IS NULL OR r.statut = $1)
    AND ($2::text IS NULL OR r.titre ILIKE $2 OR r.bailleur ILIKE $2 OR r.reference ILIKE $2)
    AND ($3::int IS NULL OR r.score_rapprochement >= $3)`;
  const params = [q.statut ?? null, motif, q.score_min ?? null];
  const lignes = await db.query(
    `SELECT ${COLONNES_RESULTAT},
       (SELECT count(*)::int FROM ao_veille_occurrences o WHERE o.resultat_id = r.id) AS nb_occurrences,
       (SELECT array_agg(DISTINCT o.source_libelle ORDER BY o.source_libelle)
          FROM ao_veille_occurrences o WHERE o.resultat_id = r.id) AS sources
     FROM ao_veille_resultats r WHERE ${filtre}
     ORDER BY r.score_rapprochement DESC, r.cree_le DESC, r.id LIMIT $4 OFFSET $5`,
    [...params, q.limite, q.decalage],
  );
  const total = await db.query(
    `SELECT count(*)::int AS n FROM ao_veille_resultats r WHERE ${filtre}`,
    params,
  );
  return { elements: lignes.rows.map(vue), total: total.rows[0].n as number };
}

export async function lireResultat(db: Db, id: string, verrouiller = false) {
  const r = await db.query(
    `SELECT ${COLONNES_RESULTAT} FROM ao_veille_resultats r WHERE r.id = $1
     ${verrouiller ? "FOR UPDATE OF r" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Résultat de veille");
  return vue(r.rows[0] as Record<string, unknown> & { statut: string; fiche_id: string | null });
}

export async function detailResultat(db: Db, id: string) {
  const resultat = await lireResultat(db, id);
  const occurrences = await db.query(
    `SELECT source_code, source_libelle, jour::text AS jour, vu_le FROM ao_veille_occurrences
     WHERE resultat_id = $1 ORDER BY vu_le, id`,
    [id],
  );
  const decisions = await db.query(
    `SELECT d.id, d.decision, d.motif, d.fiche_id, d.auteur_id, u.nom AS auteur_nom, d.cree_le
     FROM ao_veille_decisions d JOIN utilisateurs u ON u.id = d.auteur_id
     WHERE d.resultat_id = $1 ORDER BY d.cree_le, d.id`,
    [id],
  );
  return { ...resultat, occurrences: occurrences.rows, decisions: decisions.rows };
}

export async function resumeVeille(db: Db) {
  const r = await db.query(
    "SELECT statut, count(*)::int AS n FROM ao_veille_resultats GROUP BY statut",
  );
  const par_statut: Record<string, number> = { nouveau: 0, retenu: 0, ecarte: 0, fiche_creee: 0 };
  let total = 0;
  for (const l of r.rows as { statut: string; n: number }[]) {
    par_statut[l.statut] = l.n;
    total += l.n;
  }
  const sources = await listerSources(db);
  return {
    total,
    plafond: VEILLE_RESULTATS_MAX,
    par_statut,
    sources_actives: sources.filter((s) => s.active).length,
  };
}

type Decision = "retenir" | "ecarter" | "reexaminer";
const STATUT_APRES: Record<Decision, string> = {
  retenir: "retenu",
  ecarter: "ecarte",
  reexaminer: "nouveau",
};

/** Retenir, écarter (motif) ou réexaminer (motif) : décision en ajout seul, puis statut. */
export async function decider(
  db: Db,
  auth: Auth,
  id: string,
  decision: Decision,
  motif: string | null,
) {
  await lireResultat(db, id, true);
  await db.query(
    `INSERT INTO ao_veille_decisions (cabinet_id, resultat_id, decision, motif, auteur_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, id, decision, motif, auth.utilisateurId],
  );
  await db.query("UPDATE ao_veille_resultats SET statut = $2, modifie_le = now() WHERE id = $1", [
    id,
    STATUT_APRES[decision],
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: decision,
    entite: "ao_veille_resultat",
    entiteId: id,
    details: { statut: STATUT_APRES[decision] },
  });
  return detailResultat(db, id);
}

/** Crée la fiche d'appel d'offres du résultat (source « import », libellé de la source). */
export async function creerFicheDepuisResultat(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ resultat: Awaited<ReturnType<typeof detailResultat>>; fiche: FicheAo }> {
  const r = await lireResultat(db, id, true);
  if (r.fiche_id || !["nouveau", "retenu"].includes(r.statut)) {
    throw new AppError(
      409,
      "AO_VEILLE_DECISION_INCOHERENTE",
      "Une fiche existe déjà pour ce résultat, ou il est écarté : réexaminez-le d'abord.",
    );
  }
  const reference = r.reference as string | null;
  if (reference) {
    const dejaLa = await db.query(
      "SELECT 1 FROM appels_offres WHERE lower(reference) = lower($1)",
      [reference],
    );
    if (dejaLa.rows.length > 0) {
      throw new AppError(
        409,
        "AO_REFERENCE_EXISTANTE",
        `Un appel d'offres porte déjà la référence « ${reference} » : aucune fiche n'a été créée.`,
      );
    }
  }
  const premiere = await db.query(
    "SELECT source_libelle FROM ao_veille_occurrences WHERE resultat_id = $1 ORDER BY vu_le, source_code LIMIT 1",
    [id],
  );
  const libelle = (premiere.rows[0]?.source_libelle as string | undefined) ?? null;
  const champs = {
    reference,
    titre: r.titre,
    objet: r.objet,
    bailleur: r.bailleur,
    pays: r.pays,
    secteur: r.secteur,
    montant_estime: r.montant_estime,
    devise: r.devise,
    date_publication: r.date_publication,
    date_limite: r.date_limite,
    url: r.url,
    mots_cles: r.mots_cles,
    source_libelle: libelle,
  } as AppelOffresCreation;
  const profil = veilleProfilCabinet(await lireProfilVeille(db));
  const ficheId = await inserer(db, auth, champs, "import", profil, libelle);
  await db.query(
    `INSERT INTO ao_veille_decisions (cabinet_id, resultat_id, decision, fiche_id, auteur_id)
     VALUES ($1, $2, 'creer_fiche', $3, $4)`,
    [auth.cabinetId, id, ficheId, auth.utilisateurId],
  );
  await db.query(
    "UPDATE ao_veille_resultats SET statut = 'fiche_creee', fiche_id = $2, modifie_le = now() WHERE id = $1",
    [id, ficheId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "appel_offres",
    entiteId: ficheId,
    details: { source: "veille", resultat_id: id },
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creer_fiche",
    entite: "ao_veille_resultat",
    entiteId: id,
    details: { fiche_id: ficheId },
  });
  return { resultat: await detailResultat(db, id), fiche: await lireFiche(db, ficheId) };
}
