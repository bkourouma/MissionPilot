/**
 * Paramètres IA du cabinet (ADR-003) : état et mode, clé OpenRouter, modèles par tâche, plafond
 * mensuel, prompts versionnés, coûts et messages d'erreur. Logique pure, testée dans
 * `ia.test.ts` ; l'API reste seule juge des droits et des règles.
 *
 * La clé API n'existe que dans l'état du formulaire qui la saisit : jamais dans le stockage du
 * navigateur, une URL ou un journal, jamais renvoyée par l'API (`cle_configuree` seulement).
 */
import {
  aPermission,
  cleApiIaSchema,
  PLAFOND_IA_MAX_MICRO_USD,
  SEUILS_ALERTE_PLAFOND_IA,
  TACHE_IA_LIBELLES,
  VARIABLE_CHIFFRES,
  type Role,
  type SchemaSortie,
  type TacheIa,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import {
  validerReconfirmation,
  type ChampConfirmation,
  type ChargeFacteur,
  type SaisieConfirmation,
} from "./double-authentification";
import type { Devise } from "./format";
import { lireNombre, type Resultat } from "./saisie";

// --- Paramètres ------------------------------------------------------------------------------

export type SourceCleIa = "cabinet" | "plateforme";
export type ModeIa = "ia" | "gabarit";

export interface ModeleTacheIa {
  tache: TacheIa;
  modele: string;
  recommande: string;
  personnalise: boolean;
}

/**
 * GET/PUT /api/ia/parametres. L'IA est désactivée (`ia_activee` faux, `mode` « gabarit ») tant
 * que le cabinet ne l'a pas activée explicitement. Plafonds, modèles autorisés et dates :
 * présents avec « ia.configurer » seulement. La réponse ne dit pas si la clé du cabinet est
 * lisible : seul le test de connexion (409 CLE_IA_ILLISIBLE) et l'alerte aux associés le
 * signalent.
 */
export interface ParametresIa {
  fournisseur: string;
  ia_activee: boolean;
  cle_configuree: boolean;
  cle_plateforme_disponible: boolean;
  source_cle: SourceCleIa | null;
  mode: ModeIa;
  modeles: ModeleTacheIa[];
  plafond_mensuel_micro_usd?: number;
  /** Plafond fixé par l'opérateur pour les appels faits avec la clé de la plateforme. */
  plafond_plateforme_micro_usd?: number;
  /**
   * Plafond réellement appliqué ce mois : celui du cabinet, borné par celui de l'opérateur quand
   * la clé de la plateforme est utilisée.
   */
  plafond_effectif_micro_usd?: number;
  /** Liste FERMÉE des modèles qu'un cabinet peut choisir (tarif connu de l'API). */
  modeles_autorises?: string[];
  cle_modifiee_le?: string | null;
  modifie_par?: string | null;
  modifie_le?: string | null;
}

/** POST /api/ia/parametres/tester. */
export interface ResultatTestIa {
  ok: boolean;
  tache: TacheIa;
  modele?: string;
  modele_servi?: string | null;
  source_cle?: SourceCleIa;
  duree_ms?: number;
  tokens_entree?: number;
  tokens_sortie?: number;
}

export const SOURCE_CLE_LIBELLES: Record<SourceCleIa, string> = {
  cabinet: "Clé du cabinet",
  plateforme: "Clé de la plateforme MissionPilot",
};

export const libelleSourceCle = (s: SourceCleIa | null) =>
  s ? SOURCE_CLE_LIBELLES[s] : "Aucune clé disponible";

/** « … a répondu avec la clé du cabinet ». */
export const SOURCE_CLE_PHRASES: Record<SourceCleIa, string> = {
  cabinet: "la clé du cabinet",
  plateforme: "la clé de la plateforme MissionPilot",
};

/** Mode effectif : texte, tonalité et explication (la couleur ne porte jamais seule le sens). */
export function presentationMode(p: Pick<ParametresIa, "mode" | "ia_activee" | "source_cle">): {
  libelle: string;
  tonalite: TonaliteStatut;
  explication: string;
} {
  if (p.mode === "ia") {
    return {
      libelle: "IA active",
      tonalite: "succes",
      explication:
        "Les contenus sont rédigés par le modèle choisi pour chaque tâche, puis relus et validés par un consultant.",
    };
  }
  const raison = !p.ia_activee
    ? "L'IA est désactivée tant que le cabinet ne l'a pas activée (bouton « Activer l'IA »)."
    : "Aucune clé API n'est disponible.";
  return {
    libelle: "Mode gabarit",
    tonalite: "neutre",
    explication: `${raison} Les contenus sont produits par des gabarits déterministes, sans appel à un modèle, et suivent la même validation humaine.`,
  };
}

/** Message après activation ou désactivation : sans clé disponible, l'IA activée reste en gabarit. */
export function messageActivation(activer: boolean, source: SourceCleIa | null): string {
  if (!activer) return "IA désactivée : les contenus seront produits par les gabarits.";
  return source
    ? "IA activée pour le cabinet."
    : "IA activée, mais aucune clé API n'est disponible : les contenus restent produits par les gabarits jusqu'à l'enregistrement d'une clé.";
}

// --- Clé API ---------------------------------------------------------------------------------

export const ERREUR_CLE_VIDE = "Saisissez la clé API fournie par OpenRouter.";
export const ERREUR_CLE_FORMAT =
  "Clé API : 20 à 200 lettres, chiffres, tirets ou tirets bas, sans espace.";

/** Clé saisie (copier-coller : espaces de bord retirés). */
export function validerCleApi(saisie: string): Resultat<{ cle_api: string }, "cle_api"> {
  const cle = saisie.trim();
  if (cle === "") return { ok: false, erreurs: { cle_api: ERREUR_CLE_VIDE } };
  const r = cleApiIaSchema.safeParse(cle);
  if (!r.success) return { ok: false, erreurs: { cle_api: ERREUR_CLE_FORMAT } };
  return { ok: true, charge: { cle_api: r.data } };
}

// --- Plafond mensuel (micro-dollars US) ------------------------------------------------------

const MICRO_PAR_USD = 1_000_000;
const NBSP = "\u00a0";

/** 8100 µUSD → « 0,0081 $US » ; 50 000 000 → « 50,00 $US ». Mise en forme seulement. */
export function formaterMicroUsd(micro: number | null | undefined): string {
  if (typeof micro !== "number" || !Number.isFinite(micro)) return "—";
  const usd = micro / MICRO_PAR_USD;
  const petit = usd !== 0 && Math.abs(usd) < 0.01;
  const nombre = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: petit ? 6 : 2,
  }).format(usd);
  return `${nombre}${NBSP}$US`;
}

