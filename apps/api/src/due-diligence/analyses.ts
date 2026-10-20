import {
  ANALYSES_DD,
  CATEGORIES_ANALYSE_DD,
  estCategorieAnalyseDd,
  PLAFONDS_DD,
  type AnalyseDd,
  type pointCreationSchema,
  type pointVersionSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import { lireAssertion } from "../preuves/donnees.js";
import {
  exigerPlafondElements,
  exigerVersionCourante,
  exigerVersionsRestantes,
  type ElementLu,
} from "./acces.js";
import { assertionCitee, verdictRetenuCitant } from "./hypotheses.js";
import { assurerDimensionsDd, codeDimensionAnalyse } from "./dimensions-registre.js";
import {
  CHAMPS_VIDES,
  champsDe,
  elementCourant,
  elementsCourants,
  fusionner,
  insererElement,
  insererVersionElement,
  type ElementCourant,
} from "./elements.js";
import {
  chargerRegistre,
  corrigerAffirmation,
  creerAffirmation,
  soliditeDe,
  type RegistreDossier,
} from "./registre.js";

/*
 * Analyses PESTEL, cinq forces, SWOT et opérationnelle (DD-03, DD-05, SPEC-3b §8.2, R07 à R09).
 * Un point est une affirmation sourcée : une assertion du registre des preuves (rattachement
 * `dimension` = `dd.<analyse>.<categorie>`) plus un élément `point_analyse` versionné. Le texte de
 * l'affirmation vit dans `assertion_versions.enonce`, la solidité sort du moteur des preuves.
 */

export type CorpsPoint = z.infer<typeof pointCreationSchema>;
export type CorpsPointVersion = z.infer<typeof pointVersionSchema>;

/** Champs du corps qui écrivent une version d'assertion (donc exigent `preuve.ecrire`). */
export function pointToucheLeRegistre(c: CorpsPointVersion): boolean {
  return (
    c.enonce !== undefined ||
    c.classe_risque !== undefined ||
    c.avis_expert !== undefined ||
    c.avis_expert_motif !== undefined ||
    c.signer_avis !== undefined ||
    c.retire !== undefined ||
    c.categorie !== undefined
  );
}

export async function creerPoint(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  dossierId: string,
  c: CorpsPoint,
): Promise<{ id: string; assertion_id: string; version: 1 }> {
  await exigerPlafondElements(
    db,
    dossierId,
    "point_analyse",
    PLAFONDS_DD.points_par_dossier,
    "points d'analyse par dossier",
  );
  await assurerDimensionsDd(db, auth, mission.id);
  const assertionId = await creerAffirmation(db, auth, mission, c, {
    type: "dimension",
    code: codeDimensionAnalyse(c.analyse, c.categorie),
  });
  const id = await insererElement(db, auth, {
    dossierId,
    type: "point_analyse",
    analyse: c.analyse,
    assertionId,
  });
  await insererVersionElement(
    db,
    auth,
    { id, type: "point_analyse" },
    1,
    { ...CHAMPS_VIDES, categorie: c.categorie, libelle: c.libelle, niveau: c.niveau },
    null,
  );
  return { id, assertion_id: assertionId, version: 1 };
}

export async function corrigerPoint(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  element: ElementLu,
  c: CorpsPointVersion,
): Promise<{ version: number; assertion_version: number | null }> {
  const courant = await elementCourant(db, element.id);
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  const analyse = courant.analyse as AnalyseDd;
  if (c.categorie !== undefined && !estCategorieAnalyseDd(analyse, c.categorie)) {
    throw requeteInvalide("Catégorie inconnue pour cette analyse.");
  }
  const suivant = fusionner(champsDe(courant), {
    categorie: c.categorie,
    libelle: c.libelle,
    niveau: c.niveau,
    retire: c.retire,
  });
  let versionAssertion: number | null = null;
  const touche =
    c.enonce !== undefined ||
    c.classe_risque !== undefined ||
    c.avis_expert !== undefined ||
    c.avis_expert_motif !== undefined ||
    c.signer_avis !== undefined ||
    suivant.retire !== courant.retire ||
    suivant.categorie !== courant.categorie;
  if (touche) {
    if (
      suivant.retire &&
      !courant.retire &&
      (await verdictRetenuCitant(db, courant.assertion_id as string, null))
    ) {
      throw assertionCitee();
    }
    const a = await lireAssertion(db, courant.assertion_id as string);
    if (!a) throw new AppError(409, "CONFLIT", "L'assertion du point est introuvable.");
    const avisExpert = c.avis_expert ?? a.avis_expert;
    const motifAvis = c.avis_expert_motif !== undefined ? c.avis_expert_motif : a.avis_expert_motif;
    if (avisExpert && motifAvis == null) throw requeteInvalide("Un avis d'expert se justifie.");
    await assurerDimensionsDd(db, auth, mission.id);
    versionAssertion = await corrigerAffirmation(
      db,
      auth,
      {
        id: a.id,
        mission_id: a.mission_id,
        version: a.version,
        rattachement_type: a.rattachement_type,
        rattachement_code: a.rattachement_code,
        classe_risque: a.classe_risque,
      },
      {
        enonce: c.enonce ?? a.enonce,
        classe_risque: (c.classe_risque ?? a.classe_risque) as "R2" | "R3",
        avis_expert: avisExpert,
        avis_expert_motif: avisExpert ? (motifAvis ?? null) : null,
        signer_avis: c.signer_avis ?? false,
        statut: suivant.retire ? "abandonnee" : "retenue",
        rattachement: {
          type: "dimension",
          code: codeDimensionAnalyse(analyse, suivant.categorie as string),
        },
        motif: c.motif,
      },
    );
  }
  await insererVersionElement(db, auth, courant, courant.version + 1, suivant, c.motif);
  return { version: courant.version + 1, assertion_version: versionAssertion };
}

export interface PointVu {
  id: string;
  assertion_id: string;
  version: number;
  libelle: string | null;
  enonce: string;
  niveau: string | null;
  avis_expert: boolean;
  solidite: ReturnType<typeof soliditeDe>;
  nb_pour: number;
  nb_contre: number;
  a_arbitrer: number;
}

export function vuePoint(p: ElementCourant, reg: RegistreDossier): PointVu {
  const assertion = reg.assertions.get(p.assertion_id as string);
  const solidite = soliditeDe(reg, p.assertion_id as string);
  return {
    id: p.id,
    assertion_id: p.assertion_id as string,
    version: p.version,
    libelle: p.libelle,
    enonce: assertion?.enonce ?? "",
    niveau: p.niveau,
    avis_expert: assertion?.avis_expert ?? false,
    solidite,
    nb_pour: solidite?.preuves_pour ?? 0,
    nb_contre: solidite?.preuves_contre ?? 0,
    a_arbitrer: reg.etat.evaluations.get(p.assertion_id as string)?.a_arbitrer.length ?? 0,
  };
}

/** R07 : analyses, catégories et points courants (retirés exclus) avec leur solidité. */
export async function lireAnalyses(
  db: Db,
  missionId: string,
  dossierId: string,
  filtre: AnalyseDd | undefined,
) {
  const points = await elementsCourants(
    db,
    dossierId,
    "point_analyse",
    PLAFONDS_DD.points_par_dossier,
  );
  const reg = await chargerRegistre(
    db,
    missionId,
    points.map((p) => p.assertion_id as string),
  );
  const couverture = { points: 0, solides: 0, etayes: 0, fragiles: 0 };
  const analyses = ANALYSES_DD.filter((a) => filtre === undefined || a === filtre).map(
    (analyse) => ({
      analyse,
      categories: (CATEGORIES_ANALYSE_DD[analyse] as readonly string[]).map((categorie) => ({
        categorie,
        points: points
          .filter((p) => p.analyse === analyse && p.categorie === categorie)
          .map((p) => {
            const vue = vuePoint(p, reg);
            couverture.points += 1;
            if (vue.solidite?.lecture === "solide") couverture.solides += 1;
            else if (vue.solidite?.lecture === "etayee") couverture.etayes += 1;
            else couverture.fragiles += 1;
            return vue;
          }),
      })),
    }),
  );
  return { analyses, couverture };
}
