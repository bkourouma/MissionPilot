import {
  appliquerAjustement,
  comparerNotations,
  donneesRapport,
  initialiserAjustements,
  type DefinitionQuestionnaire,
  type EcartRepondants,
  type GrilleNotation,
  type ResultatNotation,
  type ScoreAjuste,
} from "@missionpilot/engines";
import {
  GRILLE_GENERIQUE,
  type AjustementNotation,
  type CalculNotation,
  type StatutVersionNotation,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import {
  exigerExpertMetier,
  exigerMissionOuverte,
  missionVisibleOu404,
} from "../questionnaires/acces.js";
import { reponsesSoumises } from "../questionnaires/envois.js";
import { calculerV2, type EntreesCalculNotation } from "./calcul.js";
import { lireVersionGrille } from "./grilles.js";
import { brancherNotation } from "../qualite/branchements.js";
import { calculerConfiance, enregistrerConfiance } from "./confiance.js";
import {
  enregistrerCalculMethode,
  executerNotationMethode,
  lireCalculMethode,
  methodeNotationMission,
  missionLieeAMethode,
} from "./via-methode.js";

/*
 * Notation d'une mission (service 1) — RÈGLES (testées dans
 * test/notation-*.test.ts ; doublées par les déclencheurs de 0146) :
 *
 * 1. Une notation par mission (entreprise cliente de la mission), lisible si
 *    la mission est visible ; écrire (calcul, ajustement) exige une mission
 *    non clôturée.
 * 2. Tout chiffre vient du moteur : `noterQuestionnaire` (collectif) ou
 *    `noterRepondants` (moyenne par indicateur des répondants, réponses
 *    préparées par `preparerReponses`), `appliquerAjustement` (NOT-04),
 *    `detecterEcarts` (NOT-05), `donneesRapport` et `comparerNotations`
 *    (NOT-06/07). L'API ne recalcule jamais un score.
 * 3. Chaque calcul crée une version (ajout seul) : grille, définition,
 *    réponses utilisées et résultat figés et horodatés. Les ajustements
 *    d'une version ne sont pas reportés sur la suivante.
 * 4. Revue : brouillon → en revue (notation.gerer) → publiée
 *    (notation.publier) ; renvoi en brouillon motivé (notation.publier).
 *    Publier et renvoyer exigent EN PLUS le rôle `expert_metier`
 *    (DECISIONS.md, NOT-07 : un expert valide obligatoirement ; un associé
 *    sans ce rôle ne publie pas). Le publieur n'est ni l'auteur du calcul, ni
 *    d'un ajustement, ni de la soumission (séparation des tâches stricte).
 *    Les deux règles de publication sont doublées en base (MPN04). Une
 *    version publiée est immuable : toute correction est un nouveau calcul.
 * 5. Mission liée à une méthode (référentiel, ADR-004) : le calcul est
 *    exécuté DEPUIS la méthode effective (`via-methode.ts`, mêmes moteurs) et
 *    la version enregistre la version de méthode et son journal de modulation
 *    (`notation_versions_methode`, 0206). Sans méthode : chemin V2 inchangé
 *    (`calcul.ts`).
 * 6. Publication : indice de confiance (NOT-11, `confiance.ts`) au moins égal au seuil du
 *    cabinet, recalculé et enregistré dans la transaction (409 CONFIANCE_INSUFFISANTE, MPN10).
 */

export interface Notation {
  id: string;
  mission_id: string;
  client_id: string;
  cree_par: string;
  cree_le: Date;
}

interface VersionNotation {
  id: string;
  notation_id: string;
  numero: number;
  envoi_id: string;
  grille_version_id: string | null;
  grille: GrilleNotation;
  definition: DefinitionQuestionnaire;
  secteur: string | null;
  strategie: "ignorer" | "penaliser";
  reponses_ids: string[];
  resultat: ResultatNotation;
  ecarts: EcartRepondants[];
  calcule_par: string;
  calcule_le: Date;
}

interface LigneAjustement {
  id: string;
  rang: number;
  dimension: string;
  delta: string;
  motif: string;
  date_ajustement: string;
  score_avant: string;
  score_apres: string;
  plafonne: boolean;
  auteur_id: string;
  auteur_nom: string;
  cree_le: Date;
}

interface LigneEvenement {
  rang: number;
  action: "soumission" | "renvoi" | "publication";
  motif: string | null;
  par: string;
  par_nom: string;
  le: Date;
}

interface VersionChargee {
  version: VersionNotation;
  ajustements: LigneAjustement[];
  evenements: LigneEvenement[];
  derniere: boolean;
  statut: StatutVersionNotation;
  etat: ScoreAjuste;
}

const COLONNES_NOTATION = "n.id, n.mission_id, n.client_id, n.cree_par, n.cree_le";

/**
 * Notation dont la mission est visible, sinon 404. `verrouiller` sérialise
 * les écritures par un verrou sur la ligne de la MISSION (les tables de
 * notation sont en ajout seul : pas de droit UPDATE, donc pas de FOR UPDATE).
 */
export async function exigerNotationVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<Notation> {
  const r = await db.query(`SELECT ${COLONNES_NOTATION} FROM notations n WHERE n.id = $1`, [id]);
  const notation = r.rows[0] as Notation | undefined;
  if (!notation) throw introuvable("Notation");
  await missionVisibleOu404(db, auth, notation.mission_id, "Notation", verrouiller);
  return notation;
}

/** Notation d'une mission visible, ou null. */
export async function notationDeMission(db: Db, missionId: string): Promise<Notation | null> {
  const r = await db.query(`SELECT ${COLONNES_NOTATION} FROM notations n WHERE n.mission_id = $1`, [
    missionId,
  ]);
  return (r.rows[0] as Notation | undefined) ?? null;
}

export async function creerNotation(db: Db, auth: Auth, missionId: string): Promise<Notation> {
  const mission = await exigerMissionOuverte(db, auth, missionId);
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO notations (cabinet_id, mission_id, client_id, cree_par) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [auth.cabinetId, missionId, mission.client_id, auth.utilisateurId],
    ),
    { "*": "Cette mission a déjà sa notation." },
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "notation",
    entiteId: r.rows[0].id as string,
    details: { mission_id: missionId },
  });
  return (await notationDeMission(db, missionId)) as Notation;
}