/** Plafond de l'API → texte modifiable (« 50 », « 49,9 »). */
export function plafondVersSaisie(micro: number | null | undefined): string {
  if (typeof micro !== "number" || !Number.isFinite(micro)) return "";
  return String(micro / MICRO_PAR_USD).replace(".", ",");
}

export const ERREUR_PLAFOND_VIDE =
  "Saisissez un plafond en dollars US (0 bloque tout appel facturé).";
export const ERREUR_PLAFOND_FORMAT =
  "Plafond invalide : nombre positif, deux décimales au plus (ex. 50 ou 49,90).";
export const ERREUR_PLAFOND_MAX = "Le plafond mensuel est limité à 100 000 $US.";

/** Plafond saisi en dollars US → micro-dollars entiers attendus par l'API. */
export function lirePlafond(
  saisie: string,
): Resultat<{ plafond_mensuel_micro_usd: number }, "plafond"> {
  const n = lireNombre(saisie);
  if (n === null) return { ok: false, erreurs: { plafond: ERREUR_PLAFOND_VIDE } };
  if (Number.isNaN(n) || n < 0) return { ok: false, erreurs: { plafond: ERREUR_PLAFOND_FORMAT } };
  const centimes = Math.round(n * 100);
  if (Math.abs(n * 100 - centimes) > 1e-6) {
    return { ok: false, erreurs: { plafond: ERREUR_PLAFOND_FORMAT } };
  }
  const micro = centimes * (MICRO_PAR_USD / 100);
  if (!Number.isSafeInteger(micro) || micro > PLAFOND_IA_MAX_MICRO_USD) {
    return { ok: false, erreurs: { plafond: ERREUR_PLAFOND_MAX } };
  }
  return { ok: true, charge: { plafond_mensuel_micro_usd: micro } };
}

