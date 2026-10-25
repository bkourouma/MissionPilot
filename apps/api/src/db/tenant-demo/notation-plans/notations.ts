import type { ContexteTenantDemo } from "../contexte.js";
import { trouverMission } from "./casting.js";
import { assurerCommentaires, assurerPlans, verifierLectures } from "./notations-extras.js";
import {
  assurerEquipe,
  envoiNotationClos,
  json,
  lierMethodeNotation,
  versionGrilleValidee,
} from "./notations-outils.js";
import { jouerVersions } from "./notations-parcours.js";
import { NOTATIONS, type DefNotation } from "./notations-donnees.js";
import { exiger } from "./outils.js";

/*
 * Étape « notations » de la phase « notation-plans » : notations des missions 2 et 9 du cabinet
 * « Tenant démo ». Tout passe par les routes /api/missions/:id/notation, /api/notations/**,
 * /api/qualite/** et /api/ia/generations/** dans les sessions des rôles qui ont la permission ;
 * les notes sortent des moteurs (jamais écrites à la main). Les missions du casting restent
 * OUVERTES : la mission 2 porte donc une notation PUBLIÉE alors qu'elle n'est pas clôturée.
 *
 * CE QUI EST CRÉÉ (classe et statut par mission ; voir notations-donnees.ts pour les actions)
 * -------------------------------------------------------------------------------------------
 * Mission 2 « Notation financière — Sahel Coton » (grille « competitivite-excellence » v1,
 * envoi clos du modèle « notation_generique » v1, méthode « notation_entreprise ») :
 *   - v1  calculée 52,5 (C) par consultant ; quatre ajustements motivés de chef.mission la
 *         ramènent à 44,5 (classe D) ; soumise par consultant ; RENVOYÉE par expert.metier.2
 *         (ajustements disproportionnés, secteur non appliqué) ; statut « remplacée » ensuite ;
 *   - v2  calculée (secteur agro_industrie, stratégie pénalisante) 52,5 par consultant ; deux
 *         ajustements de chef.mission → 53,0 (classe C) ; soumise par consultant ; suivi qualité R3
 *         SIGNÉ ; PUBLIÉE par expert.metier (ni calcul, ni ajustement, ni soumission) ;
 *   - un plan d'action enregistré par version (v1, v2), commentaires IA de l'explication (v1 en
 *     brouillon IA, v2 retouché donc « modifié »), indice de confiance enregistré à la publication.
 * Mission 9 « Notation financière — Banque du Sahel (portefeuille PME) » (grille
 * « grille-banque-pme » v1, envoi clos « notation_generique » v2) :
 *   - v1  calculée 66,9 (classe B) par consultant.2 ; ajustement qualité → 63,3 (C) ; soumise,
 *         RENVOYÉE par expert.metier (preuves) ; REPRISE (ajustement coûts → 60,5, classe C),
 *         re-soumise puis RENVOYÉE par expert.metier.2 (calcul pénalisant exigé) ;
 *   - v2  calculée (secteur services, stratégie pénalisante) 66,8 ; ajustement pilotage → 67,2
 *         (classe B) ; SOUMISE, EN REVUE (non publiée) ; plan d'action et commentaire IA brouillon.
 * Classes obtenues : D, C (mission 2) ; B, C, B (mission 9). Les classes A et E sont portées par
 * l'étape « notations-complement » (missions 1 et 3), avec des envois de maturité différente :
 * ici, les réponses des envois (étape « questionnaires ») sont d'une maturité moyenne.
 * Les deux missions sont liées à la méthode du cabinet : une ligne notation_versions_methode par
 * version (journal d'exécution des moteurs de la méthode).
 *
 * LIGNES QUALITÉ CRÉÉES ICI (un autre lot remplira le reste de qualite_*)
 * ----------------------------------------------------------------------
 * - qualite_suivis (+ qualite_evenements, qualite_revue_elements) : un suivi R3 par version
 *   SOUMISE en revue, ouvert par la soumission elle-même (branchement de l'API) ;
 * - qualite_definition_items / attestations, qualite_revue_vus, qualite_validations,
 *   qualite_signatures : uniquement pour la version PUBLIÉE (mission 2, version 2) : vérification
 *   de la définition de terminé, attestations, parcours des éléments, trois étapes de garde
 *   (consultant, chef, second expert) puis signature du directeur. Les suivis des versions
 *   renvoyées ou encore en revue restent « brouillon ».
 * Ces suivis ne sont exigés que parce que la mission est LIÉE à la méthode « notation_entreprise »
 * (mission_methodes, créée ici par PUT /api/missions/:id/methode si la mission n'en a pas).
 *
 * Idempotent : clé naturelle = une notation par mission ; chaque version reprend à la dernière
 * ligne écrite (notations-parcours.ts) ; plans et commentaires IA sont contrôlés avant écriture.
 */

async function semerNotation(ctx: ContexteTenantDemo, def: DefNotation): Promise<void> {
  const mission = await trouverMission(ctx, def.mission);
  ctx.journal(`    notation « ${mission.intitule} »…`);
  await assurerEquipe(ctx, mission.id, def.chef, def.equipe);
  await lierMethodeNotation(ctx, mission.id, def.chef, def.methode.contexte, def.methode.motif);

  const lecture = await ctx.session(def.chef).get(`/api/missions/${mission.id}/notation`);
  let notationId: string;
  if (lecture.statusCode === 404) {
    const r = await ctx.session(def.creePar).post(`/api/missions/${mission.id}/notation`, {});
    exiger(r, 201, "création de la notation");
    notationId = json(r).id;
  } else {
    exiger(lecture, 200, "lecture de la notation");
    notationId = json(lecture).id;
  }

  await jouerVersions(ctx, {
    notationId,
    envoiId: await envoiNotationClos(ctx, mission.id),
    grilleVersionId: await versionGrilleValidee(ctx, def.grille),
    versions: def.versions,
  });
  await assurerPlans(ctx, notationId, def.plans);
  await assurerCommentaires(ctx, notationId, def.commentaires);
  await verifierLectures(
    ctx,
    notationId,
    def.chef,
    def.versions.map((_, i) => i + 1),
  );
}

export async function semerNotations(ctx: ContexteTenantDemo): Promise<void> {
  for (const def of NOTATIONS) await semerNotation(ctx, def);
}