/** Statut dérivé du dernier événement ; une version non dernière et non publiée est remplacée. */
function statutVersion(
  evenements: readonly LigneEvenement[],
  derniere: boolean,
): StatutVersionNotation {
  const action = evenements[evenements.length - 1]?.action;
  if (action === "publication") return "publiee";
  if (!derniere) return "remplacee";
  return action === "soumission" ? "en_revue" : "brouillon";
}

/** Score ajusté : rejoue l'historique d'ajustements par le moteur. */
function rejouer(resultat: ResultatNotation, ajustements: readonly LigneAjustement[]): ScoreAjuste {
  return ajustements.reduce<ScoreAjuste>(
    (etat, a) =>
      appliquerAjustement(etat, {
        dimension: a.dimension,
        delta: Number(a.delta),
        motif: a.motif,
        auteur: a.auteur_id,
        date: a.date_ajustement,
      }),
    initialiserAjustements(resultat),
  );
}

async function chargerVersionPar(
  db: Db,
  notationId: string,
  filtre: { numero?: number; versionId?: string },
): Promise<VersionChargee | null> {
  const r = await db.query(
    `SELECT v.*, (v.numero = (SELECT max(w.numero) FROM notation_versions w
                              WHERE w.notation_id = v.notation_id)) AS derniere
     FROM notation_versions v
     WHERE v.notation_id = $1
       AND ($2::int IS NULL OR v.numero = $2) AND ($3::uuid IS NULL OR v.id = $3)
     ORDER BY v.numero DESC LIMIT 1`,
    [notationId, filtre.numero ?? null, filtre.versionId ?? null],
  );
  const ligne = r.rows[0] as (VersionNotation & { derniere: boolean }) | undefined;
  if (!ligne) return null;
  const { derniere, ...version } = ligne;
  const a = await db.query(
    `SELECT a.id, a.rang, a.dimension, a.delta::text AS delta, a.motif,
       a.date_ajustement::text AS date_ajustement, a.score_avant::text AS score_avant,
       a.score_apres::text AS score_apres, a.plafonne, a.auteur_id, u.nom AS auteur_nom, a.cree_le
     FROM notation_ajustements a JOIN utilisateurs u ON u.id = a.auteur_id
     WHERE a.version_id = $1 ORDER BY a.rang`,
    [version.id],
  );
  const e = await db.query(
    `SELECT e.rang, e.action, e.motif, e.par, u.nom AS par_nom, e.le
     FROM notation_evenements e JOIN utilisateurs u ON u.id = e.par
     WHERE e.version_id = $1 ORDER BY e.rang`,
    [version.id],
  );
  const ajustements = a.rows as LigneAjustement[];
  const evenements = e.rows as LigneEvenement[];
  return {
    version,
    ajustements,
    evenements,
    derniere,
    statut: statutVersion(evenements, derniere),
    etat: rejouer(version.resultat, ajustements),
  };
}

