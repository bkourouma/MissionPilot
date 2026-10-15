import { randomUUID } from "node:crypto";
import {
  syntheseRisquesDd,
  type FamilleRisqueDd,
  type NiveauRisqueDd,
  type RisqueEntree,
} from "@missionpilot/engines";
import {
  PLAFONDS_DD,
  type risqueCreationSchema,
  type risqueVersionSchema,
  type risquesQuerySchema,
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
import { ecrireAjustement } from "./ajustements.js";
import { assertionCitee, verdictRetenuCitant } from "./hypotheses.js";
import { assurerDimensionsDd } from "./dimensions-registre.js";
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
  lectureDe,
  soliditeDe,
  type RegistreDossier,
} from "./registre.js";
import { vueSyntheseRisques } from "./vues.js";

/*
 * Checklist de risques par famille (DD-06, SPEC-3b §8.2, R13 à R15). Une justification de risque
 * est une assertion du registre (rattachement `risque`, code = identifiant de l'élément, tiré côté
 * serveur AVANT l'assertion). Le niveau est choisi par l'expert ; s'il diffère de la gravité
 * indicative du signal d'origine, un motif d'écart est exigé et un AJUSTEMENT est tracé (DD-08).
 */

export type CorpsRisque = z.infer<typeof risqueCreationSchema>;
export type CorpsRisqueVersion = z.infer<typeof risqueVersionSchema>;
export type FiltresRisques = z.infer<typeof risquesQuerySchema>;

export function risqueToucheLeRegistre(c: CorpsRisqueVersion): boolean {
  return (
    c.enonce !== undefined ||
    c.classe_risque !== undefined ||
    c.avis_expert !== undefined ||
    c.avis_expert_motif !== undefined ||
    c.signer_avis !== undefined ||
    c.retire !== undefined
  );
}

function motifEcartRequis(): AppError {
  return new AppError(
    400,
    "MOTIF_ECART_REQUIS",
    "Un niveau différent de la gravité indicative du signal exige un motif d'écart (10 caractères au moins).",
  );
}

/** Gravité indicative de la version courante d'un signal de la bibliothèque, ou null. */
async function graviteDuSignal(db: Db, signalId: string): Promise<NiveauRisqueDd | null> {
  const r = await db.query(
    `SELECT gravite_indicative FROM dd_signal_versions WHERE signal_id = $1
     ORDER BY version DESC LIMIT 1`,
    [signalId],
  );
  return (r.rows[0]?.gravite_indicative as NiveauRisqueDd | undefined) ?? null;
}

async function exigerEtapeDuDossier(db: Db, dossierId: string, etapeId: string): Promise<void> {
  const r = await db.query(
    `SELECT 1 FROM dd_elements WHERE id = $1 AND dossier_id = $2 AND type = 'etape_chaine'`,
    [etapeId, dossierId],
  );
  if (!r.rows[0]) {
    throw new AppError(400, "LIEN_INCOHERENT", "L'étape désignée n'appartient pas à ce dossier.");
  }
}

async function exigerSignalConnu(db: Db, signalId: string): Promise<NiveauRisqueDd> {
  const gravite = await graviteDuSignal(db, signalId);
  if (gravite === null) {
    throw new AppError(400, "LIEN_INCOHERENT", "Le signal désigné est inconnu de la bibliothèque.");
  }
  return gravite;
}

export async function creerRisque(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  dossierId: string,
  c: CorpsRisque,
): Promise<{ id: string; assertion_id: string; version: 1 }> {
  await exigerPlafondElements(
    db,
    dossierId,
    "risque",
    PLAFONDS_DD.risques_par_dossier,
    "risques par dossier",
  );
  if (c.etape_id !== null) await exigerEtapeDuDossier(db, dossierId, c.etape_id);
  const gravite = c.signal_id === null ? null : await exigerSignalConnu(db, c.signal_id);
  const ecart = gravite !== null && gravite !== c.niveau;
  const motifEcart = c.motif_ecart?.trim() ?? "";
  if (ecart && motifEcart.length < 10) throw motifEcartRequis();
  await assurerDimensionsDd(db, auth, mission.id);
  const elementId = randomUUID();
  const assertionId = await creerAffirmation(db, auth, mission, c, {
    type: "risque",
    code: elementId,
  });
  await insererElement(db, auth, {
    id: elementId,
    dossierId,
    type: "risque",
    assertionId,
  });
  await insererVersionElement(
    db,
    auth,
    { id: elementId, type: "risque" },
    1,
    {
      ...CHAMPS_VIDES,
      categorie: c.famille,
      niveau: c.niveau,
      libelle: c.libelle,
      etape_id: c.etape_id,
      signal_id: c.signal_id,
    },
    null,
  );
  if (ecart && gravite !== null) {
    await ecrireAjustement(db, auth, {
      dossierId,
      cibleType: "risque",
      cibleId: elementId,
      champ: "niveau",
      avant: gravite,
      apres: c.niveau,
      motif: motifEcart,
    });
  }
  return { id: elementId, assertion_id: assertionId, version: 1 };
}

