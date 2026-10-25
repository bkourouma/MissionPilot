import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { CleCompte } from "../cles.js";
import { exigerMission, type CleMission } from "./commun.js";
import { acteursMission } from "./ia-aide.js";

/*
 * Dérogations au standard (STD-07) : demandées par le chef de mission (`methode.deroger`), puis
 * décidées étape par étape selon la classe de risque de la brique (garde du moteur `qualite`) :
 *   R1 : validation de l'auteur à la demande (approuvée d'emblée) ;
 *   R2 : validation du consultant (le demandeur), relecture du chef ou du directeur de mission ;
 *   R3 : R2, puis revue d'un second expert (associé) et signature du directeur de mission.
 * Séparation des tâches : le demandeur ne décide jamais après sa propre étape, le second expert
 * est une autre personne que le valideur (quatre yeux). Les décisions suivent la garde ; une
 * dérogation en attente s'arrête à l'étape voulue. Rejouable : clé (mission, brique, nature).
 */

interface Decision {
  etape: string;
  par: CleCompte;
  decision: "approuve" | "refuse";
  commentaire?: string;
}

interface Scenario {
  mission: CleMission;
  brique: string;
  nature: "retirer_brique" | "activer_brique" | "adapter_brique";
  description?: string;
  motif: string;
  decisions: Decision[];
}

const RELECTURE = (par: CleCompte, commentaire: string): Decision => ({
  etape: "relecture_chef_mission",
  par,
  decision: "approuve",
  commentaire,
});

export const SCENARIOS: Scenario[] = [
  {
    mission: "flash-teranga",
    brique: "entretien_dirigeant",
    nature: "retirer_brique",
    motif:
      "Le dirigeant est en déplacement toute la semaine du diagnostic : ses réponses sont recueillies par le questionnaire court et un appel téléphonique.",
    decisions: [],
  },
  {
    mission: "flash-teranga",
    brique: "rapport_court",
    nature: "adapter_brique",
    description:
      "Rapport limité à une synthèse, l'annexe chiffrée étant remise séparément à la banque.",
    motif:
      "La banque de Teranga Logistique demande une synthèse courte et une annexe chiffrée distincte.",
    decisions: [],
  },
  {
    mission: "plan-sicafe-export",
    brique: "calcul_modele",
    nature: "adapter_brique",
    description:
      "Ajouter un scénario de change euro-franc CFA pour les ventes de cacao à l'export.",
    motif:
      "Les acheteurs de Sicafe Export facturent en euros : le plan doit être lu sous un scénario de change défavorable.",
    decisions: [
      RELECTURE("associe", "Scénario pertinent pour un exportateur."),
      {
        etape: "revue_second_expert",
        par: "associe.2",
        decision: "approuve",
        commentaire: "Le scénario reste traçable jusqu'aux hypothèses.",
      },
      {
        etape: "signature_directeur_mission",
        par: "directeur.mission",
        decision: "approuve",
        commentaire: "Signé : le scénario figure en annexe du plan.",
      },
    ],
  },
  {
    mission: "dd-wouri-distribution",
    brique: "verification_preuves",
    nature: "retirer_brique",
    motif:
      "Le vendeur propose de se contenter de ses attestations au lieu de pièces justificatives.",
    decisions: [
      {
        etape: "relecture_chef_mission",
        par: "directeur.mission",
        decision: "refuse",
        commentaire: "Sans pièces justificatives, aucun verdict ne peut être sourcé : refus.",
      },
    ],
  },
  {
    mission: "plan-baobab",
    brique: "calcul_modele",
    nature: "adapter_brique",
    description:
      "Ajouter un scénario de stress sur les placements, à la demande du comité des risques.",
    motif:
      "Le comité des risques de Baobab Assurances veut lire le plan sous un scénario de stress des placements.",
    decisions: [
      RELECTURE(
        "directeur.mission",
        "Pertinent pour un assureur ; reste à obtenir la revue d'un second expert.",
      ),
    ],
  },
  {
    mission: "notation-banque-sahel",
    brique: "atelier_unique",
    nature: "activer_brique",
    motif:
      "Les chargés d'affaires de la banque préfèrent un atelier unique de restitution plutôt que des entretiens séparés.",
    decisions: [],
  },
  {
    mission: "notation-banque-sahel",
    brique: "rapport_notation",
    nature: "adapter_brique",
    description: "Rapport remis en deux volumes pour le comité de crédit de la banque.",
    motif:
      "Le comité de crédit souhaite un volume de synthèse et un volume détaillé des ajustements.",
    decisions: [
      RELECTURE("directeur.mission", "Acceptable sur la forme si la traçabilité est conservée."),
      {
        etape: "revue_second_expert",
        par: "associe.2",
        decision: "refuse",
        commentaire:
          "Séparer le détail des ajustements fragilise la traçabilité : un seul rapport, avec un résumé en tête.",
      },
    ],
  },
  {
    mission: "redressement-gabon",
    brique: "communication_banques",
    nature: "retirer_brique",
    motif:
      "Gabon Offshore Services a déjà informé ses banques lors de son dernier comité de crédit : la note du cabinet fait double emploi.",
    decisions: [],
  },
  {
    mission: "dd-wouri-distribution",
    brique: "analyse_financiere_dd",
    nature: "adapter_brique",
    description:
      "Accepter les attestations de l'expert-comptable pour les pièces antérieures à l'exercice audité.",
    motif:
      "Les pièces antérieures à l'exercice audité ne sont plus disponibles dans la salle de données.",
    decisions: [RELECTURE("directeur.mission", "Accepté, avec mention explicite dans le rapport.")],
  },
];

