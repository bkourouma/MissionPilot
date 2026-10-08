import type { ContexteModulation } from "@missionpilot/engines";
import type { ContexteModulationApi } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { exigerMissionModifiable, exigerMissionVisible } from "../missions/acces.js";
import { dernierePubliee, lireContenu, lireVersion, sansIdentifiants } from "./contenu.js";
import { comparerContenus } from "./differences.js";
import {
  appliquer,
  comparerApplications,
  exigerContexteValide,
  lireFacteurs,
  resultatApi,
  type ResultatModulationApi,
} from "./modulation.js";
import {
  resoudreMethode,
  trouverBrique,
  type BriqueEffective,
  type DerogationAppliquee,
  type MethodeEffective,
} from "./resolution.js";
import { origineMethode } from "./types.js";

/*
 * Mission figée sur une version de méthode (STD-08) et méthode effective
 * (ADR-004). Règles d'accès (routes/standard.ts) :
 * - lire : `standard.lire` et mission visible (missions/acces.ts) ;
 * - lier, changer le contexte, migrer : `standard.lire`, `mission.planifier`
 *   et mission MODIFIABLE (directeur, chef, ou « mission.modifier_toutes » ;
 *   mission non clôturée).
 * Chaque événement ajoute une ligne à `mission_methodes` (ajout seul, MPM03)
 * avec le contexte lu et le résultat COMPLET du moteur (journal
 * d'application) ; une évolution du standard ne change jamais la mission
 * sans migration explicite, motivée et tracée.
 */

interface LigneMissionMethode {
  id: string;
  rang: number;
  evenement: "liaison" | "contexte" | "migration";
  methode_version_id: string;
  contexte: ContexteModulationApi;
  resultat: ResultatModulationApi;
  analyse_impact: unknown;
  motif: string | null;
  cree_par: string;
  cree_par_nom: string | null;
  cree_le: string;
}

async function ligneCourante(db: Db, missionId: string): Promise<LigneMissionMethode | null> {
  const r = await db.query(
    `SELECT mm.id, mm.rang, mm.evenement, mm.methode_version_id, mm.contexte, mm.resultat,
            mm.analyse_impact, mm.motif, mm.cree_par, u.nom AS cree_par_nom, mm.cree_le
     FROM mission_methodes mm LEFT JOIN utilisateurs u ON u.id = mm.cree_par
     WHERE mm.mission_id = $1 ORDER BY mm.rang DESC LIMIT 1`,
    [missionId],
  );
  return (r.rows[0] as LigneMissionMethode | undefined) ?? null;
}

/** Ligne sans le résultat ni l'analyse (renvoyés à part ou inutiles à la lecture). */
const sansResultat = ({ resultat: _r, analyse_impact: _a, ...l }: LigneMissionMethode) => l;

async function derogationsApprouvees(db: Db, missionId: string): Promise<DerogationAppliquee[]> {
  const r = await db.query(
    `SELECT id, brique_code, nature, description FROM derogations
     WHERE mission_id = $1 AND statut = 'approuvee' ORDER BY cree_le, id`,
    [missionId],
  );
  return r.rows as DerogationAppliquee[];
}

/**
 * Méthode effective d'une mission (null si aucune méthode liée), SANS contrôle
 * de visibilité : l'appelant a déjà vérifié la mission (exigerMissionVisible).
 * API publique pour les autres lots (agents, qualité, preuves) : voir index.ts.
 */
export async function methodeEffectiveMission(
  db: Db,
  missionId: string,
): Promise<
  | (MethodeEffective & {
      liaison: Omit<LigneMissionMethode, "resultat" | "analyse_impact">;
      version: {
        id: string;
        version: number;
        methode_id: string;
        methode_code: string;
        methode_libelle: string;
        origine: string;
      };
      modulation: ResultatModulationApi;
      derogations: DerogationAppliquee[];
    })
  | null