/** Le plafond appliqué diffère de celui du cabinet (borné par l'opérateur de la plateforme). */
export function plafondBorne(
  p: Pick<ParametresIa, "plafond_mensuel_micro_usd" | "plafond_effectif_micro_usd">,
): boolean {
  return (
    typeof p.plafond_effectif_micro_usd === "number" &&
    typeof p.plafond_mensuel_micro_usd === "number" &&
    p.plafond_effectif_micro_usd !== p.plafond_mensuel_micro_usd
  );
}

/**
 * Limite de l'opérateur, affichée quand les appels passent par la clé de la plateforme (null
 * sinon, ou si l'API ne la publie pas).
 */
export function textePlafondPlateforme(
  p: Pick<
    ParametresIa,
    | "source_cle"
    | "plafond_mensuel_micro_usd"
    | "plafond_plateforme_micro_usd"
    | "plafond_effectif_micro_usd"
  >,
): string | null {
  if (p.source_cle !== "plateforme" || typeof p.plafond_plateforme_micro_usd !== "number") {
    return null;
  }
  const limite = `Avec la clé de la plateforme, l'opérateur limite le plafond à ${formaterMicroUsd(p.plafond_plateforme_micro_usd)} par mois`;
  return plafondBorne(p)
    ? `${limite} : le plafond appliqué est donc de ${formaterMicroUsd(p.plafond_effectif_micro_usd)}, quel que soit celui du cabinet.`
    : `${limite} ; le plafond du cabinet reste en deçà et s'applique.`;
}

/** Une hausse du plafond engage une dépense : l'API redemande l'identité de l'auteur. */
export const hausseDePlafond = (nouveau: number, actuel: number | null | undefined) =>
  nouveau > (actuel ?? 0);

// --- Reconfirmation d'identité (clé API, hausse du plafond) ----------------------------------

/** Bloc `confirmation` de PUT /api/ia/parametres : mot de passe et, si la 2FA est active, code. */
export type ConfirmationIa = { mot_de_passe: string } & Partial<ChargeFacteur>;

/**
 * Joint la reconfirmation saisie à une modification validée ; erreurs des deux réunies.
 * `saisie` null : aucune reconfirmation demandée pour ce changement.
 */
export function avecConfirmationIa<C extends object, K extends string>(
  v: Resultat<C, K>,
  saisie: SaisieConfirmation | null,
): Resultat<C & { confirmation?: ConfirmationIa }, K | ChampConfirmation> {
  if (saisie === null) {
    return v as Resultat<C & { confirmation?: ConfirmationIa }, K | ChampConfirmation>;
  }
  const c = validerReconfirmation(saisie);
  if (v.ok && c.ok) return { ok: true, charge: { ...v.charge, confirmation: c.charge } };
  return {
    ok: false,
    erreurs: { ...(v.ok ? {} : v.erreurs), ...(c.ok ? {} : c.erreurs) } as Partial<
      Record<K | ChampConfirmation, string>
    >,
  };
}

// --- Modèles par tâche -----------------------------------------------------------------------

export interface SaisieModele {
  tache: TacheIa;
  /** Suivre le modèle recommandé par MissionPilot (il peut évoluer). */
  recommande: boolean;
  modele: string;
}

export type ChampModele = `modele_${TacheIa}`;

export const libelleTache = (t: TacheIa) => TACHE_IA_LIBELLES[t] ?? t;

export const saisiesModeles = (modeles: readonly ModeleTacheIa[]): SaisieModele[] =>
  modeles.map((m) => ({ tache: m.tache, recommande: !m.personnalise, modele: m.modele }));

export const ERREUR_MODELE_NON_AUTORISE =
  "Choisissez un modèle de la liste : seuls les modèles au tarif connu sont admis.";

/**
 * Modifications à envoyer : `null` rend une tâche au modèle recommandé, une chaîne fixe un
 * modèle choisi dans la liste FERMÉE `autorises` (`modeles_autorises` de l'API : un modèle hors
 * liste est refusé en 400) ; une tâche inchangée est omise (objet vide : rien à enregistrer).
 * Un modèle personnalisé qui n'est plus autorisé mais reste inchangé n'est pas renvoyé.
 */
