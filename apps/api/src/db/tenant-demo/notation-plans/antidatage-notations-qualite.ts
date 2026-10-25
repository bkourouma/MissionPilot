import type { SourceInstants } from "./antidatage.js";

/*
 * Sources d'instants du suivi qualité R3 des notations d'une mission (QUA-01 à QUA-06) : suivi,
 * événements, vérifications et attestations, éléments de revue, éléments vus, validations,
 * signatures. Paramètres : $1 = cabinet, $2 = mission. Elles sont fusionnées avec celles de la
 * notation dans UN SEUL appel d'étalement (antidatage-notations-notation.ts) : la soumission, la
 * revue et la signature restent dans l'ordre réel par rapport au calcul et à la publication.
 */

/** Suivi, journal, vérifications, revue, validations, signatures (ordre de tri des égalités). */
export const SOURCES_QUALITE: readonly SourceInstants[] = [
  {
    select: `SELECT s.id, s.ouvert_le AS t FROM qualite_suivis s
              WHERE s.cabinet_id = $1 AND s.mission_id = $2 AND s.type_livrable = 'notation'`,
    update:
      "UPDATE qualite_suivis SET ouvert_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT e.id, e.le AS t FROM qualite_evenements e
               JOIN qualite_suivis s ON s.id = e.suivi_id AND s.cabinet_id = e.cabinet_id
              WHERE e.cabinet_id = $1 AND s.mission_id = $2 AND s.type_livrable = 'notation'`,
    update: "UPDATE qualite_evenements SET le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT x.id, x.cree_le AS t FROM qualite_revue_elements x
               JOIN qualite_suivis s ON s.id = x.suivi_id AND s.cabinet_id = x.cabinet_id
              WHERE x.cabinet_id = $1 AND s.mission_id = $2 AND s.type_livrable = 'notation'`,
    update:
      "UPDATE qualite_revue_elements SET cree_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT x.id, x.le AS t FROM qualite_verifications x
               JOIN qualite_suivis s ON s.id = x.suivi_id AND s.cabinet_id = x.cabinet_id
              WHERE x.cabinet_id = $1 AND s.mission_id = $2 AND s.type_livrable = 'notation'`,
    update:
      "UPDATE qualite_verifications SET le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT x.id, x.vu_le AS t FROM qualite_revue_vus x
               JOIN qualite_suivis s ON s.id = x.suivi_id AND s.cabinet_id = x.cabinet_id
              WHERE x.cabinet_id = $1 AND s.mission_id = $2 AND s.type_livrable = 'notation'`,
    update:
      "UPDATE qualite_revue_vus SET vu_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT x.id, x.valide_le AS t FROM qualite_validations x
               JOIN qualite_suivis s ON s.id = x.suivi_id AND s.cabinet_id = x.cabinet_id
              WHERE x.cabinet_id = $1 AND s.mission_id = $2 AND s.type_livrable = 'notation'`,
    update:
      "UPDATE qualite_validations SET valide_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT x.id, x.signe_le AS t FROM qualite_signatures x
               JOIN qualite_suivis s ON s.id = x.suivi_id AND s.cabinet_id = x.cabinet_id
              WHERE x.cabinet_id = $1 AND s.mission_id = $2 AND s.type_livrable = 'notation'`,
    update:
      "UPDATE qualite_signatures SET signe_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
  {
    select: `SELECT s.id, s.modifie_le AS t FROM qualite_suivis s
              WHERE s.cabinet_id = $1 AND s.mission_id = $2 AND s.type_livrable = 'notation'`,
    update:
      "UPDATE qualite_suivis SET modifie_le = $2::timestamptz WHERE id = $1 AND cabinet_id = $3",
  },
];
