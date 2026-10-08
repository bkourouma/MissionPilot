import { z } from "zod";
import {
  aPermission,
  chiffreContexteSchema,
  MESSAGE_CHIFFRES_SERVEUR,
  MESSAGE_ESSAI_SANS_MISSION,
  MESSAGE_SOURCE_MOTEUR_SERVEUR,
  sourceIaSchema,
  termeSensibleSchema,
  type ChiffreContexte,
  type SourceIa,
  type TacheGenerative,
  type TermeSensible,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { chiffrer, empreinte, trousseauDepuisConfig } from "../auth/chiffrement.js";
import type { Auth } from "../auth/contexte.js";
import type { Config } from "../config.js";
import type { Database, Db } from "../db/pool.js";
import { AppError, conflit, interdit, requeteInvalide } from "../errors.js";
import { exigerMissionVisible } from "../missions/acces.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import {
  enregistrerConsommation,
  estimerCoutAppel,
  etatPlafond,
  QUOTA_GENERATIONS_UTILISATEUR_JOUR,
  reserverAppel,
  type Consommation,
  type IssueConsommation,
} from "./couts.js";
import {
  ErreurLlm,
  estimerTokens,
  fournisseurDepuisConfig,
  type CodeErreurLlm,
  type EntreeJournalLlm,
  type LlmProvider,
  type MessageLlm,
} from "./fournisseur.js";
import { encadrerContenuClient, neutraliserContenuClient } from "./donnees-non-fiables.js";
import { blocChiffres, produireGabarit } from "./gabarits.js";
import { contexteGarde, verifierChiffres } from "./garde-chiffres.js";
import { creerMasque } from "./masquage.js";
import { MAX_TOKENS_SORTIE } from "./modeles.js";
import {
  alerterCleIllisible,
  lireParametres,
  modeleDe,
  plafondEffectif,
  resoudreCle,
  sourceCleDisponible,
  USAGE_ENTREE_IA,
  type SourceCle,
} from "./parametres.js";
import {
  assurerPromptsExemple,
  chargerPrompt,
  chargerPromptActif,
  extraireVariables,
  rendreGabarit,
  validerSortie,
  variablesAttendues,
  type PromptDb,
  type SortieValidee,
} from "./prompts.js";
import { verifierSources } from "./sources.js";

/*
 * ORCHESTRATEUR IA (ADR-003) : point d'entrée unique des services de conseil
 * qui veulent un contenu généré. Il est le seul à utiliser le fournisseur
 * (ia/fournisseur.ts).
 *
 * Circuit d'une génération :
 * 1. Préparation (transaction) : droit « ia.utiliser », prompt actif (version
 *    figée dans la demande), mission visible et non clôturée (jamais pour un
 *    prompt « exemple »), sources visibles, variables complètes, quota
 *    journalier de l'utilisateur, plafond mensuel (409 PLAFOND_IA_ATTEINT
 *    avant tout appel, sauf `repliSiPlafond`) ; en mode immédiat, le coût
 *    estimé est RÉSERVÉ dans cette même transaction (couts.ts). Empreinte de
 *    l'entrée (HMAC, jamais l'entrée en clair), journal d'audit sans contenu.
 * 2. Exécution : IA désactivée, sans clé, clé du cabinet illisible ou plafond
 *    atteint avec repli → gabarit déterministe (`gabarit: true`). Sinon :
 *    réservation (déjà faite en immédiat ; en file, transaction courte
 *    séparée, sous le verrou du plafond), masquage des données
 *    identifiantes, rendu du prompt, appel du fournisseur HORS transaction,
 *    validation Zod de la sortie (non conforme → gabarit, l'appel reste
 *    compté), GARDE-CHIFFRES sur la sortie masquée, démasquage local.
 * 3. Clôture (transaction) : réservation soldée, coût inscrit dans
 *    ia_consommations (estimé pour un délai dépassé ou une réponse
 *    illisible), version 1 « brouillon_ia » (ajout seul), alertes, journal.
 *    Une demande annulée pendant l'appel n'a pas de contenu ; son coût est
 *    compté.
 *
 * CHIFFRES : `contexteChiffres` (liste blanche de la garde-chiffres) et les
 * sources « moteur » ne viennent JAMAIS d'une requête HTTP : le code des
 * services les construit lui-même à partir de packages/engines avant
 * d'appeler `genererContenu` ou `mettreEnFile`. La route de test
 * (`exempleSeulement`) les refuse.
 *
 * Mode « file » : job `ia_generation` (ia/job.ts), entrée CHIFFRÉE dans la
 * charge du job et effacée à la fin ; les transactions de l'exécution sont
 * SÉPARÉES de celle du job (réservation et consommation visibles des autres
 * appels) ; reprise par le worker sur 429/5xx.
 */