export function chargeModeles(
  saisies: readonly SaisieModele[],
  actuels: readonly ModeleTacheIa[],
  autorises: readonly string[],
): Resultat<{ modeles: Partial<Record<TacheIa, string | null>> }, ChampModele> {
  const modeles: Partial<Record<TacheIa, string | null>> = {};
  const erreurs: Partial<Record<ChampModele, string>> = {};
  for (const s of saisies) {
    const actuel = actuels.find((m) => m.tache === s.tache);
    if (!actuel) continue;
    if (s.recommande) {
      if (actuel.personnalise) modeles[s.tache] = null;
      continue;
    }
    const inchange = actuel.personnalise && s.modele === actuel.modele;
    if (inchange) continue;
    if (!autorises.includes(s.modele)) {
      erreurs[`modele_${s.tache}`] = ERREUR_MODELE_NON_AUTORISE;
      continue;
    }
    modeles[s.tache] = s.modele;
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { modeles } };
}

/**
 * Choix proposés pour une tâche : les modèles autorisés par l'API (liste fermée, aucune saisie
 * libre) ; le modèle en place reste affiché (signalé) même s'il n'est plus autorisé.
 */
export function optionsModele(
  m: ModeleTacheIa,
  autorises: readonly string[],
): { valeur: string; libelle: string; desactivee?: boolean }[] {
  const options = [...autorises].sort().map((a) => ({
    valeur: a,
    libelle: a === m.recommande ? `${a} (recommandé)` : a,
  }));
  if (!autorises.includes(m.modele)) {
    options.unshift({ valeur: m.modele, libelle: `${m.modele} (plus autorisé : à remplacer)` });
  }
  return options;
}

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

// --- Coûts (ia.configurer ET finance.lire) ---------------------------------------------------

export interface CoutsMoisIa {
  mois: string;
  cout_micro_usd: number;
  appels: number;
}

/** GET /api/ia/couts?mois=AAAA-MM. */
export interface CoutsIa {
  unite: string;
  seuil_ratio_mission: number;
  taux_conversion: { usd_vers: Partial<Record<Devise, number>>; date: string; a_valider: boolean };
  mois: string;
  cout_micro_usd: number;
  appels: number;
  plafond_mensuel_micro_usd: number;
  /** Plafond appliqué (borné par l'opérateur avec la clé de plateforme) ; base de `part_plafond`. */
  plafond_effectif_micro_usd: number;
  /** Part consommée du plafond EFFECTIF (calculée par l'API) ; null pour un plafond nul. */
  part_plafond: number | null;
  historique: CoutsMoisIa[];
}

/** GET /api/ia/couts/missions. */
export interface CoutMissionIa {
  mission_id: string;
  intitule: string | null;
  cout_micro_usd: number;
  appels: number;
  devise: Devise;
  cout_devise: number;
  prix_mission: number | null;
  ratio_cout_prix: number | null;
  depasse_seuil: boolean | null;
}

/** Droits de lecture des coûts (confort d'affichage : l'API répond 403 sinon). */
export const voitCoutsIa = (roles: readonly Role[]) =>
  aPermission(roles, "ia.configurer") && aPermission(roles, "finance.lire");

export const FORMAT_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;

export const moisDe = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Mois lu dans l'URL, sinon le mois en cours (UTC, comme l'API). */
export function lireMois(v: unknown, maintenant: Date): string {
  return typeof v === "string" && FORMAT_MOIS.test(v) ? v : moisDe(maintenant);
}

/** « 2026-10 » décalé de `delta` mois. */
export function decalerMois(mois: string, delta: number): string {
  const [a, m] = mois.split("-").map(Number);
  return moisDe(new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1 + delta, 1)));
}

/** « 2026-10 » → « octobre 2026 ». */
export function libelleMois(mois: string): string {
  if (!FORMAT_MOIS.test(mois)) return mois;
  const [a, m] = mois.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, 1)));
}

