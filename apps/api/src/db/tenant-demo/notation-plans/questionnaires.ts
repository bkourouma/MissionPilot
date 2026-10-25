import type { ContexteTenantDemo } from "../contexte.js";
import { ENVOIS, assurerEnvoi } from "./questionnaires-envois.js";
import { semerModeles } from "./questionnaires-modeles.js";
import { assurerRepondants } from "./questionnaires-portail.js";

/*
 * Étape « questionnaires » de la phase « notation-plans » : modèles, versions, envois, réponses,
 * relances et générations IA du cabinet « Tenant démo ». Tout passe par les routes
 * /api/questionnaires/**, /api/missions/:id/questionnaires et /api/portail/questionnaires/**
 * (réponses des contacts clients depuis leur portail). Les missions du casting restent ouvertes
 * pendant toutes les phases : leur clôture est faite à la toute fin de la phase « gestion ».
 *
 * CE QUE L'ÉTAPE SUIVANTE (« notations », missions 2 et 9) DOIT UTILISER
 * ----------------------------------------------------------------------
 * Modèle de notation : code « notation_generique » (gabarit générique de MissionPilot), version 1
 * et version 2 VALIDÉES (la 2 ajoute une question libre non notée « div.commentaires » ; les
 * questions notées sont identiques, donc les deux grilles de l'étape « notation-referentiels »
 * s'y appliquent).
 * Envois de NOTATION (mode « par_fonction », 3 répondants, toutes les réponses SOUMISES, envoi
 * CLOS) à passer en `envoi_id` du calcul de notation :
 *   - mission 2 « Notation financière — Sahel Coton » : envoi de la version 1 ;
 *   - mission 9 « Notation financière — Banque du Sahel (portefeuille PME) » : envoi de la version 2.
 *   SELECT e.id FROM questionnaire_envois e
 *     JOIN questionnaire_versions v ON v.id = e.version_id
 *     JOIN questionnaire_modeles m ON m.id = v.modele_id
 *    WHERE e.mission_id = '<id de la mission>' AND m.code = 'notation_generique';
 * Grilles à associer : voir l'en-tête de notation-referentiels.ts (« competitivite-excellence »
 * pour la mission 2, « grille-banque-pme » pour la mission 9).
 * Répondants de portail créés ici (e-mails en @tenant-demo.test, mot de passe de démonstration
 * du cabinet) : Sahel Coton (s.diarra, k.coulibaly, f.sissoko), Baobab Assurances (a.sarr,
 * m.gueye, n.ba), Banque du Sahel (f.zongo en plus des comptes dirigeant.client.2 et
 * contributeur.client.2 du socle).
 *
 * Autres modèles : « preliminaire_dirigeants », « satisfaction-client » (v1 validée, v2 en
 * brouillon), « satisfaction-client-flash » (copie en brouillon), « climat-social »,
 * « diagnostic-financier », et trois modèles générés par l'IA simulée : « diagnostic-execution-ia »
 * (brouillon IA, retouché, validé), « climat-equipes-ia » (brouillon IA) et
 * « maturite-numerique-ia » (retouché).
 *
 * Idempotent : clé naturelle = code de modèle, (mission, version) d'envoi, e-mail de répondant.
 */

export async function semerQuestionnaires(ctx: ContexteTenantDemo): Promise<void> {
  await semerModeles(ctx);
  const repondants = await assurerRepondants(ctx);
  for (const envoi of ENVOIS) {
    ctx.journal(`    envoi « ${envoi.cle} »…`);
    await assurerEnvoi(ctx, envoi, repondants);
  }
}