export interface DependancesIa {
  config: Config;
  /** Fournisseur (défaut : OpenRouter d'après la configuration). */
  fournisseur?: LlmProvider;
  /** Journal des appels (sans contenu). */
  journal?: (entree: EntreeJournalLlm) => void;
  horloge?: () => Date;
}

export interface EntiteLiee {
  missionId?: string | null;
  /** Type et identifiant de l'objet métier décrit (« questionnaire », …). */
  type?: string | null;
  id?: string | null;
}

/** Demande de contenu d'un service (ou de la génération manuelle de test). */
export interface DemandeContenu {
  /** Tâche attendue : doit être celle du prompt (garde-fou de l'appelant). */
  tache?: TacheGenerative;
  promptNom: string;
  variables: Readonly<Record<string, string>>;
  /**
   * Chiffres CALCULÉS par les moteurs (packages/engines) par le code serveur
   * de l'appelant : seuls nombres que la sortie peut citer. Jamais repris
   * d'une requête HTTP.
   */
  contexteChiffres?: readonly ChiffreContexte[];
  /** Noms propres et termes à masquer avant envoi. */
  termesSensibles?: readonly TermeSensible[];
  /** Sources citées ; une source « moteur » est déclarée par le code serveur seul. */
  sources?: readonly SourceIa[];
  entite?: EntiteLiee;
  utilisateur: Auth;
  /** Plafond atteint : gabarit au lieu d'un refus 409. */
  repliSiPlafond?: boolean;
  /**
   * Génération manuelle de test (route HTTP) : seuls les prompts « exemple »,
   * sans chiffres de contexte ni source « moteur ».
   */
  exempleSeulement?: boolean;
  /**
   * AGT-07 : variables portant un contenu de CLIENT (document, réponse, message),
   * traitées comme DONNÉES NON FIABLES : masquées puis neutralisées et encadrées
   * (ia/donnees-non-fiables.ts) avant d'entrer dans le prompt envoyé au modèle.
   */
  variablesNonFiables?: readonly string[];
  /**
   * AGT-10 : mode dégradé imposé par l'appelant (plafond de mission atteint…) :
   * gabarit déterministe, aucun appel au modèle ni réservation.
   */
  modeDegrade?: boolean;
  /**
   * AGT-06 : contrôle de l'appelant exécuté DANS la transaction de préparation, avant la
   * création de la demande et la réservation de son coût (plafond de coût d'une mission, sous
   * verrou de la mission) ; peut refuser (erreur) ou imposer le mode dégradé (vrai).
   */
  controleAvantReservation?: (db: Db) => Promise<boolean>;
}

/** Entrée d'une génération, telle que chiffrée dans la charge du job. */
export const entreeIaSchema = z
  .object({
    variables: z.record(z.string(), z.string()),
    contexteChiffres: z.array(chiffreContexteSchema),
    termesSensibles: z.array(termeSensibleSchema),
    sources: z.array(sourceIaSchema),
    // Ajouts AGT (facultatifs : une charge de job plus ancienne reste lisible).
    variablesNonFiables: z.array(z.string()).optional(),
    modeDegrade: z.boolean().optional(),
  })
  .strict();
export type EntreeIa = z.infer<typeof entreeIaSchema>;