/** État du plafond d'après la part consommée calculée par l'API (seuils d'alerte 80 et 100 %). */
export function etatPlafond(part: number | null | undefined): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  if (typeof part !== "number" || !Number.isFinite(part)) {
    return { libelle: "Plafond nul : aucun appel facturé", tonalite: "neutre" };
  }
  const [alerte = 80, atteint = 100] = SEUILS_ALERTE_PLAFOND_IA;
  if (part * 100 >= atteint) return { libelle: "Plafond atteint", tonalite: "danger" };
  if (part * 100 >= alerte)
    return { libelle: `Plus de ${alerte} % consommés`, tonalite: "attention" };
  return { libelle: "Sous le plafond", tonalite: "succes" };
}

export function hrefCoutsIa(mois: string, curseurMissions?: string | null): string {
  const p = new URLSearchParams({ mois });
  if (curseurMissions) p.set("missions", curseurMissions);
  return `/parametres/ia?${p.toString()}#couts`;
}

// --- Erreurs ---------------------------------------------------------------------------------

/** Codes du fournisseur (502) : leur message, fixe et en français, vient de l'API. */
export const CODES_ERREUR_FOURNISSEUR = [
  "CLE_REFUSEE",
  "CREDIT_FOURNISSEUR_INSUFFISANT",
  "FOURNISSEUR_INDISPONIBLE",
  "DELAI_DEPASSE",
  "REQUETE_REFUSEE",
  "REPONSE_INVALIDE",
  "REPONSE_TROP_GRANDE",
] as const;

export const MESSAGE_CLE_ILLISIBLE =
  "Le serveur ne parvient plus à déchiffrer la clé API du cabinet (clé de chiffrement du serveur changée ?). Par sécurité, la clé de la plateforme ne la remplace pas : les contenus sont produits par les gabarits. Enregistrez de nouveau la clé OpenRouter du cabinet.";

export const MESSAGES_ERREURS_IA: Readonly<Record<string, string>> = {
  PLAFOND_IA_ATTEINT:
    "Le plafond mensuel de coût IA du cabinet est atteint : l'IA est refusée jusqu'au mois prochain ou au relèvement du plafond. Les contenus peuvent être produits par le gabarit.",
  CHIFFRES_NON_VERIFIES:
    "Des nombres de ce contenu ne viennent pas des moteurs de calcul : vérifiez-les, cochez la case d'attestation, puis validez.",
  CONTENU_VALIDE: "Ce contenu a déjà été validé : il est définitif et ne se modifie plus.",
  CLE_IA_ABSENTE:
    "Aucune clé API n'est disponible : l'IA fonctionne en mode gabarit. Enregistrez une clé OpenRouter pour l'utiliser.",
  IA_DESACTIVEE:
    "L'IA est désactivée pour le cabinet : activez-la (bouton « Activer l'IA ») avant de tester la connexion.",
  CLE_IA_ILLISIBLE: MESSAGE_CLE_ILLISIBLE,
  GENERATIONS_SIMULTANEES:
    "Trop de générations IA sont en cours pour le cabinet : réessayez dans un instant.",
};

/** Message affichable d'une erreur d'appel IA (toujours en français). */
export function messageErreurIa(e: unknown): string {
  if (!(e instanceof ErreurApi)) return messageErreur(e);
  const fixe = MESSAGES_ERREURS_IA[e.code];
  if (fixe) return fixe;
  // Refus explicites de l'API (séparation des tâches, fournisseur, quota journalier
  // QUOTA_IA_UTILISATEUR dont le nombre vient de l'API) : son message précis.
  if (
    e.code === "APPROBATION_REQUISE" ||
    (CODES_ERREUR_FOURNISSEUR as readonly string[]).includes(e.code) ||
    (e.statut === 429 && e.code !== "ERREUR_INATTENDUE")
  ) {
    return e.message;
  }
  return messageErreur(e);
}

export const estPlafondAtteint = (e: unknown) =>
  e instanceof ErreurApi && e.code === "PLAFOND_IA_ATTEINT";

/** Titre et texte de l'échec du test de connexion (clé illisible : alerte dédiée). */
export function erreurTestConnexion(e: unknown): { titre: string; message: string } {
  const code = e instanceof ErreurApi ? e.code : null;
  const titre =
    code === "CLE_IA_ILLISIBLE"
      ? "Clé API du cabinet illisible"
      : code === "IA_DESACTIVEE"
        ? "L'IA n'est pas activée"
        : "La connexion a échoué";
  return { titre, message: messageErreurIa(e) };
}
