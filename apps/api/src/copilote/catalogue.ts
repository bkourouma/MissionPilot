import { aPermission } from "@missionpilot/shared";
import { OUTILS_COPILOTE, type OutilCopilote } from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";

/*
 * DROITS DES OUTILS DU COPILOTE (AGT-08) : pour chaque outil, la permission la plus étroite DÉJÀ
 * exigée par la route de l'API qui sert la même information. Le copilote ne donne jamais un droit
 * de plus que l'écran correspondant :
 * - mes_taches : aucune permission particulière (comme GET /taches-collaboration) ;
 * - mes_feuilles_temps : `temps.saisir` (routes/feuilles-temps.ts) ;
 * - resume_mission : `mission.lire` et mission VISIBLE (404 sinon) ; l'avancement et les jours
 *   exigent en plus `budget.lire_jours` (routes/suivi-temps.ts), les KPI `kpi.lire` (routes/kpi.ts) ;
 * - kpi_rouges : `kpi.lire`, sur les missions de l'utilisateur seulement ;
 * - factures_echues : `facture.lire` ET (`encaissement.gerer` OU `indicateurs.cabinet`), comme la
 *   balance âgée (routes/finance-analyses.ts) ; les montants exigent en plus `finance.lire` (FIN-02) ;
 * - recherche : `connaissance.lire` (routes/capitalisation.ts) ; chaque source applique ses propres
 *   droits et la visibilité de mission (capitalisation/recherche.ts) ;
 * - creer_tache : `tache.assigner` (routes/taches-collaboration.ts), revérifiée à la confirmation.
 * La permission `copilote.utiliser` (exigée par chaque route du copilote) s'ajoute à tout cela.
 */
export const PERMISSION_OUTIL: Readonly<Record<OutilCopilote, (auth: Auth) => boolean>> = {
  mes_taches: () => true,
  mes_feuilles_temps: (auth) => aPermission(auth.roles, "temps.saisir"),
  resume_mission: (auth) => aPermission(auth.roles, "mission.lire"),
  kpi_rouges: (auth) => aPermission(auth.roles, "kpi.lire"),
  factures_echues: (auth) =>
    aPermission(auth.roles, "facture.lire") &&
    (aPermission(auth.roles, "encaissement.gerer") ||
      aPermission(auth.roles, "indicateurs.cabinet")),
  recherche: (auth) => aPermission(auth.roles, "connaissance.lire"),
  creer_tache: (auth) => aPermission(auth.roles, "tache.assigner"),
};

/** Outils que cet utilisateur peut utiliser : seuls ceux-là sont proposés au modèle de langage. */
export const outilsPermis = (auth: Auth): OutilCopilote[] =>
  OUTILS_COPILOTE.filter((o) => PERMISSION_OUTIL[o](auth));