export type Transacteur = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export const plafondAtteint = () =>
  new AppError(
    409,
    "PLAFOND_IA_ATTEINT",
    "Plafond mensuel de coût IA atteint : génération refusée (le repli sur gabarit reste possible).",
  );

export const generationsSimultanees = () =>
  new AppError(
    429,
    "GENERATIONS_SIMULTANEES",
    "Trop de générations IA en cours pour le cabinet : réessayez dans un instant.",
  );

export const quotaUtilisateurAtteint = () =>
  new AppError(
    429,
    "QUOTA_IA_UTILISATEUR",
    `Quota de ${QUOTA_GENERATIONS_UTILISATEUR_JOUR} générations IA par jour atteint : réessayez demain.`,
  );

const TERMINAUX = ["terminee", "echec", "annulee"];

/** Erreurs du fournisseur après lesquelles l'appel a pu être facturé : compté au coût estimé. */
export const ISSUES_FACTURABLES: Partial<Record<CodeErreurLlm, IssueConsommation>> = {
  DELAI_DEPASSE: "delai_depasse",
  REPONSE_INVALIDE: "reponse_invalide",
  REPONSE_TROP_GRANDE: "reponse_invalide",
};

/** JSON canonique (clés triées) : même entrée → même empreinte. */
function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function caracteresEntree(prompt: PromptDb, entree: EntreeIa): number {
  return (
    prompt.gabarit_systeme.length +
    prompt.gabarit_utilisateur.length +
    Object.values(entree.variables).reduce((n, v) => n + v.length, 0) +
    blocChiffres(entree.contexteChiffres).length
  );
}

function entreeDe(d: DemandeContenu, sources: SourceIa[]): EntreeIa {
  return {
    variables: { ...d.variables },
    contexteChiffres: [...(d.contexteChiffres ?? [])],
    termesSensibles: [...(d.termesSensibles ?? [])],
    sources,
    // Clés absentes quand l'appelant ne les fournit pas : empreinte inchangée pour les autres.
    ...((d.variablesNonFiables ?? []).length > 0
      ? { variablesNonFiables: [...new Set(d.variablesNonFiables)].sort() }
      : {}),
    ...(d.modeDegrade ? { modeDegrade: true } : {}),
  };
}

const debutDuJour = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Quota journalier de l'utilisateur, sous un verrou propre à l'utilisateur (demandes simultanées). */
async function exigerQuotaUtilisateur(db: Db, auth: Auth, maintenant: Date): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `ia_quota:${auth.utilisateurId}`,
  ]);
  const debut = debutDuJour(maintenant);
  const r = await db.query(
    `SELECT count(*)::int AS n FROM ia_demandes
     WHERE demandeur_id = $1 AND cree_le >= $2 AND cree_le < $3`,
    [auth.utilisateurId, debut, new Date(debut.getTime() + 86_400_000)],
  );
  if ((r.rows[0].n as number) >= QUOTA_GENERATIONS_UTILISATEUR_JOUR) {
    throw quotaUtilisateurAtteint();
  }
}

