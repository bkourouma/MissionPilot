import type { CasEssai } from "@missionpilot/shared";
import { ErreurLlm, type LlmProvider, type MessageLlm } from "./fournisseur.js";
import { creerFournisseurLocal } from "./fournisseur-local.js";
import { blocChiffres, produireGabarit } from "./gabarits.js";
import { contexteGarde, verifierChiffres } from "./garde-chiffres.js";
import { creerMasque } from "./masquage.js";
import { MAX_TOKENS_SORTIE } from "./modeles.js";
import { rendreGabarit, validerSortie, variablesAttendues, type PromptDb } from "./prompts.js";

/*
 * Rejeu d'un CAS D'ESSAI sur une version de prompt (AGT-04). Comme
 * l'orchestrateur (seul composant qui parle aux modèles, ADR-005), il masque,
 * rend le prompt, appelle le fournisseur, valide la sortie au schéma du prompt
 * (AGT-02) et applique la garde-chiffres avec les chiffres du cas (ceux qu'un
 * moteur fournirait). Il ne crée AUCUNE demande ni génération : un essai ne
 * produit pas de contenu livrable. Les critères sont déterministes ; le
 * résultat ne garde que des codes de raison, jamais le texte produit.
 */

export type RaisonEchecCas =
  | "VARIABLES_MANQUANTES"
  | "VARIABLES_INCONNUES"
  | "ERREUR_FOURNISSEUR"
  | "SORTIE_NON_CONFORME"
  | "CHIFFRES_NON_VERIFIES"
  | "CONTENU_ATTENDU_ABSENT"
  | "CONTENU_INTERDIT_PRESENT"
  | "CHAMP_INATTENDU";

export interface ResultatCas {
  code: string;
  reussi: boolean;
  raisons: RaisonEchecCas[];
  tokens_entree: number;
  tokens_sortie: number;
}

const normaliser = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Réponse du fournisseur local pour un cas : le gabarit déterministe de la tâche. */
export function fournisseurLocalPourCas(prompt: PromptDb, cas: CasEssai): LlmProvider {
  return creerFournisseurLocal(
    () =>
      produireGabarit({
        tache: prompt.tache,
        schema: prompt.schema_sortie,
        variables: cas.variables,
        chiffres: cas.chiffres,
      }).texte,
  );
}

function controlerVariables(prompt: PromptDb, cas: CasEssai): RaisonEchecCas[] {
  const attendues = variablesAttendues(prompt);
  const raisons: RaisonEchecCas[] = [];
  if (attendues.some((v) => cas.variables[v] === undefined)) raisons.push("VARIABLES_MANQUANTES");
  if (Object.keys(cas.variables).some((v) => !attendues.includes(v))) {
    raisons.push("VARIABLES_INCONNUES");
  }
  return raisons;
}

function controlerCriteres(
  cas: CasEssai,
  texte: string,
  donnees: Record<string, unknown> | null,
  chiffresNonVerifies: boolean,
): RaisonEchecCas[] {
  const raisons: RaisonEchecCas[] = [];
  const t = normaliser(texte);
  if (cas.attendu.sans_chiffres_non_verifies && chiffresNonVerifies) {
    raisons.push("CHIFFRES_NON_VERIFIES");
  }
  if (cas.attendu.contient.some((m) => !t.includes(normaliser(m)))) {
    raisons.push("CONTENU_ATTENDU_ABSENT");
  }
  if (cas.attendu.ne_contient_pas.some((m) => t.includes(normaliser(m)))) {
    raisons.push("CONTENU_INTERDIT_PRESENT");
  }
  const champs = Object.entries(cas.attendu.champs);
  if (champs.length > 0 && (donnees === null || champs.some(([n, v]) => donnees[n] !== v))) {
    raisons.push("CHAMP_INATTENDU");
  }
  return raisons;
}

/** Rejoue un cas sur une version de prompt et un modèle, avec le fournisseur donné. */
export async function executerCasEvaluation(entree: {
  prompt: PromptDb;
  cas: CasEssai;
  modele: string;
  fournisseur: LlmProvider;
  cleApi: string;
}): Promise<ResultatCas> {
  const { prompt, cas } = entree;
  const echec = (raisons: RaisonEchecCas[], te = 0, ts = 0): ResultatCas => ({
    code: cas.code,
    reussi: raisons.length === 0,
    raisons,
    tokens_entree: te,
    tokens_sortie: ts,
  });
  const variables = controlerVariables(prompt, cas);
  if (variables.length > 0) return echec(variables);
  const masque = creerMasque([]);
  const valeurs: Record<string, string> = { chiffres: blocChiffres(cas.chiffres) };
  for (const [nom, v] of Object.entries(cas.variables)) valeurs[nom] = masque.masquer(v);
  const messages: MessageLlm[] = [
    { role: "system" as const, content: rendreGabarit(prompt.gabarit_systeme, valeurs) },
    { role: "user" as const, content: rendreGabarit(prompt.gabarit_utilisateur, valeurs) },
  ].filter((m) => m.content.trim() !== "");
  let rep;
  try {
    rep = await entree.fournisseur.completer({
      tache: prompt.tache,
      modele: entree.modele,
      messages,
      maxTokens: MAX_TOKENS_SORTIE[prompt.tache],
      formatJson: prompt.schema_sortie.type === "objet",
      cleApi: entree.cleApi,
    });
  } catch (error) {
    if (error instanceof ErreurLlm) return echec(["ERREUR_FOURNISSEUR"]);
    throw error;
  }
  const validee = validerSortie(prompt.schema_sortie, rep.texte);
  if (!validee) return echec(["SORTIE_NON_CONFORME"], rep.tokensEntree, rep.tokensSortie);
  const contexte = contexteGarde([
    ...Object.values(cas.variables),
    ...cas.chiffres.map((c) => `${c.libelle} ${c.valeur}`),
  ]);
  const garde = verifierChiffres(
    validee.texte,
    cas.chiffres.map((c) => c.valeur),
    contexte,
    masque,
  );
  return echec(
    controlerCriteres(cas, validee.texte, validee.donnees, garde.chiffresNonVerifies),
    rep.tokensEntree,
    rep.tokensSortie,
  );
}