/** Dernière version (ou celle de ce numéro), sinon null. */
export const chargerVersion = (db: Db, notationId: string, numero?: number) =>
  chargerVersionPar(db, notationId, numero === undefined ? {} : { numero });

async function exigerDerniere(db: Db, notationId: string): Promise<VersionChargee> {
  const v = await chargerVersion(db, notationId);
  if (!v) throw conflit("Aucun calcul n'a encore été lancé pour cette notation.");
  return v;
}

/** Vue d'une version : calcul figé, score ajusté (moteur), historique, revue. */
export async function vueVersion(db: Db, v: VersionChargee) {
  const r = await db.query(
    `SELECT r.id, u.nom, r.fonction FROM questionnaire_repondants r
     JOIN utilisateurs u ON u.id = r.utilisateur_id WHERE r.envoi_id = $1`,
    [v.version.envoi_id],
  );
  const noms = new Map(
    r.rows.map((l) => [l.id as string, { id: l.id, nom: l.nom, fonction: l.fonction }]),
  );
  const calculePar = await db.query("SELECT nom FROM utilisateurs WHERE id = $1", [
    v.version.calcule_par,
  ]);
  const methode = await lireCalculMethode(db, v.version.id);
  return {
    id: v.version.id,
    notation_id: v.version.notation_id,
    numero: v.version.numero,
    statut: v.statut,
    envoi_id: v.version.envoi_id,
    grille: {
      version_id: v.version.grille_version_id,
      generique: v.version.grille_version_id === null,
      code: v.version.grille.id,
      version: v.version.grille.version,
      titre: v.version.grille.titre,
    },
    secteur: v.version.secteur,
    strategie: v.version.strategie,
    // Calcul depuis le référentiel de méthodes (null : chemin V2, mission sans méthode).
    methode: methode
      ? {
          methode_version_id: methode.methode_version_id,
          mission_methode_id: methode.mission_methode_id,
          journal: methode.execution,
        }
      : null,
    reponses_utilisees: v.version.reponses_ids.length,
    calcule_par: { id: v.version.calcule_par, nom: calculePar.rows[0]?.nom ?? null },
    calcule_le: v.version.calcule_le,
    resultat: v.version.resultat,
    score: {
      notable: v.etat.notable,
      score_calcule: v.etat.scoreCalcule,
      score: v.etat.score,
      classe: v.etat.classe,
      dimensions: v.etat.dimensions,
    },
    ajustements: v.ajustements.map((a) => ({
      rang: a.rang,
      dimension: a.dimension,
      delta: Number(a.delta),
      motif: a.motif,
      date: a.date_ajustement,
      score_avant: Number(a.score_avant),
      score_apres: Number(a.score_apres),
      plafonne: a.plafonne,
      auteur: { id: a.auteur_id, nom: a.auteur_nom },
      cree_le: a.cree_le,
    })),
    revue: v.evenements.map((e) => ({
      rang: e.rang,
      action: e.action,
      motif: e.motif,
      par: { id: e.par, nom: e.par_nom },
      le: e.le,
    })),
    ecarts: v.version.ecarts.map((e) => ({
      question: e.question,
      libelle: e.libelle,
      min: e.min,
      max: e.max,
      ecart: e.ecart,
      nombre_repondants: e.nombreRepondants,
      repondants_min: e.repondantsMin.map((id) => noms.get(id) ?? { id }),
      repondants_max: e.repondantsMax.map((id) => noms.get(id) ?? { id }),
    })),
  };
}

/** Résumé de la notation d'une mission : versions, statut et score ajusté de chacune. */
export async function resumeNotation(db: Db, notation: Notation) {
  const r = await db.query(
    "SELECT numero FROM notation_versions WHERE notation_id = $1 ORDER BY numero DESC",
    [notation.id],
  );
  const versions = [];
  for (const l of r.rows) {
    const v = (await chargerVersion(db, notation.id, l.numero as number)) as VersionChargee;
    versions.push({
      numero: v.version.numero,
      statut: v.statut,
      score: v.etat.score,
      classe: v.etat.classe,
      calcule_le: v.version.calcule_le,
      publiee_le: v.evenements.find((e) => e.action === "publication")?.le ?? null,
    });
  }
  return { ...notation, versions };
}