/** Étape 1 : contrôles et création de la demande, dans la transaction de l'appelant. */
async function preparer(
  db: Db,
  deps: DependancesIa,
  d: DemandeContenu,
  mode: "file" | "immediat",
  maintenant: Date,
): Promise<{ demandeId: string; entree: EntreeIa }> {
  const auth = d.utilisateur;
  if (!aPermission(auth.roles, "ia.utiliser")) throw interdit();
  const entiteType = d.entite?.type ?? null;
  const entiteId = d.entite?.id ?? null;
  if ((entiteType === null) !== (entiteId === null)) {
    throw requeteInvalide("Entité liée : type et identifiant vont ensemble.");
  }
  if (d.exempleSeulement) {
    // Défense en profondeur (la route les refuse déjà) : la liste blanche vient du serveur.
    if ((d.contexteChiffres ?? []).length > 0) throw requeteInvalide(MESSAGE_CHIFFRES_SERVEUR);
    if ((d.sources ?? []).some((s) => s.type === "moteur")) {
      throw requeteInvalide(MESSAGE_SOURCE_MOTEUR_SERVEUR);
    }
  }
  await assurerPromptsExemple(db, auth.cabinetId);
  const prompt = await chargerPromptActif(db, d.promptNom);
  if (prompt.tache === ("embedding" as string)) {
    throw requeteInvalide("Ce prompt ne produit pas de contenu.");
  }
  if (d.tache && prompt.tache !== d.tache) {
    throw requeteInvalide(`Le prompt « ${prompt.nom} » sert la tâche ${prompt.tache}.`);
  }
  if (d.exempleSeulement && !prompt.exemple) {
    throw requeteInvalide("Seuls les prompts « exemple » se testent par la génération manuelle.");
  }
  const missionId = d.entite?.missionId ?? null;
  if (missionId) {
    // Un essai n'est ni rattaché à une mission, ni compté dans son coût.
    if (prompt.exemple) throw requeteInvalide(MESSAGE_ESSAI_SANS_MISSION);
    const mission = await exigerMissionVisible(db, auth, missionId);
    if (mission.statut === "cloturee") {
      throw conflit("La mission est clôturée : aucune génération ne s'y rattache.");
    }
  }
  const sources = await verifierSources(db, auth, d.sources ?? []);
  const attendues = variablesAttendues(prompt);
  const manquantes = attendues.filter((v) => d.variables[v] === undefined);
  const inconnues = Object.keys(d.variables).filter((v) => !attendues.includes(v));
  if (manquantes.length > 0)
    throw requeteInvalide(`Variables manquantes : ${manquantes.join(", ")}.`);
  if (inconnues.length > 0) throw requeteInvalide(`Variables inconnues : ${inconnues.join(", ")}.`);
  const nonFiablesInconnues = (d.variablesNonFiables ?? []).filter((v) => !attendues.includes(v));
  if (nonFiablesInconnues.length > 0) {
    throw requeteInvalide(`Variables non fiables inconnues : ${nonFiablesInconnues.join(", ")}.`);
  }
  // AGT-07 : un contenu client n'entre jamais dans les consignes (message système).
  const systeme = extraireVariables(prompt.gabarit_systeme);
  if ((d.variablesNonFiables ?? []).some((v) => systeme.includes(v))) {
    throw requeteInvalide("Un contenu client ne peut pas figurer dans les consignes du prompt.");
  }
  await exigerQuotaUtilisateur(db, auth, maintenant);
  const modeDegrade =
    (d.modeDegrade ?? false) ||
    (d.controleAvantReservation ? await d.controleAvantReservation(db) : false);

  const entree = entreeDe({ ...d, modeDegrade }, sources);
  const params = await lireParametres(db);
  const source =
    params.ia_activee && !modeDegrade ? sourceCleDisponible(params, deps.config) : null;
  const estimation =
    source === null
      ? 0
      : estimerCoutAppel(
          modeleDe(params, prompt.tache),
          caracteresEntree(prompt, entree),
          MAX_TOKENS_SORTIE[prompt.tache],
        );
  const plafond = plafondEffectif(params, deps.config, source);
  if (source !== null && mode === "file" && !d.repliSiPlafond) {
    // En file : refus précoce ; la réservation se fait à l'exécution du job.
    const etat = await etatPlafond(db, auth.cabinetId, plafond, maintenant, estimation);
    if (etat.atteint) throw plafondAtteint();
  }

  const t = trousseauDepuisConfig(deps.config);
  const r = await db.query(
    `INSERT INTO ia_demandes (cabinet_id, tache, prompt_id, prompt_nom, prompt_version, mission_id,
       entite_type, entite_id, demandeur_id, statut, progression, repli_si_plafond,
       entree_empreinte, entree_cle_version, entree_champs, cree_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
    [
      auth.cabinetId,
      prompt.tache,
      prompt.id,
      prompt.nom,
      prompt.version,
      missionId,
      entiteType,
      entiteId,
      auth.utilisateurId,
      mode === "file" ? "en_file" : "en_cours",
      mode === "file" ? 0 : 10,
      d.repliSiPlafond ?? false,
      empreinte(t, USAGE_ENTREE_IA, t.versionActuelle, canonique(entree)),
      t.versionActuelle,
      [
        ...Object.keys(entree.variables).sort(),
        ...(entree.contexteChiffres.length > 0 ? ["contexte_chiffres"] : []),
        ...(entree.termesSensibles.length > 0 ? ["termes_sensibles"] : []),
      ],
      maintenant,
    ],
  );
  const demandeId = r.rows[0].id as string;
  if (source !== null && mode === "immediat") {
    // Vérification ET réservation dans la même transaction, sous le verrou du plafond.
    const reservation = await reserverAppel(db, {
      cabinetId: auth.cabinetId,
      demandeId,
      estimation,
      plafond,
      maintenant,
    });
    if (reservation.statut === "plafond" && !d.repliSiPlafond) throw plafondAtteint();
    if (reservation.statut === "simultanees") throw generationsSimultanees();
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "demande_generation_ia",
    entite: "ia_demande",
    entiteId: demandeId,
    // Jamais le contenu : prompt, tâche, entité et nombre d'éléments seulement.
    details: {
      prompt: prompt.nom,
      version: prompt.version,
      tache: prompt.tache,
      mission_id: missionId,
      mode,
      chiffres: entree.contexteChiffres.length,
      termes_sensibles: entree.termesSensibles.length,
    },
  });
  return { demandeId, entree };
}

export interface ResultatExecution {
  statut: "terminee" | "echec" | "annulee" | "deja_terminee";
  notifications: (NotificationCreee | null)[];
}

type RaisonGabarit =
  | "ia_desactivee"
  | "cle_absente"
  | "cle_illisible"
  | "plafond"
  | "sortie_invalide"
  | "mode_degrade";

const solderParDemande = (db: Db, demandeId: string) =>
  db.query("DELETE FROM ia_reservations WHERE demande_id = $1", [demandeId]);

/**
 * Étapes 2 et 3, en transactions COURTES successives (`transacteur`), jamais
 * dans une transaction ouverte pendant l'appel : réservation et consommation
 * sont visibles des autres appels. Lève l'erreur (le job sera repris) si
 * elle est réessayable et que `derniereTentative` est faux, après avoir soldé
 * la réservation et inscrit l'éventuel coût.
 */
export async function executerDemande(
  transacteur: Transacteur,
  deps: DependancesIa,
  cabinetId: string,
  demandeId: string,
  entree: EntreeIa,
  options: { derniereTentative: boolean },
): Promise<ResultatExecution> {
  const maintenant = (deps.horloge ?? (() => new Date()))();
  const a = await transacteur(async (db) => {
    const r = await db.query(
      "SELECT statut, mission_id, prompt_id, demandeur_id, repli_si_plafond FROM ia_demandes WHERE id = $1",
      [demandeId],
    );
    const dem = r.rows[0];
    if (!dem || TERMINAUX.includes(dem.statut as string)) return null;
    const prompt = await chargerPrompt(db, dem.prompt_id as string);
    const params = await lireParametres(db);
    const modele = modeleDe(params, prompt.tache);
    const estimation = estimerCoutAppel(
      modele,
      caracteresEntree(prompt, entree),
      MAX_TOKENS_SORTIE[prompt.tache],
    );
    let raison: RaisonGabarit | null = null;
    let erreurCode: string | null = null;
    let cle: { cle: string; source: SourceCle } | null = null;
    let plafond = params.plafond_mensuel_micro_usd;
    if (entree.modeDegrade) {
      raison = "mode_degrade";
    } else if (!params.ia_activee) {
      raison = "ia_desactivee";
    } else {
      const resolue = await resoudreCle(db, deps.config, cabinetId);
      if (resolue.statut === "absente") raison = "cle_absente";
      else if (resolue.statut === "illisible") raison = "cle_illisible";
      else {
        plafond = plafondEffectif(params, deps.config, resolue.source);
        const reservation = await reserverAppel(db, {
          cabinetId,
          demandeId,
          estimation,
          plafond,
          maintenant,
        });
        if (reservation.statut === "reservee") {
          cle = { cle: resolue.cle, source: resolue.source };
        } else if (reservation.statut === "plafond") {
          if (dem.repli_si_plafond) raison = "plafond";
          else erreurCode = "PLAFOND_IA_ATTEINT";
        } else {
          // Trop d'appels en cours : le job est repris plus tard ; à la dernière tentative, échec.
          if (!options.derniereTentative) throw generationsSimultanees();
          erreurCode = "GENERATIONS_SIMULTANEES";
        }
      }
    }
    return {
      missionId: (dem.mission_id as string | null) ?? null,
      demandeurId: dem.demandeur_id as string,
      prompt,
      modele,
      plafond,
      cle,
      raison,
      erreurCode,
    };
  });
  if (!a) return { statut: "deja_terminee", notifications: [] };

  const { prompt } = a;
  let raison: RaisonGabarit | null = a.raison;
  let erreurCode: string | null = a.erreurCode;
  let sortie: SortieValidee | null = null;
  let trace: {
    modele: string;
    dureeMs: number;
    tokensEntree: number;
    tokensSortie: number;
  } | null = null;
  let consommation: Consommation | null = null;
  let garde = { chiffresNonVerifies: false, nombresNonVerifies: [] as string[] };
  const listeBlanche = entree.contexteChiffres.map((c) => c.valeur);
  const contexte = contexteGarde([
    ...Object.values(entree.variables),
    ...entree.contexteChiffres.map((c) => `${c.libelle} ${c.valeur}`),
  ]);
  const gabarit = () =>
    produireGabarit({
      tache: prompt.tache,
      schema: prompt.schema_sortie,
      variables: entree.variables,
      chiffres: entree.contexteChiffres,
    });

  if (!erreurCode && !raison && a.cle) {
    const masque = creerMasque(entree.termesSensibles);
    const nonFiables = new Set(entree.variablesNonFiables ?? []);
    // Avec un contenu client, les libellés des chiffres (qui peuvent reprendre un nom saisi par
    // le client) sont neutralisés eux aussi ; les valeurs viennent des moteurs.
    const libelle = (l: string) =>
      masque.masquer(nonFiables.size > 0 ? neutraliserContenuClient(l) : l);
    const chiffresMasques = entree.contexteChiffres.map((c) => ({
      ...c,
      libelle: libelle(c.libelle),
    }));
    const valeurs: Record<string, string> = { chiffres: blocChiffres(chiffresMasques) };
    for (const [nom, v] of Object.entries(entree.variables)) {
      // AGT-07 : un contenu client est NEUTRALISÉ d'abord (un terme sensible coupé par un
      // caractère invisible échapperait sinon au masque), puis masqué, puis encadré.
      valeurs[nom] = nonFiables.has(nom)
        ? encadrerContenuClient(masque.masquer(neutraliserContenuClient(v)), nom)
        : masque.masquer(v);
    }
    const messages: MessageLlm[] = [
      { role: "system" as const, content: rendreGabarit(prompt.gabarit_systeme, valeurs) },
      { role: "user" as const, content: rendreGabarit(prompt.gabarit_utilisateur, valeurs) },
    ].filter((m) => m.content.trim() !== "");
    const fournisseur = deps.fournisseur ?? fournisseurDepuisConfig(deps.config, deps.journal);
    const base = {
      cabinetId,
      demandeId,
      missionId: a.missionId,
      tache: prompt.tache,
      modele: a.modele,
      sourceCle: a.cle.source,
    };
    try {
      const rep = await fournisseur.completer({
        tache: prompt.tache,
        modele: a.modele,
        messages,
        maxTokens: MAX_TOKENS_SORTIE[prompt.tache],
        formatJson: prompt.schema_sortie.type === "objet",
        cleApi: a.cle.cle,
      });
      const validee = validerSortie(prompt.schema_sortie, rep.texte);
      trace = {
        modele: rep.modele,
        dureeMs: rep.dureeMs,
        tokensEntree: rep.tokensEntree,
        tokensSortie: rep.tokensSortie,
      };
      consommation = {
        ...base,
        issue: validee ? "succes" : "sortie_invalide",
        tokensEntree: rep.tokensEntree,
        tokensSortie: rep.tokensSortie,
        dureeMs: rep.dureeMs,
      };
      if (validee) {
        // Garde sur la sortie MASQUÉE : seuls les jetons de CE masque sont ignorés.
        garde = verifierChiffres(validee.texte, listeBlanche, contexte, masque);
        sortie = {
          texte: masque.demasquer(validee.texte),
          donnees: validee.donnees ? masque.demasquerValeur(validee.donnees) : null,
        };
      } else {
        raison = "sortie_invalide";
      }
    } catch (error) {
      const issue = error instanceof ErreurLlm ? ISSUES_FACTURABLES[error.code] : undefined;
      if (issue) {
        // L'appel a pu être facturé sans réponse exploitable : coût ESTIMÉ (jetons estimés + plafond de sortie).
        consommation = {
          ...base,
          issue,
          tokensEntree: estimerTokens(caracteresEntree(prompt, entree)),
          tokensSortie: MAX_TOKENS_SORTIE[prompt.tache],
          dureeMs: 0,
        };
      }
      if (!(error instanceof ErreurLlm) || (error.reessayable && !options.derniereTentative)) {
        // Appel abandonné (reprise du job, erreur inattendue) : réservation soldée, coût inscrit.
        const aInscrire = consommation;
        await transacteur(async (db) => {
          await solderParDemande(db, demandeId);
          if (aInscrire) await enregistrerConsommation(db, aInscrire, a.plafond, maintenant);
        }).catch(() => undefined);
        throw error;
      }
      erreurCode = error.code;
    }
  }
  if (!erreurCode && !sortie) {
    sortie = gabarit();
    garde = verifierChiffres(sortie.texte, listeBlanche, contexte);
  }

  return transacteur(async (db) => {
    const notifications: (NotificationCreee | null)[] = [];
    const maj = await db.query(
      `UPDATE ia_demandes SET statut = $2, progression = 100, termine_le = $3, erreur_code = $4
       WHERE id = $1 AND statut IN ('en_file', 'en_cours') RETURNING id`,
      [demandeId, erreurCode ? "echec" : "terminee", maintenant, erreurCode],
    );
    const active = maj.rows[0] !== undefined;
    await solderParDemande(db, demandeId);
    let cout = 0;
    if (consommation) {
      const annulee =
        !active && (consommation.issue === "succes" || consommation.issue === "sortie_invalide");
      const c = await enregistrerConsommation(
        db,
        { ...consommation, issue: annulee ? "annulee" : consommation.issue },
        a.plafond,
        maintenant,
      );
      cout = c.cout;
      notifications.push(...c.notifications);
    }
    if (a.raison === "cle_illisible")
      notifications.push(...(await alerterCleIllisible(db, cabinetId)));
    if (!active) return { statut: "annulee" as const, notifications };
    if (erreurCode || !sortie) {
      await journaliser(db, {
        cabinetId,
        utilisateurId: null,
        action: "echec_generation_ia",
        entite: "ia_demande",
        entiteId: demandeId,
        details: { code: erreurCode, modele: a.modele },
      });
      return { statut: "echec" as const, notifications };
    }
    const fournisseurNom = raison ? "gabarit" : "openrouter";
    await db.query(
      `INSERT INTO ia_generations (cabinet_id, demande_id, version, statut_contenu, fournisseur,
         modele, duree_ms, tokens_entree, tokens_sortie, cout_micro_usd, texte, donnees, sources,
         gabarit, chiffres_non_verifies, nombres_non_verifies, auteur_id, cree_le)
       VALUES ($1, $2, 1, 'brouillon_ia', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        cabinetId,
        demandeId,
        fournisseurNom,
        trace?.modele ?? null,
        trace?.dureeMs ?? null,
        trace?.tokensEntree ?? null,
        trace?.tokensSortie ?? null,
        cout,
        sortie.texte,
        sortie.donnees === null ? null : JSON.stringify(sortie.donnees),
        JSON.stringify(entree.sources),
        raison !== null,
        garde.chiffresNonVerifies,
        JSON.stringify(garde.nombresNonVerifies),
        a.demandeurId,
        maintenant,
      ],
    );
    await journaliser(db, {
      cabinetId,
      utilisateurId: null,
      action: "generation_ia",
      entite: "ia_demande",
      entiteId: demandeId,
      // Traçabilité sans contenu : fournisseur, modèle, jetons, durée, repli, garde.
      details: {
        fournisseur: fournisseurNom,
        modele: trace?.modele ?? null,
        source_cle: a.cle?.source ?? null,
        tokens_entree: trace?.tokensEntree ?? null,
        tokens_sortie: trace?.tokensSortie ?? null,
        duree_ms: trace?.dureeMs ?? null,
        gabarit: raison,
        chiffres_non_verifies: garde.chiffresNonVerifies,
      },
    });
    return { statut: "terminee" as const, notifications };
  });
}