async function trouver(
  ctx: ContexteTenantDemo,
  missionId: string,
  s: Scenario,
): Promise<string | null> {
  const r = await ctx.proprietaire.query<{ id: string }>(
    "SELECT id FROM derogations WHERE mission_id = $1 AND brique_code = $2 AND nature = $3",
    [missionId, s.brique, s.nature],
  );
  return r.rows[0]?.id ?? null;
}

export async function semerDerogations(ctx: ContexteTenantDemo): Promise<void> {
  for (const s of SCENARIOS) {
    const mission = await exigerMission(ctx, s.mission);
    // Chef et directeur RÉELS de la mission (une mission n'est visible que de son équipe) : les clés
    // symboliques « chef.mission » et « directeur.mission » du scénario désignent ces deux personnes.
    const acteurs = (await acteursMission(ctx, mission)) ?? {
      chef: "chef.mission" as CleCompte,
      directeur: "directeur.mission" as CleCompte,
    };
    const chef = ctx.session(acteurs.chef);
    const qui = (par: CleCompte): CleCompte =>
      par === "directeur.mission" ? acteurs.directeur : par === "chef.mission" ? acteurs.chef : par;
    let id = await trouver(ctx, mission.id, s);
    if (!id) {
      const r = await chef.post(`/api/missions/${mission.id}/derogations`, {
        brique_code: s.brique,
        nature: s.nature,
        description: s.description,
        motif: s.motif,
      });
      attendre(201, r, `dérogation ${s.mission}/${s.brique}`);
      id = (r.json() as { id: string }).id;
    }
    // Décisions : tant que la garde attend l'étape prévue (reprise possible après un arrêt).
    for (const d of s.decisions) {
      const lu = await chef.get(`/api/derogations/${id}`);
      attendre(200, lu, `lecture dérogation ${id}`);
      const detail = lu.json() as { statut: string; garde: { prochaine_etape: string | null } };
      if (detail.statut !== "demandee" || detail.garde.prochaine_etape !== d.etape) continue;
      const rep = await ctx.session(qui(d.par)).post(`/api/derogations/${id}/decisions`, {
        etape: d.etape,
        decision: d.decision,
        commentaire: d.commentaire,
      });
      attendre(200, rep, `décision ${d.etape} sur ${s.mission}/${s.brique}`);
    }
  }
  ctx.journal("  dérogations demandées et décidées.");
}
