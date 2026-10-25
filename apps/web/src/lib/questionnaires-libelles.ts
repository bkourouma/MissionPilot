/** Sous-module de `questionnaires.ts` : libellés, statuts et résumés d'un envoi. */
import {
  MODE_QUESTIONNAIRE_LIBELLES,
  MODES_QUESTIONNAIRE,
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
  tonalite: TonaliteStatut;
}

export const ORIGINE_MODELE: Record<OrigineModele, string> = {
  cabinet: "Créé par le cabinet",
  gabarit: "Copie d'un gabarit CabinetPilot",
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
