import type { CasEssai, SchemaSortie } from "@missionpilot/shared";
import { estLocal, type Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { ErreurLlm, type LlmProvider, type MessageLlm } from "./fournisseur.js";
import { creerFournisseurLocal } from "./fournisseur-local.js";
import { encadrerContenuClient, neutraliserContenuClient } from "./donnees-non-fiables.js";
import { blocChiffres, choixParMotsCles } from "./gabarits.js";
import { contexteGarde, verifierChiffres } from "./garde-chiffres.js";
import { creerMasque, jetonsDans, type Masque } from "./masquage.js";
import { MAX_TOKENS_SORTIE } from "./modeles.js";
import {
  extraireVariables,
  rendreGabarit,
  validerSortie,
  variablesAttendues,
  type PromptDb,
} from "./prompts.js";

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
 *
 * Le rejeu RÉEL (agents/evaluations-openrouter.ts) réutilise les MÊMES étapes, sans changer le
 * rejeu local : `preparerCasEvaluation` (masquage, chiffres, rendu ; avec `nonFiables`, chaîne de
 * l'orchestrateur : contenu client neutralisé puis encadré, AGT-07) et `jugerSortieCas` (schéma,
 * garde-chiffres, critères). L'appel, le coût et le plafond y sont gérés par le job.
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

/**
 * Variables d'un cas traitées comme DONNÉES NON FIABLES dans un rejeu RÉEL (AGT-07) : un jeu
 * d'essai porte du contenu possiblement client ; toute variable qui n'est pas dans le message
 * système (un contenu client n'entre jamais dans les consignes) est neutralisée puis encadrée,
 * comme pour un agent qui lit du contenu client.
 */
export function variablesNonFiablesEvaluation(prompt: PromptDb, cas: CasEssai): Set<string> {
  const systeme = new Set(extraireVariables(prompt.gabarit_systeme));
  return new Set(Object.keys(cas.variables).filter((v) => !systeme.has(v)));
}

/**
 * Variables d'un cas insérées dans le MESSAGE SYSTÈME (les consignes) du prompt : un rejeu RÉEL les
 * refuse, comme l'orchestrateur (« un contenu client n'entre jamais dans les consignes », AGT-07) ;
 * ces variables ne seraient ni encadrées ni neutralisées.
 */
export function variablesDansConsignes(prompt: PromptDb, cas: CasEssai): string[] {
  const systeme = new Set(extraireVariables(prompt.gabarit_systeme));
  return Object.keys(cas.variables).filter((v) => systeme.has(v));
}

export interface OptionsPreparationCas {
  /**
   * Rejeu RÉEL : chaîne de l'orchestrateur (libellés des chiffres masqués, variables non fiables
   * neutralisées puis encadrées). Absent : rejeu LOCAL historique, inchangé.
   */
  nonFiables?: ReadonlySet<string>;
}

export type CasPrepare =
  | { ok: false; raisons: RaisonEchecCas[] }
  | { ok: true; messages: MessageLlm[]; masque: Masque; caracteres: number };

/**
 * Prépare les messages d'un cas : contrôle des variables, masquage des données identifiantes,
 * bloc de chiffres (liste blanche du cas, construite par le code), rendu du prompt.
 */
export function preparerCasEvaluation(
  prompt: PromptDb,
  cas: CasEssai,
  options: OptionsPreparationCas = {},
): CasPrepare {
  const variables = controlerVariables(prompt, cas);
  if (variables.length > 0) return { ok: false, raisons: variables };
  // AUCUN terme sensible n'est connu d'un jeu d'essai (contrairement à une exécution d'agent, dont
  // les termes viennent de la mission) : le masque ne repère que les formats d'identifiants
  // (e-mail, téléphone, IBAN…). INTERDICTION de contenu client réel dans un jeu d'essai : il part
  // tel quel chez le fournisseur dans un rejeu réel ; seuls des textes fictifs ou anonymisés y ont leur place.
  const masque = creerMasque([]);
  const nonFiables = options.nonFiables;
  let chiffres = blocChiffres(cas.chiffres);
  if (nonFiables) {
    // Comme l'orchestrateur : avec un contenu client, les libellés des chiffres sont neutralisés.
    const libelle = (l: string) =>
      masque.masquer(nonFiables.size > 0 ? neutraliserContenuClient(l) : l);
    chiffres = blocChiffres(cas.chiffres.map((c) => ({ ...c, libelle: libelle(c.libelle) })));
  }
  const valeurs: Record<string, string> = { chiffres };
  for (const [nom, v] of Object.entries(cas.variables)) {
    valeurs[nom] = nonFiables?.has(nom)
      ? encadrerContenuClient(masque.masquer(neutraliserContenuClient(v)), nom)
      : masque.masquer(v);
  }
  const messages: MessageLlm[] = [
    { role: "system" as const, content: rendreGabarit(prompt.gabarit_systeme, valeurs) },
    { role: "user" as const, content: rendreGabarit(prompt.gabarit_utilisateur, valeurs) },
  ].filter((m) => m.content.trim() !== "");
  return {
    ok: true,
    messages,
    masque,
    caracteres: messages.reduce((n, m) => n + m.content.length, 0),
  };
}

export interface JugementCas {
  raisons: RaisonEchecCas[];
  /** La sortie est conforme au schéma du prompt (AGT-02) : l'appel a produit une réponse exploitable. */
  conforme: boolean;
}

/**
 * Critères d'un cas sur la sortie brute du modèle : schéma du prompt, garde-chiffres avec les
 * chiffres du cas, éléments exigés ou interdits, valeur des champs. Les MÊMES pour le rejeu local
 * et le rejeu réel ; le texte jugé est celui de la sortie masquée (jamais conservé).
 */
export function jugerSortieCas(
  prompt: PromptDb,
  cas: CasEssai,
  masque: Pick<Masque, "connait">,
  sortieBrute: string,
): JugementCas {
  const validee = validerSortie(prompt.schema_sortie, sortieBrute);
  if (!validee) return { raisons: ["SORTIE_NON_CONFORME"], conforme: false };
  // Le texte FIXE des gabarits est une entrée : ses années, dates et jetons d'exemple
  // (« [PERSONNE_1] » dans une consigne) ne sont pas inventés par la sortie.
  const gabarits = `${prompt.gabarit_systeme}
${prompt.gabarit_utilisateur}`;
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
  return {
    raisons: controlerCriteres(cas, validee.texte, validee.donnees, garde.chiffresNonVerifies),
    conforme: true,
  };
}

/** Rejoue un cas sur une version de prompt et un modèle, avec le fournisseur donné (local). */
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
  const prepare = preparerCasEvaluation(prompt, cas);
  if (!prepare.ok) return echec(prepare.raisons);
  let rep;
  try {
    rep = await entree.fournisseur.completer({
      tache: prompt.tache,
      modele: entree.modele,
      messages: prepare.messages,
      maxTokens: MAX_TOKENS_SORTIE[prompt.tache],
      formatJson: prompt.schema_sortie.type === "objet",
      cleApi: entree.cleApi,
    });
  } catch (error) {
    if (error instanceof ErreurLlm) return echec(["ERREUR_FOURNISSEUR"]);
    throw error;
  }
  const jugement = jugerSortieCas(prompt, cas, prepare.masque, rep.texte);
  return echec(jugement.raisons, rep.tokensEntree, rep.tokensSortie);
}
