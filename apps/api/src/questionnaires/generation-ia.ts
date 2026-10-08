import type { QuestionnaireGenerationIa } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { AppError, conflit } from "../errors.js";
import { lireDemandeVisible } from "../ia/generations.js";
import { genererContenu, type DependancesIa, type ResultatExecution } from "../ia/orchestrateur.js";
import {
  assurerPromptQuestionnaire,
  definitionDeRepli,
  definitionDepuisSortie,
  NOM_PROMPT_QUESTIONNAIRE,
  type BesoinQuestionnaire,
} from "../ia/prompts/gabarits/questionnaire.js";
import { inscrireBrouillonIa } from "./ia-historique.js";
import { creerModele, lireVersion, normaliserDefinition } from "./modeles.js";

/*
 * Génération assistée de questionnaires (SOC-11).
 *
 * 1. Préparation : le code du modèle est libre (sinon 409 avant tout appel
 *    payant) et le prompt `questionnaire_brouillon` existe dans le cabinet.
 * 2. Génération par l'ORCHESTRATEUR (ia/orchestrateur.ts) : masquage des
 *    termes sensibles et des formats connus avant l'envoi, quota et plafond,
 *    garde-chiffres, trace. Sans clé, IA désactivée ou plafond atteint, le
 *    gabarit déterministe de l'orchestrateur répond et le questionnaire de
 *    repli est construit par code (`definitionDeRepli`).
 * 3. Enregistrement : un modèle du cabinet dont la version 1 est un BROUILLON
 *    (comme un modèle rédigé à la main) et le premier rang de son historique
 *    « brouillon IA » (ia-historique.ts). Rien n'atteint un client avant la
 *    validation d'un consultant : seule une version validée s'envoie (0141)
 *    et la base exige la validation humaine d'une version d'origine IA (0149).
 *
 * Aucun chiffre ne vient du modèle : la définition est construite par code
 * (échelles fixes) puis contrôlée par le moteur de questionnaires.
 */

const MESSAGES_ECHEC: Record<string, string> = {
  PLAFOND_IA_ATTEINT: "Plafond mensuel de coût IA atteint.",
  GENERATIONS_SIMULTANEES: "Trop de générations IA en cours pour le cabinet.",
};

/**
 * Enregistre la génération terminée comme modèle du cabinet (version 1 en brouillon) et premier
 * rang « brouillon IA » de son historique, dans la transaction `db`. Repli déterministe si la
 * génération est un gabarit, si la sortie est inexploitable ou si le moteur de questionnaires
 * refuse la définition proposée.
 */
async function enregistrerBrouillonIa(
  db: Db,
  auth: Auth,
  demandeId: string,
  corps: QuestionnaireGenerationIa,
  besoin: BesoinQuestionnaire,
) {
  const demande = await lireDemandeVisible(db, auth, demandeId);
  if (demande.statut !== "terminee" || demande.g_version === null) {
    const code = String(demande.erreur_code ?? "");
    throw new AppError(
      502,
      "GENERATION_IA_ECHEC",
      MESSAGES_ECHEC[code] ?? "La génération du questionnaire a échoué : réessayez plus tard.",
    );
  }
  const gabarit = demande.p_gabarit === true;
  const propose = gabarit ? null : definitionDepuisSortie(demande.g_donnees, besoin);
  let definition = propose ?? definitionDeRepli(besoin);
  try {
    normaliserDefinition(definition, corps.code, 1);
  } catch {
    // Définition du modèle incohérente (moteur de questionnaires) : repli déterministe.
    definition = definitionDeRepli(besoin);
  }
  const repli = gabarit || propose === null || definition !== propose;
  const modele = await creerModele(db, auth, {
    code: corps.code,
    source: { type: "definition", definition },
  });
  const versionId = (modele.versions[0] as { id: string }).id;
  await inscrireBrouillonIa(db, auth, versionId, {
    demandeId,
    brief: {
      service: besoin.service,
      population: besoin.population,
      theme: besoin.theme,
      nombre_questions: besoin.nombre_questions,
    },
    gabarit: repli,
    // Un repli est fabriqué par code : aucun nombre du modèle à acquitter.
    chiffresNonVerifies: !repli && demande.g_chiffres_non_verifies === true,
    nombresNonVerifies: repli ? [] : (demande.g_nombres_non_verifies ?? []),
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "generation_questionnaire_ia",
    entite: "questionnaire_modele",
    entiteId: modele.id as string,
    // Jamais le contenu ni le besoin : identifiants et indicateurs seulement.
    details: { version_id: versionId, demande_id: demandeId, gabarit: repli },
  });
  return lireVersion(db, versionId);
}

export async function genererQuestionnaireIa(
  database: Database,
  deps: DependancesIa,
  auth: Auth,
  corps: QuestionnaireGenerationIa,
): Promise<{ version: Awaited<ReturnType<typeof lireVersion>>; resultat: ResultatExecution }> {
  const besoin: BesoinQuestionnaire = {
    service: corps.service,
    population: corps.population,
    theme: corps.theme,
    nombre_questions: corps.nombre_questions,
  };

  await database.withTenant(auth.cabinetId, async (db) => {
    const pris = await db.query("SELECT 1 FROM questionnaire_modeles WHERE code = $1", [
      corps.code,
    ]);
    if (pris.rows[0]) throw conflit("Un modèle de questionnaire porte déjà ce code.");
    await assurerPromptQuestionnaire(db, auth.cabinetId);
  });

  const { demandeId, resultat } = await genererContenu(database, deps, {
    tache: "redaction",
    promptNom: NOM_PROMPT_QUESTIONNAIRE,
    variables: {
      service: besoin.service,
      population: besoin.population,
      theme: besoin.theme,
      nombre_questions: String(besoin.nombre_questions),
    },
    termesSensibles: corps.termes_sensibles,
    utilisateur: auth,
    // Sans budget IA, le gabarit déterministe répond (l'expert complète).
    repliSiPlafond: true,
  });

  const version = await database.withTenant(auth.cabinetId, (db) =>
    enregistrerBrouillonIa(db, auth, demandeId, corps, besoin),
  );
  return { version, resultat };
}
