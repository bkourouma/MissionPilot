import { CASTING } from "./casting.js";
import type { SpecPlan } from "./plans-coeur-types.js";

/*
 * Plan 10 — Sicafe Export, mission 10 (SIGNÉE, démarre le 2026-11-09) : plan au tout début,
 * préparé par le chef de mission avant le démarrage. Aucun contenu validé, pas d'initiative, pas de
 * modèle financier. La route de création accepte une mission « signée » (seule une mission
 * clôturée est refusée).
 */

export const TITRE_PLAN_EXPORT = "Plan stratégique 2027-2029 — Sicafe Export";

export const PLAN_EXPORT: SpecPlan = {
  mission: CASTING.sicafeExport,
  titre: TITRE_PLAN_EXPORT,
  horizon: 3,
  elements: [
    {
      cle: "diagnostic",
      type: "diagnostic",
      auteur: "chef",
      creation: {
        synthese:
          "SICAFÉ Export, filiale de négoce, commercialise le café et le cacao du groupe auprès de torréfacteurs européens. Éléments recueillis avant le démarrage : deux acheteurs concentrent 58 % des ventes, le délai de recouvrement dépasse 60 jours et le taux de service est irrégulier en haute campagne.",
      },
      etapes: [
        {
          maj: {
            synthese:
              "SICAFÉ Export, filiale de négoce, commercialise le café et le cacao du groupe auprès de torréfacteurs européens. Éléments recueillis avant le démarrage : deux acheteurs concentrent 58 % des ventes, le délai de recouvrement dépasse 60 jours et le taux de service est irrégulier en haute campagne. À confirmer lors des entretiens de cadrage du 9 au 20 novembre 2026.",
          },
        },
      ],
    },
    {
      cle: "swot",
      type: "swot",
      auteur: "chef",
      creation: {
        forces: ["Relation de long terme avec des torréfacteurs européens"],
        faiblesses: ["Concentration des ventes sur deux acheteurs"],
        opportunites: ["Demande en lots certifiés et tracés"],
        menaces: ["Règlement européen sur la déforestation"],
      },
    },
    {
      cle: "A1",
      type: "axe",
      titre: "Structurer la croissance à l'export",
      auteur: "chef",
      creation: {
        titre: "Structurer la croissance à l'export",
        description: "Diversifier la clientèle et fiabiliser le service.",
      },
    },
    {
      cle: "E1",
      type: "objectif",
      titre: "Réduire la part des deux premiers acheteurs sous 40 %",
      parent: "A1",
      auteur: "chef",
      creation: {
        titre: "Réduire la part des deux premiers acheteurs sous 40 %",
        perspective: "finances",
        indicateur: "Chiffre d'affaires export (kFCFA)",
        cible: "Deux premiers acheteurs sous 40 % des ventes en 2029",
        echeance: "2029-12-31",
      },
      kpiExistants: ["Chiffre d'affaires export"],
    },
    {
      cle: "E2",
      type: "objectif",
      titre: "Tenir un taux de service client de 95 %",
      parent: "A1",
      auteur: "chef",
      creation: {
        titre: "Tenir un taux de service client de 95 %",
        perspective: "clients",
        indicateur: "Taux de service client (OTIF) (%)",
        cible: "95 % en haute campagne",
        echeance: "2028-06-30",
      },
      kpiExistants: ["Taux de service client (OTIF)"],
    },
  ],
};
