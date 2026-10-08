import { schemaSortieSchema, type SchemaSortie } from "@missionpilot/shared";
import { zodSortie } from "./prompts.js";

/*
 * Sorties d'AGENT validées par schéma (AGT-02, ADR-005). L'orchestrateur
 * valide déjà la sortie du modèle contre le schéma du PROMPT (Zod strict,
 * ia/prompts.ts) ; un agent déclare en plus SON contrat de sortie dans le
 * registre (agents_registre.schema_sortie). Avant toute utilisation, la sortie
 * est revalidée contre ce contrat, en mode strict : un champ en trop, manquant
 * ou mal typé la rend INUTILISABLE (elle ne peut être que rejetée).
 *
 * AGT-07 : un contrat de sortie ne contient aucun champ qui ressemble à une
 * commande (« action », « outil », « tool_calls »…) : une sortie est une
 * donnée proposée à un humain, jamais une instruction exécutable.
 */

/** Noms de champ refusés dans un contrat de sortie d'agent (formes d'une commande). */
export const CHAMPS_ACTION_INTERDITS: readonly string[] = [
  "action",
  "actions",
  "commande",
  "commandes",
  "outil",
  "outils",
  "tool",
  "tools",
  "tool_calls",
  "function_call",
  "fonction",
  "executer",
  "execution",
  "envoyer",
  "envoi",
];

export class ContratSortieInvalide extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContratSortieInvalide";
  }
}

/** Contrat de sortie d'un agent, lu du registre ; lève si mal formé ou porteur d'une commande. */
export function contratSortieAgent(brut: unknown): SchemaSortie {
  const r = schemaSortieSchema.safeParse(brut);
  if (!r.success) throw new ContratSortieInvalide("Contrat de sortie d'agent mal formé.");
  if (r.data.type === "objet") {
    const interdits = Object.keys(r.data.champs).filter((c) => CHAMPS_ACTION_INTERDITS.includes(c));
    if (interdits.length > 0) {
      throw new ContratSortieInvalide(
        `Contrat de sortie d'agent : champ de commande interdit (${interdits.join(", ")}).`,
      );
    }
  }
  return r.data;
}

export type ErreurSortieAgent = "SORTIE_ABSENTE" | "TEXTE_NON_CONFORME" | "OBJET_NON_CONFORME";

export interface ValidationSortieAgent {
  valide: boolean;
  erreurs: ErreurSortieAgent[];
}

/**
 * Valide une sortie (texte et éventuel objet) contre le contrat d'un agent, en mode
 * strict. Une sortie objet attendue sans objet (texte libre) est non conforme.
 */
export function validerSortieAgent(
  contrat: SchemaSortie,
  sortie: { texte: string | null; donnees: unknown },
): ValidationSortieAgent {
  if (sortie.texte === null || sortie.texte.trim() === "") {
    return { valide: false, erreurs: ["SORTIE_ABSENTE"] };
  }
  if (contrat.type === "texte") {
    const r = zodSortie(contrat).safeParse(sortie.texte);
    return r.success
      ? { valide: true, erreurs: [] }
      : { valide: false, erreurs: ["TEXTE_NON_CONFORME"] };
  }
  if (sortie.donnees === null || typeof sortie.donnees !== "object") {
    return { valide: false, erreurs: ["OBJET_NON_CONFORME"] };
  }
  const r = zodSortie(contrat).safeParse(sortie.donnees);
  return r.success
    ? { valide: true, erreurs: [] }
    : { valide: false, erreurs: ["OBJET_NON_CONFORME"] };
}
