import {
  formaterPointsDeBase,
  syntheseChaineDeValeur,
  type EtapeChaineEntree,
} from "@missionpilot/engines";
import {
  PLAFONDS_DD,
  type etapeChaineCreationSchema,
  type etapeChaineVersionSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import {
  exigerPlafondElements,
  exigerVersionCourante,
  exigerVersionsRestantes,
  type ElementLu,
} from "./acces.js";
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
import { chargerRegistre, lectureDe } from "./registre.js";
import { vueSyntheseChaine } from "./vues.js";

/*
 * Chaîne de valeur (DD-04, SPEC-3b §8.2, R10 à R12) : étapes ordonnées, acteurs, parts de coût et de
 * marge en points de base, contraintes. La synthèse (cohérence des parts, rang de marge) sort du
 * moteur ; les parts affichées sont formatées par `formaterPointsDeBase`. Un clic sur une étape
 * affiche ses risques : ils sont servis avec l'étape.
 */

export type CorpsEtape = z.infer<typeof etapeChaineCreationSchema>;
export type CorpsEtapeVersion = z.infer<typeof etapeChaineVersionSchema>;

export async function creerEtape(
  db: Db,
  auth: Auth,
  dossierId: string,
  c: CorpsEtape,
): Promise<{ id: string; version: 1 }> {
  await exigerPlafondElements(
    db,
    dossierId,
    "etape_chaine",
    PLAFONDS_DD.etapes_par_dossier,
    "étapes de la chaîne de valeur par dossier",
  );
  const id = await insererElement(db, auth, { dossierId, type: "etape_chaine" });
  await insererVersionElement(
    db,
    auth,
    { id, type: "etape_chaine" },
    1,
    {
      ...CHAMPS_VIDES,
      libelle: c.libelle,
      description: c.description,
      ordre: c.ordre,
      part_cout_bp: c.part_cout_bp,
      part_marge_bp: c.part_marge_bp,
      acteurs: c.acteurs,
      contraintes: c.contraintes,
    },
    null,
  );
  return { id, version: 1 };
}

export async function corrigerEtape(
  db: Db,
  auth: Auth,
  element: ElementLu,
  c: CorpsEtapeVersion,
): Promise<number> {
  const courant = await elementCourant(db, element.id);
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  const suivant = fusionner(champsDe(courant), {
    libelle: c.libelle,
    description: c.description,
    ordre: c.ordre,
    part_cout_bp: c.part_cout_bp,
    part_marge_bp: c.part_marge_bp,
    acteurs: c.acteurs,
    contraintes: c.contraintes,
    retire: c.retire,
  });
  await insererVersionElement(db, auth, courant, courant.version + 1, suivant, c.motif);
  return courant.version + 1;
}

export function entreesChaine(etapes: readonly ElementCourant[]): EtapeChaineEntree[] {
  return etapes.map((e) => ({
    id: e.id,
    ordre: e.ordre as number,
    partCoutBp: e.part_cout_bp,
    partMargeBp: e.part_marge_bp,
  }));
}

const affichee = (bp: number | null) => (bp === null ? null : formaterPointsDeBase(bp));

/** R10 : étapes courantes (retirées exclues) avec leurs risques, et synthèse du moteur. */
export async function lireChaine(db: Db, missionId: string, dossierId: string) {
  const etapes = await elementsCourants(
    db,
    dossierId,
    "etape_chaine",
    PLAFONDS_DD.etapes_par_dossier,
  );
  const risques = await elementsCourants(db, dossierId, "risque", PLAFONDS_DD.risques_par_dossier);
  const reg = await chargerRegistre(
    db,
    missionId,
    risques.map((r) => r.assertion_id as string),
  );
  const synthese = syntheseChaineDeValeur(entreesChaine(etapes));
  const rangs = new Map(synthese.etapes.map((e) => [e.id, e.rangMarge]));
  const ordonnees = [...etapes].sort(
    (a, b) => (a.ordre as number) - (b.ordre as number) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return {
    etapes: ordonnees.map((e) => ({
      id: e.id,
      version: e.version,
      libelle: e.libelle,
      description: e.description,
      ordre: e.ordre,
      part_cout_bp: e.part_cout_bp,
      part_marge_bp: e.part_marge_bp,
      part_cout_affichee: affichee(e.part_cout_bp),
      part_marge_affichee: affichee(e.part_marge_bp),
      acteurs: e.acteurs,
      contraintes: e.contraintes,
      rang_marge: rangs.get(e.id) ?? null,
      risques: risques
        .filter((r) => r.etape_id === e.id)
        .map((r) => ({
          id: r.id,
          libelle: r.libelle,
          famille: r.categorie,
          niveau: r.niveau,
          lecture: lectureDe(reg, r.assertion_id as string),
        })),
    })),
    synthese: vueSyntheseChaine(synthese),
  };
}
