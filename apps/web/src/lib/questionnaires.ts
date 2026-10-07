/**
 * Questionnaires (SOC-10) côté cabinet : modèles du cabinet et leurs versions, envois aux
 * répondants du client d'une mission, suivi, relances et lecture des réponses soumises.
 * Logique pure, testée dans `questionnaires.test.ts`.
 *
 * Droits (miroir de `apps/api/src/routes/questionnaires.ts`, l'API reste seule juge) :
 * lecture `questionnaire.lire`, rédaction, validation, envoi, relance et clôture
 * `questionnaire.gerer` ; une mission clôturée est en lecture seule (409 côté API).
 *
 * Aucune réponse n'est conservée dans le navigateur : les réponses SOUMISES sont lues à la
 * demande et ne vivent que dans l'état de la page ; d'un brouillon du client, l'API ne rend
 * que la progression.
 */
import {
  aPermission,
  dateIsoSchema,
  GABARITS_QUESTIONNAIRE,
  identifiantGrilleSchema,
  MODE_QUESTIONNAIRE_LIBELLES,
  MODES_QUESTIONNAIRE,
  type GabaritQuestionnaire,
  type ModeEnvoiQuestionnaire,
  type ModeleQuestionnaireCreation,
  type RepondantEligible,
  type Role,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import { formaterDate, formaterDateHeure } from "./format";
import { cheminPage } from "./pagination";
import { definitionVierge, type Anomalie, type Definition } from "./questionnaires-definition";
import type { Resultat } from "./saisie";

// --- Réponses de l'API ------------------------------------------------------------------------

export type OrigineModele = "cabinet" | "gabarit" | "copie";
export type StatutVersion = "brouillon" | "valide";
export type StatutEnvoi = "brouillon" | "envoye" | "clos";
export type StatutReponse = "non_commence" | "brouillon" | "soumise";

/** Page d'une liste paginée par curseur (`paginer` de l'API). */
export interface PageQuestionnaires<T> {
  elements: T[];
  curseur_suivant: string | null;
}

/** `GET /api/questionnaires/gabarits`. */
export interface GabaritResume {
  code: string;
  titre: string;
  sections: number;
  questions: number;
}

/** Élément de `GET /api/questionnaires/modeles`. */
export interface ModeleResume {
  id: string;
  code: string;
  titre: string;
  origine: OrigineModele;
  cree_le: string;
  modifie_le: string;
  /** Dernière version validée (envoyable), `null` s'il n'y en a pas. */
  version_validee_id: string | null;
  /** Un brouillon est en cours. */
  brouillon: boolean;
}

export interface VersionResume {
  id: string;
  modele_id: string;
  version: number;
  statut: StatutVersion;
  cree_le: string;
  modifie_le: string;
  valide_le: string | null;
  cree_par: string | null;
  valide_par: string | null;
}

/** `GET /api/questionnaires/modeles/:id` : versions de la plus récente à la plus ancienne. */
export interface ModeleDetail {
  id: string;
  code: string;
  titre: string;
  origine: OrigineModele;
  gabarit: string | null;
  copie_de: string | null;
  cree_par: string | null;
  cree_le: string;
  modifie_le: string;
  versions: VersionResume[];
}

/** `GET /api/questionnaires/versions/:id`. */
export interface VersionDetail extends VersionResume {
  code: string;
  definition: Definition;
}

export interface ProgressionReponse {
  /** Part des questions obligatoires visibles répondues, entier de 0 à 100 (moteur). */
  pourcentage: number;
  complet: boolean;
  questions_visibles: number;
  questions_repondues: number;
  obligatoires_visibles: number;
  obligatoires_repondues: number;
}

export interface RepondantEnvoi {
  id: string;
  utilisateur_id: string;
  nom: string;
  email: string;
  fonction: string | null;
  relances: number;
  derniere_relance: string | null;
  /** Absents en mode collectif (la réponse est partagée : `reponse_collective`). */
  statut?: StatutReponse;
  soumise_le?: string | null;
  derniere_saisie?: string | null;
  progression?: ProgressionReponse;
}

export interface ReponseCollective {
  statut: StatutReponse;
  soumise_le: string | null;
  soumise_par_nom: string | null;
  derniere_saisie: string | null;
  progression: ProgressionReponse;
}

/** Élément de `GET /api/missions/:id/questionnaires`. */
export interface EnvoiResume {
  id: string;
  titre: string;
  mode: ModeEnvoiQuestionnaire;
  statut: StatutEnvoi;
  relances_auto: boolean;
  date_limite: string | null;
  cree_le: string;
  envoye_le: string | null;
  clos_le: string | null;
  version_id: string;
  repondants: number;
  reponses_soumises: number;
}

/** `GET /api/questionnaires/envois/:id`. */
export interface EnvoiDetail {
  id: string;
  mission_id: string;
  client_id: string;
  version_id: string;
  titre: string;
  mode: ModeEnvoiQuestionnaire;
  statut: StatutEnvoi;
  relances_auto: boolean;
  date_limite: string | null;
  cree_le: string;
  envoye_le: string | null;
  clos_le: string | null;
  definition: Definition;
  repondants: RepondantEnvoi[];
  reponse_collective: ReponseCollective | null;
  completude: { attendues: number; soumises: number; complet: boolean };
}

/** Réponse SOUMISE (`GET /api/questionnaires/envois/:id/reponses`) ; jamais un brouillon. */
export interface ReponseSoumise {
  id: string;
  repondant: { id: string; nom: string; fonction: string | null } | null;
  soumise_le: string;
  soumise_par_nom: string | null;
  reponses: Record<string, unknown>;
}

export interface ReponsesEnvoi {
  mode: ModeEnvoiQuestionnaire;
  elements: ReponseSoumise[];
}

/**
 * Répondant désignable (`GET /api/missions/:id/questionnaires/repondants-eligibles`,
 * `questionnaire.gerer`) : dirigeant ou contributeur actif du portail du client (non archivé)
 * de la mission, page par curseur triée par nom. Filtre et tri sont faits par l'API.
 */
export type { RepondantEligible };

/** Page de répondants désignables (`repondantsEligiblesReponseSchema`). */
export type PageRepondantsEligibles = PageQuestionnaires<RepondantEligible>;

// --- Libellés ---------------------------------------------------------------------------------

interface Libelle {
  libelle: string;
  tonalite: TonaliteStatut;
}

export const ORIGINE_MODELE: Record<OrigineModele, string> = {
  cabinet: "Créé par le cabinet",
  gabarit: "Copie d'un gabarit MissionPilot",
  copie: "Copie d'un modèle du cabinet",
};

export const STATUT_VERSION: Record<StatutVersion, Libelle> = {
  brouillon: { libelle: "Brouillon", tonalite: "attention" },
  valide: { libelle: "Validée", tonalite: "succes" },
};

export const STATUT_ENVOI: Record<StatutEnvoi, Libelle> = {
  brouillon: { libelle: "Brouillon, non envoyé", tonalite: "attention" },
  envoye: { libelle: "Envoyé", tonalite: "succes" },
  clos: { libelle: "Clos", tonalite: "neutre" },
};

export const STATUT_REPONSE: Record<StatutReponse, Libelle> = {
  non_commence: { libelle: "Non commencé", tonalite: "neutre" },
  brouillon: { libelle: "En cours de saisie", tonalite: "attention" },
  soumise: { libelle: "Soumis", tonalite: "succes" },
};

const inconnu: Libelle = { libelle: "Statut inconnu", tonalite: "neutre" };

/** Libellé d'un statut reçu de l'API ; repli neutre pour une valeur inconnue. */
export function libelleStatut<S extends string>(
  table: Record<S, Libelle>,
  statut: string,
): Libelle {
  return Object.prototype.hasOwnProperty.call(table, statut) ? table[statut as S] : inconnu;
}

export const origineModele = (o: string) =>
  Object.prototype.hasOwnProperty.call(ORIGINE_MODELE, o)
    ? ORIGINE_MODELE[o as OrigineModele]
    : "Origine inconnue";

export const libelleMode = (m: string) =>
  (MODES_QUESTIONNAIRE as readonly string[]).includes(m)
    ? MODE_QUESTIONNAIRE_LIBELLES[m as ModeEnvoiQuestionnaire]
    : m;

export const AIDE_MODE: Record<ModeEnvoiQuestionnaire, string> = {
  individuel: "Chaque répondant remplit son propre questionnaire.",
  collectif:
    "Une seule réponse partagée : les répondants complètent le même questionnaire, verrouillé dès la première soumission.",
  par_fonction:
    "Chaque répondant répond en son nom avec sa fonction (obligatoire) : les écarts entre fonctions ressortent à la lecture.",
};

export const OPTIONS_MODES = MODES_QUESTIONNAIRE.map((m) => ({
  valeur: m,
  libelle: MODE_QUESTIONNAIRE_LIBELLES[m],
}));

/** « 12 / 20 questions obligatoires renseignées ». */
export function texteProgression(p: ProgressionReponse): string {
  if (p.obligatoires_visibles === 0) {
    return `${p.questions_repondues} réponse${p.questions_repondues > 1 ? "s" : ""}, aucune question obligatoire affichée`;
  }
  return `${p.obligatoires_repondues} / ${p.obligatoires_visibles} questions obligatoires renseignées`;
}

/** « 1 relance » / « 3 relances » / « Aucune relance ». */
export function texteRelances(n: number): string {
  if (n <= 0) return "Aucune relance";
  return n === 1 ? "1 relance" : `${n} relances`;
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Suivi d'un envoi dans la liste de la mission : désignés, réponses soumises. */
export function resumeEnvoi(
  e: Pick<EnvoiResume, "statut" | "mode" | "repondants" | "reponses_soumises">,
): string {
  if (e.statut === "brouillon")
    return `${pluriel(e.repondants, "répondant")} désigné${e.repondants > 1 ? "s" : ""}, non envoyé`;
  if (e.mode === "collectif") {
    return `Réponse partagée ${e.reponses_soumises > 0 ? "soumise" : "non soumise"} · ${pluriel(e.repondants, "répondant")}`;
  }
  const n = e.reponses_soumises;
  return `${pluriel(n, "réponse")} soumise${n > 1 ? "s" : ""} sur ${e.repondants}`;
}

/** Dates et relances d'un envoi : « envoyé le …, date limite …, relances automatiques actives ». */
export function datesEnvoi(
  e: Pick<
    EnvoiResume,
    "statut" | "cree_le" | "envoye_le" | "clos_le" | "date_limite" | "relances_auto"
  >,
): string {
  return [
    e.envoye_le
      ? `envoyé le ${formaterDateHeure(e.envoye_le)}`
      : `créé le ${formaterDateHeure(e.cree_le)}`,
    e.date_limite ? `date limite indicative : ${formaterDate(e.date_limite)}` : null,
    e.clos_le ? `clos le ${formaterDateHeure(e.clos_le)}` : null,
    e.statut === "envoye"
      ? e.relances_auto
        ? "relances automatiques actives"
        : "relances automatiques désactivées"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// --- Droits et actions ------------------------------------------------------------------------

export interface ContexteQuestionnaires {
  roles: readonly Role[];
  missionCloturee: boolean;
}

export const peutLireQuestionnaires = (roles: readonly Role[]) =>
  aPermission(roles, "questionnaire.lire");
export const peutGererQuestionnaires = (roles: readonly Role[]) =>
  aPermission(roles, "questionnaire.gerer");

/** Écrire sur les envois d'une mission : droit de gestion ET mission non clôturée. */
export const peutEcrireEnvois = (c: ContexteQuestionnaires) =>
  peutGererQuestionnaires(c.roles) && !c.missionCloturee;

export interface ActionsEnvoi {
  envoyer: boolean;
  relancer: boolean;
  clore: boolean;
  modifierReglages: boolean;
  /** Pourquoi aucune action n'est proposée, `null` si au moins une l'est. */
  raisonLectureSeule: string | null;
}

export function actionsEnvoi(
  envoi: Pick<EnvoiDetail, "statut">,
  c: ContexteQuestionnaires,
): ActionsEnvoi {
  const ecrire = peutEcrireEnvois(c);
  const a = {
    envoyer: ecrire && envoi.statut === "brouillon",
    relancer: ecrire && envoi.statut === "envoye",
    clore: ecrire && envoi.statut === "envoye",
    modifierReglages: ecrire && envoi.statut !== "clos",
  };
  const raisonLectureSeule = c.missionCloturee
    ? "Mission clôturée : les questionnaires restent consultables, plus aucun envoi, réglage ni relance n'est possible."
    : !peutGererQuestionnaires(c.roles)
      ? "Votre rôle permet de consulter les questionnaires, pas de les envoyer ni de les relancer."
      : envoi.statut === "clos"
        ? "Questionnaire clos : plus aucune saisie ni relance."
        : null;
  return { ...a, raisonLectureSeule };
}

/** Le répondant attend-il encore (réponse non soumise) ? Collectif : réponse partagée. */
export function repondantEnAttente(
  envoi: Pick<EnvoiDetail, "mode" | "reponse_collective">,
  r: Pick<RepondantEnvoi, "statut">,
): boolean {
  if (envoi.mode === "collectif") return envoi.reponse_collective?.statut !== "soumise";
  return r.statut !== "soumise";
}

/** Délai minimal entre deux relances d'un même répondant (règle de l'API, en heures). */
export const DELAI_RELANCE_HEURES = 24;

/** Relancé il y a moins de 24 h (indication ; l'API refuse en 409). */
export function relanceRecente(
  derniere: string | null,
  maintenant: Date,
  heures = DELAI_RELANCE_HEURES,
): boolean {
  if (!derniere) return false;
  const t = new Date(derniere).getTime();
  if (Number.isNaN(t)) return false;
  const ecart = maintenant.getTime() - t;
  return ecart >= 0 && ecart < heures * 3_600_000;
}

// --- Répondants -------------------------------------------------------------------------------

/** Seuls le dirigeant et le contributeur client répondent (DECISIONS.md, V2). */
export const ROLES_REPONDANTS = ["client_dirigeant", "client_contributeur"] as const;

export const ROLE_REPONDANT_LIBELLES: Record<(typeof ROLES_REPONDANTS)[number], string> = {
  client_dirigeant: "Dirigeant",
  client_contributeur: "Contributeur",
};

/** « Dirigeant », « Contributeur », ou les deux. */
export function rolesRepondant(c: { roles: readonly string[] }): string {
  return ROLES_REPONDANTS.filter((r) => c.roles.includes(r))
    .map((r) => ROLE_REPONDANT_LIBELLES[r])
    .join(", ");
}

/**
 * Échec du chargement des répondants désignables : 409 mission clôturée, 404 mission
 * invisible (uniforme), 403 rôle sans `questionnaire.gerer`.
 */
export function messageRepondantsEligibles(e: unknown): string {
  if (!(e instanceof ErreurApi)) return "La liste des répondants n'a pas pu être chargée.";
  if (e.statut === 409) {
    return "Mission clôturée : plus aucun envoi de questionnaire n'est possible.";
  }
  if (e.statut === 404) {
    return "Mission introuvable : elle a été retirée, ou vous n'y avez plus accès.";
  }
  if (e.statut === 403) return "Votre rôle ne permet pas de préparer l'envoi d'un questionnaire.";
  return messageErreur(e);
}

export const TITRE_AUCUN_REPONDANT =
  "Aucun répondant éligible : invitez d'abord des utilisateurs du portail du client.";

/** Explication de l'état vide, selon le droit d'inviter au portail (`portail.gerer`). */
export function aideAucunRepondant(peutInviter: boolean): string {
  const regle =
    "Seuls les dirigeants et contributeurs actifs du portail d'un client non archivé répondent ; les investisseurs et les comptes désactivés ne sont pas proposés.";
  return peutInviter
    ? `${regle} Invitez-les depuis l'onglet « Portail client » de la fiche du client, puis actualisez la liste.`
    : `${regle} L'invitation au portail revient à l'associé, au directeur ou au chef de mission : demandez-leur d'inviter les répondants, puis actualisez la liste.`;
}

/** Ne garde de la saisie que les répondants encore proposés (après actualisation de la liste). */
export function garderRepondants(
  repondants: SaisieEnvoi["repondants"],
  proposes: readonly Pick<RepondantEligible, "id">[],
): SaisieEnvoi["repondants"] {
  const ids = new Set(proposes.map((p) => p.id));
  return Object.fromEntries(Object.entries(repondants).filter(([id]) => ids.has(id)));
}

export const MESSAGE_REPONDANT_REFUSE =
  "Un répondant choisi n'est plus désignable : son compte du portail a été désactivé ou retiré, ou le client a été archivé entre-temps. La liste des répondants est actualisée : vérifiez la sélection puis réessayez.";

/**
 * Refus d'un répondant à la création d'un envoi : 400 métier sans détail de champ (compte
 * désactivé ou détaché, client archivé : `REQUETE_INVALIDE` de `creerEnvoi`) ou déclencheur
 * (`REPONDANT_INVALIDE`). Un 400 de validation (« Données invalides. », détails) n'en est pas un.
 */
export function estRefusRepondant(e: unknown): boolean {
  if (!(e instanceof ErreurApi) || e.statut !== 400) return false;
  if (e.code === "REPONDANT_INVALIDE") return true;
  return (
    e.code === "REQUETE_INVALIDE" && e.details === undefined && e.message !== "Données invalides."
  );
}

/** Message d'une création d'envoi refusée (sinon `null` : message générique). */
export function messageCreationEnvoi(e: unknown): string | null {
  return estRefusRepondant(e) ? MESSAGE_REPONDANT_REFUSE : messageQuestionnaire(e);
}

// --- Saisie d'un envoi --------------------------------------------------------------------------

export const FONCTION_MAX = 120;
export const REPONDANTS_MAX = 200;

export interface SaisieEnvoi {
  version_id: string;
  mode: ModeEnvoiQuestionnaire | "";
  /** Comptes cochés et fonction saisie, par identifiant d'utilisateur. */
  repondants: Record<string, { choisi: boolean; fonction: string }>;
  date_limite: string;
  relances_auto: boolean;
}

export const SAISIE_ENVOI_VIDE: SaisieEnvoi = {
  version_id: "",
  mode: "individuel",
  repondants: {},
  date_limite: "",
  relances_auto: true,
};

export type ChampEnvoi =
  "version_id" | "mode" | "repondants" | "date_limite" | `fonction.${string}`;

export interface ChargeEnvoi {
  version_id: string;
  mode: ModeEnvoiQuestionnaire;
  repondants: { utilisateur_id: string; fonction?: string }[];
  relances_auto: boolean;
  date_limite: string | null;
}

/** Erreur de date limite (format, date passée), `null` si valide ou vide. */
export function erreurDateLimite(v: string, aujourdhui: string): string | null {
  if (v.trim() === "") return null;
  if (!dateIsoSchema.safeParse(v).success)
    return "Date invalide : choisissez une date du calendrier.";
  if (v < aujourdhui) return "La date limite ne peut pas être déjà passée.";
  return null;
}

/** Contrôle la saisie d'un envoi ; `aujourdhui` au format AAAA-MM-JJ. */
export function validerEnvoi(
  s: SaisieEnvoi,
  aujourdhui: string,
): Resultat<ChargeEnvoi, ChampEnvoi> {
  const erreurs: Partial<Record<ChampEnvoi, string>> = {};
  if (s.version_id === "") erreurs.version_id = "Choisissez le questionnaire à envoyer.";
  if (s.mode === "") erreurs.mode = "Choisissez le mode de réponse.";
  const choisis = Object.entries(s.repondants).filter(([, r]) => r.choisi);
  if (choisis.length === 0) erreurs.repondants = "Choisissez au moins un répondant.";
  else if (choisis.length > REPONDANTS_MAX) {
    erreurs.repondants = `${REPONDANTS_MAX} répondants au plus par envoi.`;
  }
  for (const [id, r] of choisis) {
    const f = r.fonction.trim();
    if (s.mode === "par_fonction" && f === "") {
      erreurs[`fonction.${id}`] =
        "Indiquez la fonction de ce répondant (obligatoire en mode « par fonction »).";
    } else if (f.length > FONCTION_MAX) {
      erreurs[`fonction.${id}`] = `${FONCTION_MAX} caractères au plus.`;
    }
  }
  const date = erreurDateLimite(s.date_limite, aujourdhui);
  if (date) erreurs.date_limite = date;
  if (Object.keys(erreurs).length > 0 || s.mode === "") return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      version_id: s.version_id,
      mode: s.mode,
      repondants: choisis.map(([id, r]) =>
        r.fonction.trim() === ""
          ? { utilisateur_id: id }
          : { utilisateur_id: id, fonction: r.fonction.trim() },
      ),
      relances_auto: s.relances_auto,
      date_limite: s.date_limite.trim() === "" ? null : s.date_limite,
    },
  };
}

// --- Réglages d'un envoi (relances automatiques, date limite) ------------------------------------

export interface SaisieReglages {
  relances_auto: boolean;
  date_limite: string;
}

export const reglagesDepuisEnvoi = (e: Pick<EnvoiDetail, "relances_auto" | "date_limite">) => ({
  relances_auto: e.relances_auto,
  date_limite: e.date_limite ?? "",
});

/** Champs modifiés seulement (l'API exige au moins un champ). */
export function validerReglages(
  s: SaisieReglages,
  envoi: Pick<EnvoiDetail, "relances_auto" | "date_limite">,
  aujourdhui: string,
): Resultat<
  { relances_auto?: boolean; date_limite?: string | null },
  "date_limite" | "relances_auto"
> {
  const avant = reglagesDepuisEnvoi(envoi);
  const charge: { relances_auto?: boolean; date_limite?: string | null } = {};
  if (s.relances_auto !== avant.relances_auto) charge.relances_auto = s.relances_auto;
  if (s.date_limite !== avant.date_limite) {
    // Une date limite déjà passée peut être conservée telle quelle, pas en être une nouvelle.
    const e = erreurDateLimite(s.date_limite, aujourdhui);
    if (e) return { ok: false, erreurs: { date_limite: e } };
    charge.date_limite = s.date_limite.trim() === "" ? null : s.date_limite;
  }
  if (Object.keys(charge).length === 0) {
    return { ok: false, erreurs: { relances_auto: "Aucune modification à enregistrer." } };
  }
  return { ok: true, charge };
}

// --- Saisie d'un nouveau modèle -----------------------------------------------------------------

export type SourceModele = "vierge" | "gabarit" | "copie";

export interface SaisieModele {
  source: SourceModele;
  gabarit: string;
  modele_id: string;
  code: string;
  titre: string;
}

export type ChampModele = "source" | "gabarit" | "modele_id" | "code" | "titre";

export const TITRE_MAX = 200;

export const estGabarit = (v: string): v is GabaritQuestionnaire =>
  (GABARITS_QUESTIONNAIRE as readonly string[]).includes(v);

export function validerModele(s: SaisieModele): Resultat<ModeleQuestionnaireCreation, ChampModele> {
  const erreurs: Partial<Record<ChampModele, string>> = {};
  const code = s.code.trim();
  const titre = s.titre.trim();
  if (code === "") erreurs.code = "Le code est obligatoire.";
  else if (!identifiantGrilleSchema.safeParse(code).success) {
    erreurs.code =
      "Code invalide : minuscules sans accent, chiffres, « _ », « . » ou « - » (80 caractères au plus).";
  }
  if (s.source === "vierge" && titre === "") erreurs.titre = "Le titre est obligatoire.";
  if (titre.length > TITRE_MAX) erreurs.titre = `${TITRE_MAX} caractères au plus.`;
  if (s.source === "gabarit" && !estGabarit(s.gabarit)) erreurs.gabarit = "Choisissez un gabarit.";
  if (s.source === "copie" && s.modele_id === "")
    erreurs.modele_id = "Choisissez le modèle à copier.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const source: ModeleQuestionnaireCreation["source"] =
    s.source === "vierge"
      ? { type: "definition", definition: definitionVierge(code, titre) }
      : s.source === "gabarit"
        ? { type: "gabarit", gabarit: s.gabarit as GabaritQuestionnaire }
        : { type: "copie", modele_id: s.modele_id };
  return { ok: true, charge: { code, ...(titre === "" ? {} : { titre }), source } };
}

// --- Erreurs ----------------------------------------------------------------------------------

const ANOMALIE = /^([A-Z][A-Z0-9_]*) : ([\s\S]+)$/;

/**
 * Anomalies du moteur rendues par l'API (400 REQUETE_INVALIDE, `details.fieldErrors` indexés
 * par chemin, messages « CODE : message »). `null` si l'erreur n'en porte pas. Une erreur de
 * forme du schéma (clé `definition` ou `source`, message brut parfois en anglais) devient une
 * anomalie générique en français.
 */
export function anomaliesDepuisErreur(e: unknown): Anomalie[] | null {
  if (!(e instanceof ErreurApi) || e.code !== "REQUETE_INVALIDE") return null;
  const d = e.details as { fieldErrors?: Record<string, unknown> } | undefined;
  if (!d || typeof d !== "object" || !d.fieldErrors || typeof d.fieldErrors !== "object")
    return null;
  const anomalies: Anomalie[] = [];
  let forme = false;
  for (const [chemin, messages] of Object.entries(d.fieldErrors)) {
    const definition = chemin === "definition" || chemin === "source";
    for (const m of Array.isArray(messages) ? messages : []) {
      const r = typeof m === "string" ? ANOMALIE.exec(m) : null;
      if (r && !definition) {
        anomalies.push({ code: r[1] as string, chemin, message: (r[2] as string).trim() });
      } else if (definition) {
        forme = true;
      }
      // Autre champ refusé (répondants, mode…) : ce n'est pas une anomalie de définition,
      // il est signalé sur son champ par le formulaire (`champsRefuses`).
    }
  }
  if (forme) {
    anomalies.push({
      code: "FORME_INVALIDE",
      chemin: "",
      message:
        "Une partie de la définition a été refusée par le serveur : vérifiez les champs obligatoires et les longueurs.",
    });
  }
  return anomalies.length > 0 ? anomalies : null;
}

/** Message propre aux questionnaires (sinon `null` : message générique de `messageErreur`). */
export function messageQuestionnaire(e: unknown): string | null {
  if (!(e instanceof ErreurApi)) return null;
  const anomalies = anomaliesDepuisErreur(e);
  if (anomalies) {
    return anomalies.length === 1
      ? "La définition comporte une anomalie : corrigez-la puis enregistrez de nouveau."
      : `La définition comporte ${anomalies.length} anomalies : corrigez-les puis enregistrez de nouveau.`;
  }
  if (e.statut === 404) {
    return "Questionnaire introuvable : il a été retiré, ou vous n'y avez plus accès.";
  }
  // 409 (version figée, envoi clos, mission clôturée, brouillon existant, code déjà pris) et
  // 400 métier (répondant invalide) : le message de l'API est en français et précis.
  if (e.statut === 409 || (e.statut === 400 && e.code !== "REQUETE_INVALIDE")) return e.message;
  return null;
}

/** Message d'une relance refusée : 409 = déjà relancé il y a moins de 24 h, ou plus en attente. */
export function messageRelance(e: unknown): string | null {
  if (e instanceof ErreurApi && e.statut === 409) {
    const regle = /24\s*h/.test(e.message)
      ? ""
      : ` Un répondant ne se relance qu'une fois par période de ${DELAI_RELANCE_HEURES} heures, et seulement tant qu'il n'a pas soumis.`;
    return `Relance refusée : ${e.message}${regle}`;
  }
  return messageQuestionnaire(e);
}

// --- Navigation et pages ------------------------------------------------------------------------

export const TAILLE_PAGE = 30;
export const TAILLE_PAGE_CHOIX = 100;

/** Curseur lu dans l'URL (chaîne bornée, sinon `null`). */
export function lireCurseur(v: string | string[] | undefined): string | null {
  const c = Array.isArray(v) ? v[0] : v;
  if (!c || c.length > 500 || !/^[A-Za-z0-9_\-=.~]+$/.test(c)) return null;
  return c;
}

export const cheminModeles = (curseur: string | null, limite = TAILLE_PAGE) =>
  cheminPage("/api/questionnaires/modeles", limite, curseur);

export const cheminEnvoisMission = (missionId: string, curseur: string | null) =>
  cheminPage(`/api/missions/${encodeURIComponent(missionId)}/questionnaires`, TAILLE_PAGE, curseur);

/** Pages de 100 (plafond de l'API) chargées au plus : au-delà de 1 000, liste partielle. */
export const PAGES_MAX_REPONDANTS = 10;

export const cheminRepondantsEligibles = (missionId: string, curseur: string | null) =>
  cheminPage(
    `/api/missions/${encodeURIComponent(missionId)}/questionnaires/repondants-eligibles`,
    TAILLE_PAGE_CHOIX,
    curseur,
  );

export const hrefAvecCurseur = (base: string, curseur: string | null) =>
  curseur ? `${base}?curseur=${encodeURIComponent(curseur)}` : base;

export const hrefEnvoi = (missionId: string, envoiId: string) =>
  `/missions/${encodeURIComponent(missionId)}/questionnaires/${encodeURIComponent(envoiId)}`;

/**
 * Charge toutes les pages d'une liste (listes de choix). S'arrête sur un curseur répété ou
 * après `pagesMax` pages (liste alors marquée `tronquee`).
 */
export async function toutesLesPages<T>(
  charger: (chemin: string) => Promise<PageQuestionnaires<T>>,
  chemin: (curseur: string | null) => string,
  pagesMax = 20,
): Promise<{ elements: T[]; tronquee: boolean }> {
  const elements: T[] = [];
  const vus = new Set<string>();
  let curseur: string | null = null;
  for (let page = 0; page < pagesMax; page++) {
    const r: PageQuestionnaires<T> = await charger(chemin(curseur));
    elements.push(...r.elements);
    curseur = r.curseur_suivant ?? null;
    if (curseur === null || vus.has(curseur)) return { elements, tronquee: false };
    vus.add(curseur);
  }
  return { elements, tronquee: true };
}

/** Modèles envoyables (au moins une version validée), triés par titre. */
export function modelesEnvoyables(modeles: readonly ModeleResume[]) {
  return modeles
    .filter(
      (m): m is ModeleResume & { version_validee_id: string } => m.version_validee_id !== null,
    )
    .map((m) => ({ valeur: m.version_validee_id, libelle: `${m.titre} (${m.code})` }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr", { sensitivity: "base" }));
}

/** Date du jour AAAA-MM-JJ dans le fuseau donné (Abidjan par défaut, UTC+0). */
export function dateDuJour(maintenant: Date, fuseau = "Africa/Abidjan"): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(maintenant);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}