async function chargerGrille(db: Db, grilleVersionId: string | null) {
  if (grilleVersionId === null) return GRILLE_GENERIQUE as GrilleNotation;
  const v = await lireVersionGrille(db, grilleVersionId);
  if (v.statut !== "valide") throw conflit("Seule une version de grille validée sert au calcul.");
  return v.contenu;
}

/** Nouveau calcul (nouvelle version) sur les réponses soumises d'un questionnaire de la mission. */
export async function calculer(db: Db, auth: Auth, notation: Notation, corps: CalculNotation) {
  await exigerMissionOuverte(db, auth, notation.mission_id);
  const precedente = await chargerVersion(db, notation.id);
  if (precedente?.statut === "en_revue") {
    throw conflit("La version en revue doit être publiée ou renvoyée avant un nouveau calcul.");
  }
  const e = await db.query(
    `SELECT id, mode, statut, definition FROM questionnaire_envois
     WHERE id = $1 AND mission_id = $2`,
    [corps.envoi_id, notation.mission_id],
  );
  const envoi = e.rows[0] as
    { id: string; mode: string; statut: string; definition: DefinitionQuestionnaire } | undefined;
  if (!envoi) throw introuvable("Questionnaire");
  const soumises = await reponsesSoumises(db, envoi.id);
  if (soumises.length === 0) throw conflit("Aucune réponse soumise à ce questionnaire.");
  const grille = await chargerGrille(db, corps.grille_version_id);
  if (corps.secteur !== null && !(grille.secteurs ?? []).some((s) => s.secteur === corps.secteur)) {
    throw requeteInvalide("Ce secteur n'a pas de pondération dans la grille choisie.");
  }
  const entrees: EntreesCalculNotation = {
    grille,
    definition: envoi.definition,
    collectif: envoi.mode === "collectif",
    soumises,
    options: {
      strategie: corps.strategie,
      ...(corps.secteur ? { secteur: corps.secteur } : {}),
    },
  };
  // Mission liée à une méthode : calcul depuis la méthode effective (mêmes moteurs que la V2).
  const methode = await methodeNotationMission(db, notation.mission_id);
  const viaMethode = methode ? executerNotationMethode(methode, entrees) : null;
  const { resultat, ecarts } = viaMethode ?? calculerV2(entrees);
  const grilleUtilisee = viaMethode?.grille ?? grille;
  const def = envoi.definition;
  const numero = (precedente?.version.numero ?? 0) + 1;
  const ins = await db.query(
    `INSERT INTO notation_versions (cabinet_id, notation_id, numero, envoi_id, grille_version_id,
       grille, definition, secteur, strategie, reponses_ids, resultat, ecarts, calcule_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      auth.cabinetId,
      notation.id,
      numero,
      envoi.id,
      corps.grille_version_id,
      JSON.stringify(grilleUtilisee),
      JSON.stringify(def),
      corps.secteur,
      corps.strategie,
      soumises.map((s) => s.id),
      JSON.stringify(resultat),
      JSON.stringify(ecarts),
      auth.utilisateurId,
    ],
  );
  if (methode && viaMethode) {
    await enregistrerCalculMethode(
      db,
      auth.cabinetId,
      ins.rows[0].id as string,
      methode,
      viaMethode.journal,
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "calcul",
    entite: "notation",
    entiteId: notation.id,
    details: {
      version_id: ins.rows[0].id,
      numero,
      envoi_id: envoi.id,
      grille_version_id: corps.grille_version_id,
      score: resultat.score,
      classe: resultat.classe,
      ...(methode ? { methode_version_id: methode.version.id } : {}),
    },
  });
  return (await chargerVersion(db, notation.id, numero)) as VersionChargee;
}

/** Ajustement motivé (NOT-04) de la dernière version en brouillon, par le moteur. */
export async function ajuster(db: Db, auth: Auth, notation: Notation, corps: AjustementNotation) {
  await exigerMissionOuverte(db, auth, notation.mission_id);
  const v = await exigerDerniere(db, notation.id);
  if (v.statut !== "brouillon") {
    throw conflit("Seule une version en brouillon s'ajuste : renvoyez-la ou relancez un calcul.");
  }
  const suivant = appliquerAjustement(v.etat, {
    dimension: corps.dimension,
    delta: corps.delta,
    motif: corps.motif,
    auteur: auth.utilisateurId,
    date: aujourdhui(),
  });
  const trace = suivant.ajustements[
    suivant.ajustements.length - 1
  ] as ScoreAjuste["ajustements"][number];
  await db.query(
    `INSERT INTO notation_ajustements (cabinet_id, version_id, rang, dimension, delta, motif,
       date_ajustement, score_avant, score_apres, plafonne, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      auth.cabinetId,
      v.version.id,
      trace.rang,
      trace.dimension,
      trace.delta,
      trace.motif,
      trace.date,
      trace.scoreAvant,
      trace.scoreApres,
      trace.plafonne,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "ajustement",
    entite: "notation",
    entiteId: notation.id,
    details: {
      version_id: v.version.id,
      rang: trace.rang,
      dimension: trace.dimension,
      delta: trace.delta,
      score_avant: trace.scoreAvant,
      score_apres: trace.scoreApres,
    },
  });
  return (await chargerVersion(db, notation.id)) as VersionChargee;
}