> {
  const ligne = await ligneCourante(db, missionId);
  if (!ligne) return null;
  const contenu = await lireContenu(db, ligne.methode_version_id);
  const derogations = await derogationsApprouvees(db, missionId);
  const { resultat } = ligne;
  const liaison = sansResultat(ligne);
  return {
    ...resoudreMethode(sansIdentifiants(contenu), resultat, derogations),
    liaison,
    version: {
      id: contenu.version.id,
      version: contenu.version.version,
      methode_id: contenu.methode.id,
      methode_code: contenu.methode.code,
      methode_libelle: contenu.methode.libelle,
      origine: origineMethode(contenu.methode),
    },
    modulation: resultat,
    derogations,
  };
}

/** Brique effective d'une mission par code (null si pas de méthode ou brique inconnue). */
export async function briqueEffectiveMission(
  db: Db,
  missionId: string,
  briqueCode: string,
): Promise<BriqueEffective | null> {
  const m = await methodeEffectiveMission(db, missionId);
  return m ? trouverBrique(m, briqueCode) : null;
}

export async function lireMethodeMission(db: Db, auth: Auth, missionId: string) {
  await exigerMissionVisible(db, auth, missionId);
  const effective = await methodeEffectiveMission(db, missionId);
  if (!effective) return { liaison: null };
  const historique = await db.query(
    `SELECT mm.id, mm.rang, mm.evenement, mm.methode_version_id, v.version, mm.motif, mm.cree_le,
            u.nom AS cree_par_nom, mm.contexte
     FROM mission_methodes mm JOIN methode_versions v ON v.id = mm.methode_version_id
     LEFT JOIN utilisateurs u ON u.id = mm.cree_par
     WHERE mm.mission_id = $1 ORDER BY mm.rang DESC`,
    [missionId],
  );
  const derniere = await dernierePubliee(db, effective.version.methode_id);
  return {
    ...effective,
    historique: historique.rows,
    mise_a_jour:
      derniere && derniere.version > effective.version.version
        ? { id: derniere.id, version: derniere.version, notes_version: derniere.notes_version }
        : null,
  };
}

async function inserer(
  db: Db,
  auth: Auth,
  missionId: string,
  ligne: {
    evenement: LigneMissionMethode["evenement"];
    versionId: string;
    contexte: ContexteModulationApi;
    resultat: ResultatModulationApi;
    analyse?: unknown;
    motif?: string | null;
  },
) {
  const r = await db.query(
    `INSERT INTO mission_methodes (cabinet_id, mission_id, rang, evenement, methode_version_id,
       contexte, resultat, analyse_impact, motif, cree_par)
     VALUES ($1, $2, (SELECT coalesce(max(rang), 0) + 1 FROM mission_methodes WHERE mission_id = $2),
       $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, rang`,
    [
      auth.cabinetId,
      missionId,
      ligne.evenement,
      ligne.versionId,
      JSON.stringify(ligne.contexte),
      JSON.stringify(ligne.resultat),
      ligne.analyse === undefined ? null : JSON.stringify(ligne.analyse),
      ligne.motif ?? null,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: `mission.methode.${ligne.evenement}`,
    entite: "mission",
    entiteId: missionId,
    details: {
      mission_methode_id: r.rows[0].id,
      rang: r.rows[0].rang,
      methode_version_id: ligne.versionId,
      regles_declenchees: ligne.resultat.regles_declenchees,
    },
  });
}

/** Lie une mission (sans méthode) à une version publiée, avec son contexte. */
export async function lierMethode(
  db: Db,
  auth: Auth,
  missionId: string,
  versionId: string,
  contexte: ContexteModulationApi,
) {
  await exigerMissionModifiable(db, auth, missionId);
  if (await ligneCourante(db, missionId)) {
    throw new AppError(
      409,
      "METHODE_DEJA_LIEE",
      "La mission a déjà une méthode : la migrer ou changer son contexte.",
    );
  }
  const v = await lireVersion(db, versionId);
  if (v.statut !== "publiee") throw conflit("Seule une version publiée se lie à une mission.");
  const ctx = exigerContexteValide(await lireFacteurs(db), contexte);
  const contenu = sansIdentifiants(await lireContenu(db, versionId));
  await inserer(db, auth, missionId, {
    evenement: "liaison",
    versionId,
    contexte,
    resultat: resultatApi(appliquer(contenu, ctx)),
  });
  return lireMethodeMission(db, auth, missionId);
}

