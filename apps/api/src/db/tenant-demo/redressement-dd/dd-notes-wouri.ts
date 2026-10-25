import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS, acteursPour, trouverMission } from "./commun.js";
import type { Contenu } from "./dd-notes-donnees.js";
import { creer } from "./dd-notes-flux.js";
import { lire } from "./dd-outils.js";

/*
 * Notes de la mission 11 « Due diligence — Wouri Distribution » (en préparation, démarrage le
 * 26 octobre 2026) : deux BROUILLONS d'équipe en version 1, octobre 2026. Ni soumission, ni
 * validation, ni publication : le dossier est ouvert, aucun verdict n'est posé, et le moteur
 * refuserait de toute façon la soumission (hypothèse sans verdict). Les textes restent des
 * lectures préliminaires à confirmer, sans chiffre.
 */

const NOTES: {
  titre: string;
  auteur: "consultant" | "consultant2";
  contenu: Contenu;
  j: number;
}[] = [
  {
    titre: "Lecture préliminaire — marché de la distribution à Douala",
    auteur: "consultant",
    j: 3,
    contenu: {
      recommandation: "reservee",
      synthese:
        "Brouillon d'équipe, à partir du seul dossier de présentation du vendeur.\n\nLa cible distribue en gros des produits de grande consommation à Douala. Son activité dépend du pouvoir d'achat des ménages et du poids de quelques revendeurs importants. Aucune hypothèse du plan du vendeur n'est encore testée : l'hypothèse de croissance des ventes aux revendeurs reste ouverte et sans verdict.\n\nÀ ce stade, aucune recommandation n'est formulée ; la mention « réservée » signifie seulement que l'analyse n'est pas commencée.",
      conditions: [],
    },
  },
  {
    titre: "Points de vigilance — créances sur les revendeurs et stocks",
    auteur: "consultant2",
    j: 2,
    contenu: {
      recommandation: "reservee",
      synthese:
        "Brouillon d'équipe.\n\nDeux points à instruire dès réception des pièces : les délais de paiement accordés aux revendeurs (un signal de la bibliothèque est à vérifier sur la balance âgée) et la gestion des stocks de marchandises, qui paraît peu outillée. Ces deux points portent sur le besoin en fonds de roulement de la cible.\n\nLes données chiffrées manquent encore : rien n'est conclu.",
      conditions: [],
    },
  },
];

export async function semerNotesWouri(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.ddPreparation);
  const mission = await trouverMission(ctx, MISSIONS.ddPreparation);
  const l = await lire<{ elements: { id: string }[] }>(
    a.consultant,
    `/api/missions/${mission.id}/dd/dossiers`,
    "dossiers de la mission Wouri",
  );
  const dossier = l.elements[0];
  if (!dossier) throw new Error("La mission Wouri Distribution ne porte aucun dossier.");
  const existantes = await lire<{ elements: unknown[] }>(
    a.consultant,
    `/api/dd/dossiers/${dossier.id}/notes`,
    "notes existantes",
  );
  if (existantes.elements.length > 0) {
    throw new Error("Le dossier Wouri Distribution porte déjà des notes.");
  }
  for (const n of NOTES) {
    await creer(
      ctx,
      n.auteur === "consultant" ? a.consultant : a.consultant2,
      dossier.id,
      n.titre,
      n.contenu,
      ctx.dateAvant(n.j),
    );
  }
  ctx.journal("  DD Wouri : 2 notes en brouillon (version 1).");
}