async function evenement(
  db: Db,
  auth: Auth,
  notation: Notation,
  v: VersionChargee,
  action: LigneEvenement["action"],
  motif: string | null,
) {
  await db.query(
    `INSERT INTO notation_evenements (cabinet_id, version_id, rang, action, motif, par)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.cabinetId, v.version.id, v.evenements.length + 1, action, motif, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: `notation_${action}`,
    entite: "notation",
    entiteId: notation.id,
    details: { version_id: v.version.id, numero: v.version.numero, ...(motif ? { motif } : {}) },
  });
  return (await chargerVersion(db, notation.id)) as VersionChargee;
}

/**
 * Suivi qualité de la version (QUA, classe minimale R3) avec les éléments de la revue guidée :
 * assertions fragiles de la mission, scores, recommandations candidates de sa méthode.
 */
async function brancherQualite(db: Db, auth: Auth, notation: Notation, v: VersionChargee) {
  const methode = await methodeNotationMission(db, notation.mission_id);
  return brancherNotation(db, auth, {
    missionId: notation.mission_id,
    notationId: notation.id,
    numero: v.version.numero,
    etat: v.etat,
    recommandations: methode?.recommandations ?? [],
  });
}

/** Soumission en revue (notation.gerer) : dernière version, brouillon, score global notable. */
export async function soumettreRevue(db: Db, auth: Auth, notation: Notation) {
  const v = await exigerDerniere(db, notation.id);
  if (v.statut !== "brouillon") throw conflit("Seule une version en brouillon se soumet en revue.");
  if (!v.etat.notable) {
    throw conflit("Le score global n'est pas notable : complétez les réponses avant la revue.");
  }
  const apres = await evenement(db, auth, notation, v, "soumission", null);
  // La revue qualité (R3 : quatre yeux et signature) s'ouvre avec la revue de la notation.
  await brancherQualite(db, auth, notation, apres);
  return apres;
}

/** Statut du suivi qualité d'une version de notation (null : aucun suivi). */
async function statutSuiviQualite(db: Db, notationId: string, numero: number) {
  const r = await db.query(
    `SELECT statut FROM qualite_suivis
     WHERE type_livrable = 'notation' AND livrable_id = $1 AND version = $2`,
    [notationId, numero],
  );
  return (r.rows[0]?.statut as string | undefined) ?? null;
}

/** Renvoi en brouillon (notation.publier, expert métier), motif obligatoire. */
export async function renvoyer(db: Db, auth: Auth, notation: Notation, motif: string) {
  exigerExpertMetier(auth, "renvoie une notation en brouillon");
  const v = await exigerDerniere(db, notation.id);
  if (v.statut !== "en_revue") throw conflit("Seule une version en revue se renvoie.");
  return evenement(db, auth, notation, v, "renvoi", motif);
}

/**
 * Publication (notation.publier, expert métier) avec séparation des tâches stricte (MPN04).
 * Mission liée à une méthode (référentiel) : la notation est un livrable R3 et sa publication
 * exige EN PLUS le suivi qualité de la version SIGNÉ (quatre yeux et signature du directeur,
 * QUA-04) ; sans méthode, comportement V2 inchangé (le suivi est ouvert à la publication).
 */
export async function publier(db: Db, auth: Auth, notation: Notation) {
  exigerExpertMetier(auth, "publie une notation");
  const v = await exigerDerniere(db, notation.id);
  if (v.statut !== "en_revue") throw conflit("Seule une version en revue se publie.");
  const auteurs = new Set([
    v.version.calcule_par,
    ...v.ajustements.map((a) => a.auteur_id),
    ...v.evenements.filter((e) => e.action === "soumission").map((e) => e.par),
  ]);
  if (auteurs.has(auth.utilisateurId)) {
    throw new AppError(
      403,
      "SEPARATION_DES_TACHES",
      "L'auteur du calcul, d'un ajustement ou de la soumission ne publie pas la notation : un autre expert doit la relire.",
    );
  }
  if (await missionLieeAMethode(db, notation.mission_id)) {
    const statut = await statutSuiviQualite(db, notation.id, v.version.numero);
    if (statut !== "signe") {
      throw new AppError(
        409,
        "SUIVI_QUALITE_NON_SIGNE",
        "Notation de classe R3 : sa publication exige le suivi qualité de cette version signé (revue d'un second expert et signature du directeur de mission).",
      );
    }
  }
  // Indice de confiance (NOT-11, confiance.ts) : recalculé par le moteur et enregistré dans
  // cette transaction ; sous le seuil du cabinet, publication refusée (doublé en base, MPN10).
  const confiance = await calculerConfiance(db, notation.mission_id, v.version);
  await enregistrerConfiance(db, auth, v.version.id, confiance);
  if (!confiance.publiable) {
    throw new AppError(
      409,
      "CONFIANCE_INSUFFISANTE",
      `Indice de confiance ${confiance.indice} sous le seuil du cabinet (${confiance.seuil}) : complétez les réponses, les répondants ou les preuves avant de publier.`,
    );
  }
  const apres = await evenement(db, auth, notation, v, "publication", null);
  await brancherQualite(db, auth, notation, apres);
  return apres;
}

/**
 * Données du rapport (NOT-07) d'une version (défaut : dernière publiée, à
 * défaut la dernière) et comparaison (NOT-06/08) avec la notation publiée
 * précédente du même client, parmi les missions visibles.
 */
export async function rapport(db: Db, auth: Auth, notation: Notation, numero?: number) {
  let v: VersionChargee | null;
  if (numero !== undefined) {
    v = await chargerVersion(db, notation.id, numero);
  } else {
    const p = await db.query(
      `SELECT v.numero FROM notation_versions v JOIN notation_evenements e
         ON e.version_id = v.id AND e.action = 'publication'
       WHERE v.notation_id = $1 ORDER BY v.numero DESC LIMIT 1`,
      [notation.id],
    );
    v = await chargerVersion(db, notation.id, p.rows[0]?.numero as number | undefined);
  }
  if (!v) throw introuvable("Version de notation");
  const publieeLe = v.evenements.find((e) => e.action === "publication")?.le ?? null;
  const prec = await db.query(
    `SELECT v.notation_id, v.numero, m.intitule, e.le AS publiee_le
     FROM notation_versions v
     JOIN notations n ON n.id = v.notation_id
     JOIN missions m ON m.id = n.mission_id
     JOIN notation_evenements e ON e.version_id = v.id AND e.action = 'publication'
     WHERE n.client_id = $1 AND n.id <> $2 AND e.le < coalesce($3::timestamptz, now())
       AND ${filtreVisibilite(4, 5)}
     ORDER BY e.le DESC, v.id DESC LIMIT 1`,
    [notation.client_id, notation.id, publieeLe, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  const ligne = prec.rows[0] as
    { notation_id: string; numero: number; intitule: string; publiee_le: Date } | undefined;
  const precedente = ligne ? await chargerVersion(db, ligne.notation_id, ligne.numero) : null;
  return {
    notation_id: notation.id,
    mission_id: notation.mission_id,
    version: {
      numero: v.version.numero,
      statut: v.statut,
      calcule_le: v.version.calcule_le,
      publiee_le: publieeLe,
    },
    donnees: donneesRapport(v.etat),
    comparaison:
      ligne && precedente
        ? {
            precedente: {
              notation_id: ligne.notation_id,
              numero: ligne.numero,
              mission_intitule: ligne.intitule,
              publiee_le: ligne.publiee_le,
              score: precedente.etat.score,
              classe: precedente.etat.classe,
            },
            ...comparerNotations(precedente.etat, v.etat),
          }
        : null,
  };
}
