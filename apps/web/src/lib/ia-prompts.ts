/** IA : prompts versionnés (contrat de l'API, chemins, résumé du format de sortie). */
import { VARIABLE_CHIFFRES, type SchemaSortie, type TacheIa } from "@missionpilot/shared";

// --- Prompts versionnés ----------------------------------------------------------------------

/** GET /api/ia/prompts (versions actives par nom, ou toutes les versions d'un nom). */
export interface PromptIa {
  id: string;
  nom: string;
  version: number;
  tache: TacheIa;
  description: string;
  gabarit_systeme: string;
  gabarit_utilisateur: string;
  variables: string[];
  schema_sortie: SchemaSortie;
  exemple: boolean;
  auteur_id: string | null;
  cree_le: string;
  actif: boolean;
}

export interface PageIa<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export const LIMITE_PROMPTS = 100;
export const LIMITE_VERSIONS_PROMPT = 20;

export function cheminVersionsPrompt(nom: string, curseur?: string | null): string {
  const p = new URLSearchParams({ nom, limite: String(LIMITE_VERSIONS_PROMPT) });
  if (curseur) p.set("curseur", curseur);
  return `/api/ia/prompts?${p.toString()}`;
}

export const cheminActivationPrompt = (id: string) =>
  `/api/ia/prompts/${encodeURIComponent(id)}/activer`;

/** Variables que l'écran fait saisir (« chiffres » est rempli par l'API, depuis les moteurs). */
export const variablesASaisir = (p: Pick<PromptIa, "variables">) =>
  p.variables.filter((v) => v !== VARIABLE_CHIFFRES);

/** Résumé lisible du format de sortie attendu. */
export function resumeSchemaSortie(s: SchemaSortie): string {
  if (s.type === "texte") {
    return s.longueur_max
      ? `Texte libre (${new Intl.NumberFormat("fr-FR").format(s.longueur_max)} caractères au plus)`
      : "Texte libre";
  }
  const champs = Object.entries(s.champs).map(([nom, c]) => {
    switch (c.type) {
      case "texte":
        return `${nom} (texte)`;
      case "liste_texte":
        return `${nom} (liste de textes)`;
      case "booleen":
        return `${nom} (oui ou non)`;
      case "choix":
        return `${nom} (choix : ${c.valeurs.join(", ")})`;
    }
  });
  return `Objet JSON : ${champs.join(" ; ")}`;
}

/** Après activation d'une version : elle seule est active parmi les versions de son nom. */
export function marquerActive(versions: readonly PromptIa[], active: PromptIa): PromptIa[] {
  return versions.map((v) =>
    v.id === active.id ? { ...v, actif: true } : v.nom === active.nom ? { ...v, actif: false } : v,
  );
}