/**
 * Génération IMMÉDIATE : préparation (avec réservation), appel hors
 * transaction, clôture. Renvoie l'identifiant de la demande et les
 * notifications à envoyer.
 */
export async function genererContenu(
  database: Database,
  deps: DependancesIa,
  d: DemandeContenu,
): Promise<{ demandeId: string; resultat: ResultatExecution }> {
  const maintenant = (deps.horloge ?? (() => new Date()))();
  const { demandeId, entree } = await database.withTenant(d.utilisateur.cabinetId, (db) =>
    preparer(db, deps, d, "immediat", maintenant),
  );
  try {
    const resultat = await executerDemande(
      (fn) => database.withTenant(d.utilisateur.cabinetId, fn),
      deps,
      d.utilisateur.cabinetId,
      demandeId,
      entree,
      { derniereTentative: true },
    );
    return { demandeId, resultat };
  } catch (error) {
    // Erreur inattendue : la demande ne reste pas « en cours », sa réservation est soldée.
    await database
      .withTenant(d.utilisateur.cabinetId, async (db) => {
        await db.query(
          `UPDATE ia_demandes SET statut = 'echec', progression = 100, termine_le = now(),
             erreur_code = 'ERREUR_INTERNE' WHERE id = $1 AND statut IN ('en_file', 'en_cours')`,
          [demandeId],
        );
        await solderParDemande(db, demandeId);
      })
      .catch(() => undefined);
    throw error;
  }
}

