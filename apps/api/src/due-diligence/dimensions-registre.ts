import {
  ANALYSE_DD_LIBELLES,
  ANALYSES_DD,
  CATEGORIE_ANALYSE_DD_LIBELLES,
  CATEGORIES_ANALYSE_DD,
  DIMENSIONS_MISSION_MAX,
  FAMILLE_RISQUE_DD_LIBELLES,
  FAMILLES_RISQUE_DD,
  type AnalyseDd,
  type FamilleRisqueDd,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";

/*
 * Dimensions du registre des preuves propres à la due diligence (SPEC-3b §2.1) : une par catégorie
 * d'analyse (`dd.<analyse>.<categorie>`, 18) et une par famille de risque (`dd.risque.<famille>`,
 * 4), soit 22 sur le plafond de 100 d'une mission. Elles donnent gratuitement la carte de
 * triangulation (PRV-05) à un dossier. Création idempotente et partagée par les dossiers d'une
 * même mission : `ON CONFLICT … DO NOTHING` ; une dimension désactivée par l'équipe (PATCH du
 * registre) n'est PAS réactivée : les points de cette catégorie sont alors refusés (400
 * DIMENSION_INCONNUE) tant qu'elle n'est pas réactivée par le registre.
 */

export function codeDimensionAnalyse(analyse: AnalyseDd, categorie: string): string {
  return `dd.${analyse}.${categorie}`;
}

export function codeDimensionRisque(famille: FamilleRisqueDd): string {
  return `dd.risque.${famille}`;
}

interface DimensionDd {
  code: string;
  libelle: string;
}

/** Les 22 dimensions du lot, dans un ordre stable. */
export function dimensionsDd(): DimensionDd[] {
  const analyses = ANALYSES_DD.flatMap((analyse) =>
    (CATEGORIES_ANALYSE_DD[analyse] as readonly string[]).map((categorie) => ({
      code: codeDimensionAnalyse(analyse, categorie),
      libelle: `Due diligence — ${ANALYSE_DD_LIBELLES[analyse]} — ${
        CATEGORIE_ANALYSE_DD_LIBELLES[categorie as keyof typeof CATEGORIE_ANALYSE_DD_LIBELLES]
      }`,
    })),
  );
  const risques = FAMILLES_RISQUE_DD.map((famille) => ({
    code: codeDimensionRisque(famille),
    libelle: `Due diligence — ${FAMILLE_RISQUE_DD_LIBELLES[famille]}`,
  }));
  return [...analyses, ...risques];
}

/**
 * Crée (ou réactive) les dimensions manquantes de la mission. À appeler dans la transaction d'une
 * écriture, mission verrouillée. 409 PLAFOND_ATTEINT si elles feraient dépasser le plafond.
 */
export async function assurerDimensionsDd(db: Db, auth: Auth, missionId: string): Promise<void> {
  const existantes = await db.query(
    "SELECT code, actif FROM preuve_dimensions WHERE mission_id = $1",
    [missionId],
  );
  const parCode = new Map(existantes.rows.map((l) => [l.code as string, l.actif as boolean]));
  // Une dimension DÉSACTIVÉE par l'équipe le reste : on ne crée que les dimensions absentes.
  const aCreerOuReactiver = dimensionsDd().filter((d) => !parCode.has(d.code));
  if (aCreerOuReactiver.length === 0) return;
  const nouvelles = aCreerOuReactiver.length;
  if (parCode.size + nouvelles > DIMENSIONS_MISSION_MAX) {
    throw new AppError(
      409,
      "PLAFOND_ATTEINT",
      "Trop de dimensions pour cette mission : la due diligence en exige 22.",
    );
  }
  await db.query(
    `INSERT INTO preuve_dimensions (cabinet_id, mission_id, code, libelle, cree_par)
     SELECT $1, $2, t.code, t.libelle, $3 FROM unnest($4::text[], $5::text[]) AS t(code, libelle)
     ON CONFLICT (cabinet_id, mission_id, code) DO NOTHING`,
    [
      auth.cabinetId,
      missionId,
      auth.utilisateurId,
      aCreerOuReactiver.map((d) => d.code),
      aCreerOuReactiver.map((d) => d.libelle),
    ],
  );
}