export async function corrigerRisque(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  element: ElementLu,
  c: CorpsRisqueVersion,
): Promise<{ version: number; assertion_version: number | null }> {
  const courant = await elementCourant(db, element.id);
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  const suivant = fusionner(champsDe(courant), {
    categorie: c.famille,
    niveau: c.niveau,
    libelle: c.libelle,
    etape_id: c.etape_id,
    signal_id: c.signal_id,
    retire: c.retire,
  });
  if (suivant.etape_id !== null && suivant.etape_id !== courant.etape_id) {
    await exigerEtapeDuDossier(db, courant.dossier_id, suivant.etape_id);
  }
  const gravite =
    suivant.signal_id === null ? null : await exigerSignalConnu(db, suivant.signal_id);
  const decisionDeNiveau =
    suivant.niveau !== courant.niveau || suivant.signal_id !== courant.signal_id;
  const ecart = decisionDeNiveau && gravite !== null && gravite !== suivant.niveau;
  const motifEcart = c.motif_ecart?.trim() ?? "";
  if (ecart && motifEcart.length < 10) throw motifEcartRequis();
  let versionAssertion: number | null = null;
  if (risqueToucheLeRegistre(c)) {
    if (
      suivant.retire &&
      !courant.retire &&
      (await verdictRetenuCitant(db, courant.assertion_id as string, null))
    ) {
      throw assertionCitee();
    }
    const a = await lireAssertion(db, courant.assertion_id as string);
    if (!a) throw new AppError(409, "CONFLIT", "L'assertion du risque est introuvable.");
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
        rattachement: { type: "risque", code: courant.id },
        motif: c.motif,
      },
    );
  }
  await insererVersionElement(db, auth, courant, courant.version + 1, suivant, c.motif);
  if (ecart && gravite !== null) {
    await ecrireAjustement(db, auth, {
      dossierId: courant.dossier_id,
      cibleType: "risque",
      cibleId: courant.id,
      champ: "niveau",
      avant: gravite,
      apres: suivant.niveau as string,
      motif: motifEcart,
    });
  }
  return { version: courant.version + 1, assertion_version: versionAssertion };
}

/** Entrées du moteur de synthèse : lecture de l'assertion de justification (`null` si non évaluée). */
export function entreesRisques(
  risques: readonly ElementCourant[],
  reg: RegistreDossier,
): RisqueEntree[] {
  return risques.map((r) => ({
    id: r.id,
    famille: r.categorie as FamilleRisqueDd,
    niveau: r.niveau as NiveauRisqueDd,
    etapeId: r.etape_id,
    lecture: lectureDe(reg, r.assertion_id as string),
  }));
}

export function vueRisque(r: ElementCourant, reg: RegistreDossier) {
  const assertion = reg.assertions.get(r.assertion_id as string);
  return {
    id: r.id,
    assertion_id: r.assertion_id as string,
    version: r.version,
    libelle: r.libelle,
    famille: r.categorie,
    niveau: r.niveau,
    etape_id: r.etape_id,
    signal_id: r.signal_id,
    enonce: assertion?.enonce ?? "",
    solidite: soliditeDe(reg, r.assertion_id as string),
    a_arbitrer: reg.etat.evaluations.get(r.assertion_id as string)?.a_arbitrer.length ?? 0,
  };
}

/** R13 : risques courants (filtrables) et synthèse du moteur sur l'ensemble des risques. */
export async function lireRisques(
  db: Db,
  missionId: string,
  dossierId: string,
  filtres: FiltresRisques,
) {
  const tous = await elementsCourants(db, dossierId, "risque", PLAFONDS_DD.risques_par_dossier);
  const reg = await chargerRegistre(
    db,
    missionId,
    tous.map((r) => r.assertion_id as string),
  );
  const retenus = tous.filter(
    (r) =>
      (filtres.famille === undefined || r.categorie === filtres.famille) &&
      (filtres.etape_id === undefined || r.etape_id === filtres.etape_id) &&
      (filtres.niveau === undefined || r.niveau === filtres.niveau),
  );
  return {
    risques: retenus.map((r) => vueRisque(r, reg)),
    synthese: vueSyntheseRisques(syntheseRisquesDd(entreesRisques(tous, reg))),
  };
}
