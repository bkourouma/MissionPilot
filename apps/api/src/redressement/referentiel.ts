import {
  CATALOGUE_LEVIERS,
  CORRESPONDANCE_SYSCOHADA_INDICATIVE,
  GRILLE_URGENCE,
  PARAMETRES_URGENCE_DEFAUT,
  SEUILS_ALERTE_DEFAUT,
  VERSION_CATALOGUE_LEVIERS,
  VERSION_GRILLE_URGENCE,
  VERSION_MOTEUR_ALERTE,
  VERSION_MOTEUR_REDRESSEMENT,
} from "@missionpilot/engines";
import { RED_PLAFONDS, type RedReferentielVue } from "@missionpilot/shared";
import { postesVersVue, seuilsVersJson, vueDefinitionLevier } from "./vues.js";

/*
 * Référentiel du moteur (route 1) : grille d'urgence, catalogue de leviers, seuils par défaut du
 * moteur (PROVISOIRES), correspondance indicative et plafonds. AUCUNE lecture en base : tout vient
 * des constantes du moteur et du paquet partagé.
 */
export function referentiel(): RedReferentielVue {
  return {
    version_moteur: VERSION_MOTEUR_REDRESSEMENT,
    version_grille_urgence: VERSION_GRILLE_URGENCE,
    version_moteur_alerte: VERSION_MOTEUR_ALERTE,
    version_catalogue_leviers: VERSION_CATALOGUE_LEVIERS,
    grille_urgence: GRILLE_URGENCE.map((q) => ({
      code: q.code,
      domaine: q.domaine,
      libelle: q.libelle,
      critique: q.critique,
    })),
    parametres_urgence: {
      seuil_orange_pct: PARAMETRES_URGENCE_DEFAUT.seuilOrangePct,
      seuil_rouge_pct: PARAMETRES_URGENCE_DEFAUT.seuilRougePct,
      poids_critique: PARAMETRES_URGENCE_DEFAUT.poidsCritique,
      part_minimale_repondue_pct: PARAMETRES_URGENCE_DEFAUT.partMinimaleReponduePct,
    },
    seuils_defaut: seuilsVersJson(SEUILS_ALERTE_DEFAUT),
    leviers: CATALOGUE_LEVIERS.map(vueDefinitionLevier),
    correspondance_indicative: postesVersVue(CORRESPONDANCE_SYSCOHADA_INDICATIVE),
    plafonds: { ...RED_PLAFONDS },
  };
}