export const TYPE_JOB_IA = "ia_generation";
export const TENTATIVES_IA = 3;

/** Charge d'un job de génération : identifiant de la demande et entrée CHIFFRÉE. */
export const chargeJobIaSchema = z
  .object({ demande_id: z.string().uuid(), v: z.number().int().positive(), d: z.string().min(1) })
  .strict();

export const aadEntree = (cabinetId: string, demandeId: string) =>
  `ia_entree:${cabinetId}:${demandeId}`;

/**
 * Génération EN FILE (job `ia_generation`), dans la transaction de
 * l'appelant : la demande et son job naissent ensemble. Progression lisible
 * par GET /api/ia/generations/:id.
 */
export async function mettreEnFile(
  db: Db,
  deps: DependancesIa,
  d: DemandeContenu,
): Promise<string> {
  const maintenant = (deps.horloge ?? (() => new Date()))();
  const { demandeId, entree } = await preparer(db, deps, d, "file", maintenant);
  const t = trousseauDepuisConfig(deps.config);
  const c = chiffrer(
    t,
    USAGE_ENTREE_IA,
    Buffer.from(JSON.stringify(entree), "utf8"),
    aadEntree(d.utilisateur.cabinetId, demandeId),
  );
  const job = await db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, tentatives_max, execute_a)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      d.utilisateur.cabinetId,
      TYPE_JOB_IA,
      JSON.stringify({ demande_id: demandeId, v: c.version, d: c.donnees.toString("base64") }),
      TENTATIVES_IA,
      maintenant,
    ],
  );
  await db.query("UPDATE ia_demandes SET job_id = $2 WHERE id = $1", [demandeId, job.rows[0].id]);
  return demandeId;
}