async function exigerLiaison(db: Db, missionId: string): Promise<LigneMissionMethode> {
  const ligne = await ligneCourante(db, missionId);
  if (!ligne) throw introuvable("Méthode de la mission");
  return ligne;
}

/** Nouveau contexte sur la même version : règles réappliquées et journalisées. */
export async function changerContexte(
  db: Db,
  auth: Auth,
  missionId: string,
  contexte: ContexteModulationApi,
  motif: string | null | undefined,
) {
  await exigerMissionModifiable(db, auth, missionId);
  const ligne = await exigerLiaison(db, missionId);
  const ctx = exigerContexteValide(await lireFacteurs(db), contexte);
  const contenu = sansIdentifiants(await lireContenu(db, ligne.methode_version_id));
  await inserer(db, auth, missionId, {
    evenement: "contexte",
    versionId: ligne.methode_version_id,
    contexte,
    resultat: resultatApi(appliquer(contenu, ctx)),
    motif: motif ?? null,
  });
  return lireMethodeMission(db, auth, missionId);
}

/**
 * Analyse d'impact d'une migration (STD-08) : différences de contenu, effet
 * des règles sur le contexte de la mission, contexte devenu invalide,
 * dérogations sans objet. N'écrit rien.
 */
async function analyser(db: Db, missionId: string, versionCibleId: string) {
  const ligne = await exigerLiaison(db, missionId);
  const actuelle = await lireContenu(db, ligne.methode_version_id);
  const cible = await lireContenu(db, versionCibleId);
  if (
    cible.version.statut !== "publiee" ||
    cible.methode.id !== actuelle.methode.id ||
    cible.version.version <= actuelle.version.version
  ) {
    throw new AppError(
      409,
      "VERSION_NON_LIABLE",
      "Migration vers une version publiée plus récente de la même méthode seulement.",
    );
  }
  const facteurs = await lireFacteurs(db);
  const ctx = exigerContexteValide(facteurs, ligne.contexte);
  const a = sansIdentifiants(actuelle);
  const b = sansIdentifiants(cible);
  const briquesCible = new Set(b.briques.map((x) => x.code));
  const derogations = await derogationsApprouvees(db, missionId);
  return {
    ligne,
    ctx,
    cible: b,
    analyse: {
      version_actuelle: { id: actuelle.version.id, version: actuelle.version.version },
      version_cible: {
        id: cible.version.id,
        version: cible.version.version,
        notes_version: cible.version.notes_version,
      },
      differences: comparerContenus(a, b),
      modulation: comparerApplications(a, b, ctx as ContexteModulation).differentiel,
      derogations_sans_objet: derogations.filter((d) => !briquesCible.has(d.brique_code)),
    },
  };
}

export async function analyserMigration(db: Db, auth: Auth, missionId: string, versionId: string) {
  await exigerMissionVisible(db, auth, missionId);
  return (await analyser(db, missionId, versionId)).analyse;
}

export async function migrerMethode(
  db: Db,
  auth: Auth,
  missionId: string,
  versionId: string,
  motif: string,
) {
  await exigerMissionModifiable(db, auth, missionId);
  const { ligne, ctx, cible, analyse } = await analyser(db, missionId, versionId);
  await inserer(db, auth, missionId, {
    evenement: "migration",
    versionId,
    contexte: ligne.contexte,
    resultat: resultatApi(appliquer(cible, ctx)),
    analyse,
    motif,
  });
  return lireMethodeMission(db, auth, missionId);
}
