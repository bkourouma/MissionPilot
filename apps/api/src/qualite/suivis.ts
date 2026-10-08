import { rangClasseRisque, type ClasseRisque } from "@missionpilot/engines";
import {
  CLASSE_MINIMALE_PAR_TYPE,
  suiviListeQuerySchema,
  type SuiviOuverture,
  type TypeLivrable,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  exigerMissionModifiable,
  filtreVisibilite,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { lireContenuLivrable } from "./contenu.js";
import { definitionEnVigueur } from "./definitions.js";
import {
  ajouterEvenement,
  COLONNES_SUIVI,
  COLONNES_SUIVI_NUES,
  exigerSuivi,
  type Suivi,
} from "./donnees.js";
import { evaluerSuivi, habilitePour, lireSignature, lireValidations } from "./garde.js";
import { listerElements, parcoursDe, tempsDeRevue } from "./revue.js";
import { etatDefinition } from "./verification.js";

/*
 * Ouverture, liste et détail des suivis qualité. L'ouverture exige la mission modifiable (chef,
 * directeur ou associé ; mission non clôturée) et vérifie que le livrable existe dans la mission
 * quand son type est lisible par le module qualité (rapport, notation, plan, questionnaire).
 */

export async function ouvrirSuivi(db: Db, auth: Auth, corps: SuiviOuverture): Promise<Suivi> {
  await exigerMissionModifiable(db, auth, corps.mission_id);
  const type = corps.type_livrable as TypeLivrable;
  const contenu = await lireContenuLivrable(
    db,
    corps.mission_id,
    type,
    corps.livrable_id,
    corps.version,
  );
  if (!contenu) throw introuvable("Livrable");
  const minimale = CLASSE_MINIMALE_PAR_TYPE[type];
  const classe: ClasseRisque = corps.classe ?? minimale;
  if (rangClasseRisque(classe) < rangClasseRisque(minimale)) {
    throw new AppError(
      409,
      "CLASSE_SOUS_MINIMALE",
      `La classe d'un livrable de ce type ne peut pas être inférieure à ${minimale}.`,
    );
  }
  const auteur = corps.auteur_id !== undefined ? corps.auteur_id : contenu.auteurId;
  const definition = await definitionEnVigueur(db, auth.cabinetId, type);
  const r = await db.query(
    `INSERT INTO qualite_suivis (cabinet_id, mission_id, type_livrable, livrable_id, libelle, version,
       classe_minimale, classe, auteur_id, definition_id, ouvert_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COLONNES_SUIVI_NUES}`,
    [
      auth.cabinetId,
      corps.mission_id,
      type,
      corps.livrable_id,
      corps.libelle,
      corps.version,
      minimale,
      classe,
      auteur,
      definition?.id ?? null,
      auth.utilisateurId,
    ],
  );
  const suivi = r.rows[0] as Suivi;
  await ajouterEvenement(db, auth.cabinetId, suivi.id, auth.utilisateurId, {
    action: "ouverture",
    details: { classe, classe_minimale: minimale },
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.suivi.ouvrir",
    entite: "qualite_suivi",
    entiteId: suivi.id,
    details: { type, livrable_id: corps.livrable_id, version: corps.version, classe },
  });
  return suivi;
}

export async function listerSuivis(
  db: Db,
  auth: Auth,
  requete: z.infer<typeof suiviListeQuerySchema>,
) {
  const q = suiviListeQuerySchema.parse(requete);
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES_SUIVI}, m.intitule AS mission_intitule,
       (SELECT count(*)::int FROM qualite_revue_elements e WHERE e.suivi_id = s.id AND e.obligatoire)
         AS elements_obligatoires,
       (SELECT count(*)::int FROM qualite_revue_elements e
          JOIN qualite_revue_vus v ON v.element_id = e.id AND v.utilisateur_id = $3
        WHERE e.suivi_id = s.id AND e.obligatoire) AS elements_vus_par_moi,
       (SELECT count(*)::int FROM qualite_validations v WHERE v.suivi_id = s.id) AS validations_faites,
       to_char(s.ouvert_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS cle_tri
     FROM qualite_suivis s JOIN missions m ON m.id = s.mission_id
     WHERE ${filtreVisibilite(2, 3)}
       AND ($4::uuid IS NULL OR s.mission_id = $4)
       AND ($5::text IS NULL OR s.statut = $5)
       AND ($6::text IS NULL OR s.type_livrable = $6)
       AND ($7::text IS NULL OR (to_char(s.ouvert_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'), s.id)
            < ($7, $8::uuid))
     ORDER BY cle_tri DESC, s.id DESC LIMIT $1`,
    [
      q.limite + 1,
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      q.mission_id ?? null,
      q.statut ?? null,
      q.type_livrable ?? null,
      apres?.[0] ?? null,
      apres?.[1] ?? null,
    ],
  );
  return paginer(r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[], q.limite);
}

/** Dossier complet d'un suivi : garde évaluée par le moteur, définition, parcours, temps, signature. */
export async function detailSuivi(db: Db, auth: Auth, id: string) {
  const { suivi, mission } = await exigerSuivi(db, auth, id);
  const validations = await lireValidations(db, suivi.id);
  const evaluation = evaluerSuivi(suivi, validations);
  const prochaine = evaluation.prochaineEtape;
  const peutProchaine =
    prochaine !== null &&
    suivi.statut !== "signe" &&
    (await habilitePour(db, auth, mission, prochaine));
  const m = await db.query("SELECT intitule FROM missions WHERE id = $1", [mission.id]);
  const evenements = await db.query(
    `SELECT e.rang, e.action, e.details, e.par, u.nom AS par_nom, e.le
     FROM qualite_evenements e LEFT JOIN utilisateurs u ON u.id = e.par
     WHERE e.suivi_id = $1 ORDER BY e.rang`,
    [suivi.id],
  );
  return {
    suivi,
    mission: { id: mission.id, intitule: m.rows[0].intitule as string },
    garde: {
      classe: evaluation.classe,
      automatique: evaluation.automatique,
      etapes_requises: evaluation.etapesRequises,
      etapes_faites: evaluation.etapesFaites,
      manquantes: evaluation.manquantes,
      prochaine_etape: prochaine,
      violations: evaluation.violations,
      peut_valider_prochaine_etape: peutProchaine,
    },
    validations,
    definition: await etatDefinition(db, suivi),
    elements: await listerElements(db, suivi.id, auth.utilisateurId),
    parcours: await parcoursDe(db, suivi.id, auth.utilisateurId),
    temps_revue: await tempsDeRevue(db, suivi.id),
    signature: await lireSignature(db, suivi.id),
    evenements: evenements.rows,
  };
}
