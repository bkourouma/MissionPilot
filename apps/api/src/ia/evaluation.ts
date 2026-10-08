import type { CasEssai, SchemaSortie } from "@missionpilot/shared";
import { estLocal, type Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { ErreurLlm, type LlmProvider, type MessageLlm } from "./fournisseur.js";
import { creerFournisseurLocal } from "./fournisseur-local.js";
import { blocChiffres, choixParMotsCles } from "./gabarits.js";
import { contexteGarde, verifierChiffres } from "./garde-chiffres.js";
import { creerMasque, jetonsDans } from "./masquage.js";
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
 *
 * FOURNISSEUR LOCAL D'ÉVALUATION (`reponseLocaleEvaluation`) : il répond à
 * partir du TEXTE des messages rendus (consignes système et demande, variables
 * insérées), par un ÉCHO déterministe : un gabarit altéré (consigne retirée,
 * variable débranchée, texte ajouté) change la réponse, et les critères du jeu
 * (« contient », « ne contient pas », valeur d'un champ « choix » lue par
 * mots-clés dans la demande, garde-chiffres) le détectent.
 *
 * Ce qu'une évaluation LOCALE réussie prouve : le prompt se rend avec les
 * variables du jeu ; les messages envoyés contiennent ce que les critères
 * exigent (consignes de sécurité, données, chiffres des moteurs) et rien de ce
 * qu'ils interdisent ; aucun nombre hors liste blanche n'est introduit par le
 * gabarit ; la sortie structurée est constructible au schéma. Ce qu'elle ne
 * prouve PAS : la qualité rédactionnelle d'un modèle, qu'un modèle suive les
 * consignes, sa résistance à l'injection, ni la justesse du sens. C'est
 * pourquoi, en production, seule une évaluation sur `openrouter` compte pour
 * activer (réglage `app.evaluation_locale_admise`, migration 0265).
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

/* ----- Fournisseur local d'évaluation et règle de production ----- */

/** Réglage de transaction qui admet une évaluation locale (migration 0265). */
export const REGLAGE_EVALUATION_LOCALE = "app.evaluation_locale_admise";

/** Une évaluation locale suffit-elle ? Seulement hors production (développement, test). */
export function evaluationLocaleAdmise(config: Pick<Config, "NODE_ENV">): boolean {
  return estLocal(config.NODE_ENV);
}

/**
 * Pose, pour la transaction courante, le réglage qui admet une évaluation locale — hors
 * production seulement. À appeler avant toute activation de prompt, tout choix de modèle et
 * toute exécution d'agent ; sans lui, la base n'admet qu'une évaluation `openrouter`.
 */
export async function reglerEvaluationLocale(
  db: Db,
  config: Pick<Config, "NODE_ENV"> | undefined,
): Promise<void> {
  if (config && evaluationLocaleAdmise(config)) {
    await db.query("SELECT set_config($1, 'on', true)", [REGLAGE_EVALUATION_LOCALE]);
  }
}

export const ENTETE_EVALUATION_LOCALE =
  "Réponse locale déterministe d'évaluation : écho des messages reçus.";

const tronquer = (t: string, max: number) => (t.length > max ? t.slice(0, max) : t);

/** Écho des messages RENDUS : consignes (système), puis demande (utilisateur). */
export function echoMessages(messages: readonly MessageLlm[]): string {
  const consignes = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const demande = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n");
  return [
    ENTETE_EVALUATION_LOCALE,
    `CONSIGNES :\n${consignes.trim() || "(aucune)"}`,
    `DEMANDE :\n${demande.trim() || "(aucune)"}`,
  ].join("\n\n");
}

/**
 * Réponse du fournisseur local d'évaluation, fonction du SEUL texte des messages : texte →
 * écho ; objet → champs texte = écho, choix = mot-clé le plus cité dans la demande, booléens
 * à faux, listes vides.
 */
export function reponseLocaleEvaluation(
  schema: SchemaSortie,
  messages: readonly MessageLlm[],
): string {
  const echo = echoMessages(messages);
  if (schema.type === "texte") return tronquer(echo, schema.longueur_max ?? 20_000);
  const demande = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n");
  const donnees: Record<string, unknown> = {};
  for (const [nom, champ] of Object.entries(schema.champs)) {
    switch (champ.type) {
      case "texte":
        donnees[nom] = tronquer(echo, champ.longueur_max ?? 5000);
        break;
      case "liste_texte":
        donnees[nom] = [];
        break;
      case "booleen":
        donnees[nom] = false;
        break;
      case "choix":
        donnees[nom] = choixParMotsCles(champ, demande);
        break;
    }
  }
  return JSON.stringify(donnees);
}

/** Fournisseur local d'un cas : réponse fonction des messages rendus (voir ci-dessus). */
export function fournisseurLocalPourCas(prompt: PromptDb, _cas: CasEssai): LlmProvider {
  return creerFournisseurLocal((requete) =>
    reponseLocaleEvaluation(prompt.schema_sortie, requete.messages),
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
  // Le texte FIXE des gabarits est une entrée : ses années, dates et jetons d'exemple
  // (« [PERSONNE_1] » dans une consigne) ne sont pas inventés par la sortie.
  const gabarits = `${prompt.gabarit_systeme}\n${prompt.gabarit_utilisateur}`;
  const jetonsGabarit = new Set(jetonsDans(gabarits));
  const contexte = contexteGarde([
    gabarits,
    ...Object.values(cas.variables),
    ...cas.chiffres.map((c) => `${c.libelle} ${c.valeur}`),
  ]);
  const garde = verifierChiffres(
    validee.texte,
    cas.chiffres.map((c) => c.valeur),
    contexte,
    { connait: (j) => masque.connait(j) || jetonsGabarit.has(j) },
  );
  return echec(
    controlerCriteres(cas, validee.texte, validee.donnees, garde.chiffresNonVerifies),
    rep.tokensEntree,
    rep.tokensSortie,
  );
}
