/** Sous-module de `questionnaires.ts` : libellés, statuts et résumés d'un envoi. */
import {
  MODE_QUESTIONNAIRE_LIBELLES,
  MODES_QUESTIONNAIRE,
  type Langue,
  type ModeEnvoiQuestionnaire,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterDate, formaterDateHeure } from "./format";
import {
  type OrigineModele,
  type StatutVersion,
  type StatutEnvoi,
  type StatutReponse,
  type ProgressionReponse,
  type EnvoiResume,
} from "./questionnaires-types";

// --- Libellés ---------------------------------------------------------------------------------

interface Libelle {
  libelle: string;
  /** Libellé anglais (le français reste `libelle`). */
  en?: string;
  tonalite: TonaliteStatut;
}

export const ORIGINE_MODELE: Record<OrigineModele, string> = {
  cabinet: "Créé par le cabinet",
  gabarit: "Copie d'un gabarit CabinetPilot",
  copie: "Copie d'un modèle du cabinet",
};

export const ORIGINE_MODELE_EN: Record<OrigineModele, string> = {
  cabinet: "Created by the firm",
  gabarit: "Copy of a CabinetPilot template",
  copie: "Copy of a firm questionnaire",
};

export const STATUT_VERSION: Record<StatutVersion, Libelle> = {
  brouillon: { libelle: "Brouillon", en: "Draft", tonalite: "attention" },
  valide: { libelle: "Validée", en: "Approved", tonalite: "succes" },
};

export const STATUT_ENVOI: Record<StatutEnvoi, Libelle> = {
  brouillon: { libelle: "Brouillon, non envoyé", en: "Draft, not sent", tonalite: "attention" },
  envoye: { libelle: "Envoyé", en: "Sent", tonalite: "succes" },
  clos: { libelle: "Clos", en: "Closed", tonalite: "neutre" },
};

export const STATUT_REPONSE: Record<StatutReponse, Libelle> = {
  non_commence: { libelle: "Non commencé", en: "Not started", tonalite: "neutre" },
  brouillon: { libelle: "En cours de saisie", en: "In progress", tonalite: "attention" },
  soumise: { libelle: "Soumis", en: "Submitted", tonalite: "succes" },
};

const inconnu: Libelle = { libelle: "Statut inconnu", tonalite: "neutre" };

/** Libellé d'un statut reçu de l'API ; repli neutre pour une valeur inconnue. */
export function libelleStatut<S extends string>(
  table: Record<S, Libelle>,
  statut: string,
  langue: Langue = "fr",
): Libelle {
  if (!Object.prototype.hasOwnProperty.call(table, statut)) {
    return langue === "en" ? { libelle: "Unknown status", tonalite: "neutre" } : inconnu;
  }
  const l = table[statut as S];
  return langue === "en" ? { libelle: l.en ?? l.libelle, tonalite: l.tonalite } : l;
}

export const origineModele = (o: string, langue: Langue = "fr") =>
  Object.prototype.hasOwnProperty.call(ORIGINE_MODELE, o)
    ? (langue === "en" ? ORIGINE_MODELE_EN : ORIGINE_MODELE)[o as OrigineModele]
    : langue === "en"
      ? "Unknown origin"
      : "Origine inconnue";

export const MODE_QUESTIONNAIRE_LIBELLES_EN: Record<ModeEnvoiQuestionnaire, string> = {
  individuel: "Individual",
  collectif: "Collective (shared response)",
  par_fonction: "By role",
};

export const libelleMode = (m: string, langue: Langue = "fr") =>
  (MODES_QUESTIONNAIRE as readonly string[]).includes(m)
    ? (langue === "en" ? MODE_QUESTIONNAIRE_LIBELLES_EN : MODE_QUESTIONNAIRE_LIBELLES)[
        m as ModeEnvoiQuestionnaire
      ]
    : m;

export const AIDE_MODE: Record<ModeEnvoiQuestionnaire, string> = {
  individuel: "Chaque répondant remplit son propre questionnaire.",
  collectif:
    "Une seule réponse partagée : les répondants complètent le même questionnaire, verrouillé dès la première soumission.",
  par_fonction:
    "Chaque répondant répond en son nom avec sa fonction (obligatoire) : les écarts entre fonctions ressortent à la lecture.",
};

export const AIDE_MODE_EN: Record<ModeEnvoiQuestionnaire, string> = {
  individuel: "Each respondent fills in their own questionnaire.",
  collectif:
    "A single shared response: respondents complete the same questionnaire, locked on the first submission.",
  par_fonction:
    "Each respondent answers in their own name with their role (required): differences between roles stand out when reading the responses.",
};

export const OPTIONS_MODES = MODES_QUESTIONNAIRE.map((m) => ({
  valeur: m,
  libelle: MODE_QUESTIONNAIRE_LIBELLES[m],
}));

/** Options de mode d'envoi dans la langue demandée. */
export const optionsModes = (langue: Langue = "fr") =>
  MODES_QUESTIONNAIRE.map((m) => ({ valeur: m, libelle: libelleMode(m, langue) }));

/** « 12 / 20 questions obligatoires renseignées ». */
export function texteProgression(p: ProgressionReponse, langue: Langue = "fr"): string {
  if (langue === "en") {
    if (p.obligatoires_visibles === 0) {
      return `${p.questions_repondues} answer${p.questions_repondues > 1 ? "s" : ""}, no required question shown`;
    }
    return `${p.obligatoires_repondues} / ${p.obligatoires_visibles} required questions answered`;
  }
  if (p.obligatoires_visibles === 0) {
    return `${p.questions_repondues} réponse${p.questions_repondues > 1 ? "s" : ""}, aucune question obligatoire affichée`;
  }
  return `${p.obligatoires_repondues} / ${p.obligatoires_visibles} questions obligatoires renseignées`;
}

/** « 1 relance » / « 3 relances » / « Aucune relance ». */
export function texteRelances(n: number, langue: Langue = "fr"): string {
  if (langue === "en") {
    if (n <= 0) return "No reminders";
    return n === 1 ? "1 reminder" : `${n} reminders`;
  }
  if (n <= 0) return "Aucune relance";
  return n === 1 ? "1 relance" : `${n} relances`;
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Suivi d'un envoi dans la liste de la mission : désignés, réponses soumises. */
export function resumeEnvoi(
  e: Pick<EnvoiResume, "statut" | "mode" | "repondants" | "reponses_soumises">,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    const resp = pluriel(e.repondants, "respondent");
    if (e.statut === "brouillon") return `${resp} designated, not sent`;
    if (e.mode === "collectif") {
      return `Shared response ${e.reponses_soumises > 0 ? "submitted" : "not submitted"} · ${resp}`;
    }
    return `${pluriel(e.reponses_soumises, "response")} submitted out of ${e.repondants}`;
  }
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
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    return [
      e.envoye_le
        ? `sent on ${formaterDateHeure(e.envoye_le, undefined, langue)}`
        : `created on ${formaterDateHeure(e.cree_le, undefined, langue)}`,
      e.date_limite ? `due date: ${formaterDate(e.date_limite, undefined, langue)}` : null,
      e.clos_le ? `closed on ${formaterDateHeure(e.clos_le, undefined, langue)}` : null,
      e.statut === "envoye"
        ? e.relances_auto
          ? "automatic reminders on"
          : "automatic reminders off"
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    e.envoye_le
      ? `envoyé le ${formaterDateHeure(e.envoye_le)}`
      : `créé le ${formaterDateHeure(e.cree_le)}`,
    e.date_limite ? `date limite : ${formaterDate(e.date_limite)}` : null,
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
