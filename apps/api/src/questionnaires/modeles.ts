import { exigerDefinitionValide, type DefinitionQuestionnaire } from "@missionpilot/engines";
import {
  QUESTIONNAIRE_NOTATION_GENERIQUE,
  QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS,
  type DefinitionQuestionnaireDonnees,
  type GabaritQuestionnaire,
  type ModeleQuestionnaireCreation,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { conflit, introuvable } from "../errors.js";
import { paginer } from "../http/outils.js";
import { inscrireModificationIa, lireOrigineIa, validerContenuIa } from "./ia-historique.js";

/*
 * Modèles de questionnaires du cabinet (SOC-10) : code stable, versions
 * (un brouillon au plus, puis validées et figées, migration 0140). La
 * définition est contrôlée par le moteur (`exigerDefinitionValide`) à chaque
 * enregistrement ; son identifiant et son numéro de version sont posés par le
 * serveur (code du modèle, numéro de la version).
 */

export const GABARITS: Record<GabaritQuestionnaire, DefinitionQuestionnaireDonnees> = {
  notation_generique: QUESTIONNAIRE_NOTATION_GENERIQUE,
  preliminaire_dirigeants: QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS,
};

/** Définition normalisée (code et version du serveur) et validée par le moteur. */
export function normaliserDefinition(
  definition: DefinitionQuestionnaireDonnees | DefinitionQuestionnaire,
  code: string,
  version: number,
): DefinitionQuestionnaire {
  const def = { ...definition, id: code, version } as DefinitionQuestionnaire;
  exigerDefinitionValide(def);
  return def;
}

export const COLONNES_VERSION = `v.id, v.modele_id, v.version, v.statut, v.cree_le, v.modifie_le,
  v.valide_le, v.cree_par, v.valide_par`;

interface VersionLue {
  id: string;
  modele_id: string;
  version: number;
  statut: "brouillon" | "valide";
  definition: DefinitionQuestionnaire;
}

async function derniereVersion(db: Db, modeleId: string): Promise<VersionLue | undefined> {
  const r = await db.query(
    `SELECT id, modele_id, version, statut, definition FROM questionnaire_versions
     WHERE modele_id = $1 ORDER BY version DESC LIMIT 1`,
    [modeleId],
  );
  return r.rows[0] as VersionLue | undefined;
}

async function definitionSource(
  db: Db,
  source: ModeleQuestionnaireCreation["source"],
): Promise<{
  definition: DefinitionQuestionnaireDonnees | DefinitionQuestionnaire;
  origine: string;
}> {
  if (source.type === "definition") return { definition: source.definition, origine: "cabinet" };
  if (source.type === "gabarit")
    return { definition: GABARITS[source.gabarit], origine: "gabarit" };
  const v = await derniereVersion(db, source.modele_id);
  if (!v) throw introuvable("Modèle de questionnaire");
  // Circuit SOC-11 : la copie d'un contenu proposé par l'IA, non encore validé par un consultant,
  // serait une version sans historique IA (donc sans validation exigée, MPQ08) : refusée.
  const ia = await lireOrigineIa(db, v.id);
  if (ia && ia.statut_contenu !== "valide") {
    throw conflit(
      "La dernière version de ce modèle est un contenu proposé par l'IA, non validé : validez-la avant d'en faire une copie.",
    );
  }
  return { definition: v.definition, origine: "copie" };
}

/** Crée un modèle et sa version 1 en brouillon. */
export async function creerModele(db: Db, auth: Auth, corps: ModeleQuestionnaireCreation) {
  const { definition, origine } = await definitionSource(db, corps.source);
  const def = normaliserDefinition(
    corps.titre ? { ...definition, titre: corps.titre } : definition,
    corps.code,
    1,
  );
  const m = await traduireErreursPg(
    db.query(
      `INSERT INTO questionnaire_modeles (cabinet_id, code, titre, origine, gabarit, copie_de, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        auth.cabinetId,
        corps.code,
        def.titre,
        origine,
        corps.source.type === "gabarit" ? corps.source.gabarit : null,
        corps.source.type === "copie" ? corps.source.modele_id : null,
        auth.utilisateurId,
      ],
    ),
    { "*": "Un modèle de questionnaire porte déjà ce code." },
  );
  const modeleId = m.rows[0].id as string;
  const v = await db.query(
    `INSERT INTO questionnaire_versions (cabinet_id, modele_id, version, definition, cree_par, modifie_par)
     VALUES ($1, $2, 1, $3, $4, $4) RETURNING id`,
    [auth.cabinetId, modeleId, JSON.stringify(def), auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "questionnaire_modele",
    entiteId: modeleId,
    details: { code: corps.code, origine, version_id: v.rows[0].id },
  });
  return lireModele(db, modeleId);
}

/** Modèles du cabinet (page par curseur sur titre, id), avec leur dernière version validée. */
export async function listerModeles(db: Db, apres: [string, string] | null, limite: number) {
  const r = await db.query(
    `SELECT m.id, m.code, m.titre, m.origine, m.cree_le, m.modifie_le,
       (SELECT v.id FROM questionnaire_versions v WHERE v.modele_id = m.id AND v.statut = 'valide'
        ORDER BY v.version DESC LIMIT 1) AS version_validee_id,
       EXISTS (SELECT 1 FROM questionnaire_versions v WHERE v.modele_id = m.id
               AND v.statut = 'brouillon') AS brouillon,
       lower(m.titre) AS cle_tri
     FROM questionnaire_modeles m
     WHERE ($1::text IS NULL OR (lower(m.titre), m.id) > ($1, $2::uuid))
     ORDER BY lower(m.titre), m.id LIMIT $3`,
    [apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return paginer(r.rows as { cle_tri: string; id: string }[], limite);
}

/** Modèle, ses versions (sans définition) et sa dernière définition. */
export async function lireModele(db: Db, id: string) {
  const m = await db.query(
    `SELECT id, code, titre, origine, gabarit, copie_de, cree_par, cree_le, modifie_le
     FROM questionnaire_modeles WHERE id = $1`,
    [id],
  );
  if (!m.rows[0]) throw introuvable("Modèle de questionnaire");
  const v = await db.query(
    `SELECT ${COLONNES_VERSION} FROM questionnaire_versions v WHERE v.modele_id = $1
     ORDER BY v.version DESC`,
    [id],
  );
  return { ...m.rows[0], versions: v.rows };
}

/** Version et sa définition. */
export async function lireVersion(db: Db, id: string, verrouiller = false) {
  const r = await db.query(
    `SELECT ${COLONNES_VERSION}, v.definition, m.code FROM questionnaire_versions v
     JOIN questionnaire_modeles m ON m.id = v.modele_id WHERE v.id = $1
     ${verrouiller ? "FOR UPDATE OF v" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Version de questionnaire");
  const version = r.rows[0] as VersionLue & { code: string; cree_par: string };
  // Origine IA (SOC-11) : statut du contenu et historique, null pour une version rédigée à la main.
  return { ...version, ia: await lireOrigineIa(db, id) };
}

/** Nouvelle version brouillon (définition fournie ou copie de la dernière). */
export async function creerVersion(
  db: Db,
  auth: Auth,
  modeleId: string,
  definition: DefinitionQuestionnaireDonnees | undefined,
) {
  const m = await db.query("SELECT id, code FROM questionnaire_modeles WHERE id = $1 FOR UPDATE", [
    modeleId,
  ]);
  if (!m.rows[0]) throw introuvable("Modèle de questionnaire");
  const derniere = await derniereVersion(db, modeleId);
  if (derniere?.statut === "brouillon") {
    throw conflit("Un brouillon existe déjà pour ce modèle : modifiez-le ou validez-le.");
  }
  const numero = (derniere?.version ?? 0) + 1;
  const source = definition ?? derniere?.definition;
  if (!source) throw introuvable("Modèle de questionnaire");
  const def = normaliserDefinition(source, m.rows[0].code as string, numero);
  const v = await db.query(
    `INSERT INTO questionnaire_versions (cabinet_id, modele_id, version, definition, cree_par, modifie_par)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [auth.cabinetId, modeleId, numero, JSON.stringify(def), auth.utilisateurId],
  );
  await db.query("UPDATE questionnaire_modeles SET titre = $2, modifie_le = now() WHERE id = $1", [
    modeleId,
    def.titre,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation_version",
    entite: "questionnaire_modele",
    entiteId: modeleId,
    details: { version: numero, version_id: v.rows[0].id },
  });
  return lireVersion(db, v.rows[0].id as string);
}

/** Remplace la définition d'une version brouillon. */
export async function modifierVersion(
  db: Db,
  auth: Auth,
  id: string,
  definition: DefinitionQuestionnaireDonnees,
) {
  const v = await lireVersion(db, id, true);
  if (v.statut !== "brouillon") {
    throw conflit("Cette version est validée : elle est figée, créez une nouvelle version.");
  }
  const def = normaliserDefinition(definition, v.code, v.version);
  if (v.ia) await inscrireModificationIa(db, auth, id, def);
  await db.query(
    "UPDATE questionnaire_versions SET definition = $2, modifie_par = $3 WHERE id = $1",
    [id, JSON.stringify(def), auth.utilisateurId],
  );
  await db.query("UPDATE questionnaire_modeles SET titre = $2, modifie_le = now() WHERE id = $1", [
    v.modele_id,
    def.titre,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification_version",
    entite: "questionnaire_modele",
    entiteId: v.modele_id,
    details: { version: v.version, version_id: id },
  });
  return lireVersion(db, id);
}

/** Valide une version brouillon : définition revérifiée par le moteur, puis figée. */
export async function validerVersion(db: Db, auth: Auth, id: string, acquitteChiffres = false) {
  const v = await lireVersion(db, id, true);
  if (v.statut !== "brouillon") throw conflit("Cette version est déjà validée.");
  exigerDefinitionValide(v.definition);
  // Version d'origine IA : circuit humain (séparation des tâches, nombres acquittés).
  if (v.ia) await validerContenuIa(db, auth, id, acquitteChiffres);
  await db.query(
    `UPDATE questionnaire_versions SET statut = 'valide', valide_par = $2, valide_le = now(),
       modifie_par = $2 WHERE id = $1`,
    [id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "validation_version",
    entite: "questionnaire_modele",
    entiteId: v.modele_id,
    details: { version: v.version, version_id: id },
  });
  return lireVersion(db, id);
}
