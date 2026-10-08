import type { FastifyPluginAsync } from "fastify";
import { joursVersHeures, NB_MOIS_PREVISION } from "@missionpilot/engines";
import { previsionsQuerySchema, semaineQuerySchema } from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { aujourdhui } from "../missions/outils.js";
import { calculerPrevision, chargerDonneesPrevision, vuePrevision } from "../previsions/donnees.js";
import { suggererSemaine } from "../temps/preremplissage.js";

/**
 * AUT-12 : prévisions de chiffre d'affaires et de charge (PRD complémentaire).
 * AUT-09 : suggestion de pré-remplissage d'une semaine de feuille de temps.
 *
 * Posé VIDE au début de la vague 2 et déjà enregistré sous /api par `app.ts`. Aucune route
 * n'est ouverte au portail client (absente de `LISTE_BLANCHE_PORTAIL`).
 */
export const routesPrevisions: FastifyPluginAsync = async (app) => {
  /**
   * Prévision sur 12 mois : carnet signé (échéances non facturées), pipeline pondéré, charge
   * contre la capacité. Montants et marges de gestion : `finance.lire` (FIN-02), donc associés
   * et gestionnaires seuls ; sans ce droit, la réponse entière est refusée (403).
   */
  app.get("/previsions", async (request) => {
    const auth = exiger(request, "finance.lire");
    const q = previsionsQuerySchema.parse(request.query);
    const dateReference = q.date_reference ?? aujourdhui();
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const donnees = await chargerDonneesPrevision(
        db,
        auth.cabinetId,
        dateReference,
        NB_MOIS_PREVISION,
      );
      return vuePrevision(
        calculerPrevision(donnees, dateReference, NB_MOIS_PREVISION),
        donnees,
        dateReference,
      );
    });
  });

  /**
   * Suggestion de saisie pour la semaine contenant `semaine` (aujourd'hui par défaut), pour le
   * consultant connecté. LECTURE SEULE : rien n'est enregistré ; le consultant confirme en
   * enregistrant sa feuille par le circuit habituel.
   */
  app.get("/temps/preremplissage", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const q = semaineQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const s = await suggererSemaine(db, auth, q.semaine ?? aujourdhui());
      const sources = { affectations: true, activite_plateforme: true, agenda: false };
      if (!s) {
        return {
          semaine: null,
          collaborateur_id: null,
          feuille_modifiable: false,
          propositions: [],
          ecartees: [],
          total_jours: 0,
          sources,
        };
      }
      return {
        semaine: s.semaine,
        collaborateur_id: s.collaborateurId,
        feuille_modifiable: s.feuilleModifiable,
        unite_saisie_temps: s.granularite,
        propositions: s.propositions.map((x) => ({
          date: x.date,
          mission_id: x.missionId,
          tache_id: x.tacheId,
          mission_intitule: s.libelles.get(x.tacheId)?.mission ?? null,
          tache_libelle: s.libelles.get(x.tacheId)?.tache ?? null,
          jours: x.jours,
          heures: joursVersHeures(x.jours, s.heuresParJour),
          source: x.source,
          confiance: x.confiance,
          raisons: x.raisons,
        })),
        ecartees: s.ecartees
          .filter((x) => x.motif !== "tache_non_affectee")
          .map((x) => ({
            date: x.date,
            mission_id: x.missionId,
            tache_id: x.tacheId,
            jours: x.jours,
            motif: x.motif,
          })),
        total_jours: s.totalJours,
        activite_ignoree: s.activiteIgnoree,
        sources,
      };
    });
  });
};
