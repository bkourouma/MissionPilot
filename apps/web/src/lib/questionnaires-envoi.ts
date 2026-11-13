/** Sous-module de `questionnaires.ts` : saisie et validation d'un envoi, de ses réglages et d'un modèle. */
import {
  dateIsoSchema,
  type Langue,
  GABARITS_QUESTIONNAIRE,
  identifiantGrilleSchema,
  type GabaritQuestionnaire,
  type ModeEnvoiQuestionnaire,
  type ModeleQuestionnaireCreation,
} from "@missionpilot/shared";
import { definitionVierge } from "./questionnaires-definition";
import type { Resultat } from "./saisie";
import { type EnvoiDetail } from "./questionnaires-types";

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
export function erreurDateLimite(
  v: string,
  aujourdhui: string,
  langue: Langue = "fr",
): string | null {
  const en = langue === "en";
  if (v.trim() === "") return null;
  if (!dateIsoSchema.safeParse(v).success)
    return en
      ? "Invalid date: choose a date from the calendar."
      : "Date invalide : choisissez une date du calendrier.";
  if (v < aujourdhui) {
    return en
      ? "The due date cannot already be in the past."
      : "La date limite ne peut pas être déjà passée.";
  }
  return null;
}

/** Contrôle la saisie d'un envoi ; `aujourdhui` au format AAAA-MM-JJ. */
export function validerEnvoi(
  s: SaisieEnvoi,
  aujourdhui: string,
  langue: Langue = "fr",
): Resultat<ChargeEnvoi, ChampEnvoi> {
  const en = langue === "en";
  const erreurs: Partial<Record<ChampEnvoi, string>> = {};
  if (s.version_id === "") {
    erreurs.version_id = en
      ? "Choose the questionnaire to send."
      : "Choisissez le questionnaire à envoyer.";
  }
  if (s.mode === "") {
    erreurs.mode = en ? "Choose the response mode." : "Choisissez le mode de réponse.";
  }
  const choisis = Object.entries(s.repondants).filter(([, r]) => r.choisi);
  if (choisis.length === 0) {
    erreurs.repondants = en
      ? "Choose at least one respondent."
      : "Choisissez au moins un répondant.";
  } else if (choisis.length > REPONDANTS_MAX) {
    erreurs.repondants = en
      ? `${REPONDANTS_MAX} respondents at most per sending.`
      : `${REPONDANTS_MAX} répondants au plus par envoi.`;
  }
  for (const [id, r] of choisis) {
    const f = r.fonction.trim();
    if (s.mode === "par_fonction" && f === "") {
      erreurs[`fonction.${id}`] = en
        ? 'Enter this respondent\'s role (required in "by role" mode).'
        : "Indiquez la fonction de ce répondant (obligatoire en mode « par fonction »).";
    } else if (f.length > FONCTION_MAX) {
      erreurs[`fonction.${id}`] = en
        ? `${FONCTION_MAX} characters at most.`
        : `${FONCTION_MAX} caractères au plus.`;
    }
  }
  const date = erreurDateLimite(s.date_limite, aujourdhui, langue);
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
  langue: Langue = "fr",
): Resultat<
  { relances_auto?: boolean; date_limite?: string | null },
  "date_limite" | "relances_auto"
> {
  const avant = reglagesDepuisEnvoi(envoi);
  const charge: { relances_auto?: boolean; date_limite?: string | null } = {};
  if (s.relances_auto !== avant.relances_auto) charge.relances_auto = s.relances_auto;
  if (s.date_limite !== avant.date_limite) {
    // Une date limite déjà passée peut être conservée telle quelle, pas en être une nouvelle.
    const e = erreurDateLimite(s.date_limite, aujourdhui, langue);
    if (e) return { ok: false, erreurs: { date_limite: e } };
    charge.date_limite = s.date_limite.trim() === "" ? null : s.date_limite;
  }
  if (Object.keys(charge).length === 0) {
    return {
      ok: false,
      erreurs: {
        relances_auto:
          langue === "en" ? "No changes to save." : "Aucune modification à enregistrer.",
      },
    };
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

export function validerModele(
  s: SaisieModele,
  langue: Langue = "fr",
): Resultat<ModeleQuestionnaireCreation, ChampModele> {
  const en = langue === "en";
  const erreurs: Partial<Record<ChampModele, string>> = {};
  const code = s.code.trim();
  const titre = s.titre.trim();
  if (code === "") erreurs.code = en ? "The code is required." : "Le code est obligatoire.";
  else if (!identifiantGrilleSchema.safeParse(code).success) {
    erreurs.code = en
      ? 'Invalid code: lowercase letters without accents, digits, "_", "." or "-" (80 characters at most).'
      : "Code invalide : minuscules sans accent, chiffres, « _ », « . » ou « - » (80 caractères au plus).";
  }
  if (s.source === "vierge" && titre === "") {
    erreurs.titre = en ? "The title is required." : "Le titre est obligatoire.";
  }
  if (titre.length > TITRE_MAX) {
    erreurs.titre = en ? `${TITRE_MAX} characters at most.` : `${TITRE_MAX} caractères au plus.`;
  }
  if (s.source === "gabarit" && !estGabarit(s.gabarit)) {
    erreurs.gabarit = en ? "Choose a template." : "Choisissez un gabarit.";
  }
  if (s.source === "copie" && s.modele_id === "") {
    erreurs.modele_id = en ? "Choose the questionnaire to copy." : "Choisissez le modèle à copier.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const source: ModeleQuestionnaireCreation["source"] =
    s.source === "vierge"
      ? { type: "definition", definition: definitionVierge(code, titre) }
      : s.source === "gabarit"
        ? { type: "gabarit", gabarit: s.gabarit as GabaritQuestionnaire }
        : { type: "copie", modele_id: s.modele_id };
  return { ok: true, charge: { code, ...(titre === "" ? {} : { titre }), source } };
}
