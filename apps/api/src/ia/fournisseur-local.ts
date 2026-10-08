import { estimerTokens, type LlmProvider, type RequeteLlm } from "./fournisseur.js";

/*
 * Fournisseur LOCAL et déterministe (AGT-04) : aucun appel réseau, aucune clé,
 * aucun coût. La réponse est fabriquée par une fonction du code (`repondre`)
 * à partir de la requête : même requête → même réponse. Il sert les
 * évaluations de non-régression tant qu'aucun rejeu sur un vrai modèle n'est
 * branché (file `jobs`, coût plafonné : ADR-005) : il vérifie la chaîne
 * (rendu du prompt, variables, schéma de sortie, garde-chiffres, critères des
 * cas), pas la qualité rédactionnelle d'un modèle.
 */

export function creerFournisseurLocal(repondre: (requete: RequeteLlm) => string): LlmProvider {
  return {
    nom: "local",
    async completer(requete) {
      const texte = repondre(requete);
      const entree = requete.messages.reduce((n, m) => n + m.content.length, 0);
      return {
        texte,
        modele: requete.modele,
        tokensEntree: estimerTokens(entree),
        tokensSortie: estimerTokens(texte.length),
        tokensEstimes: true,
        dureeMs: 0,
      };
    },
  };
}
