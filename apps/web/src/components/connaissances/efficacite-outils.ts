import {
  creerTraduire,
  STATUT_EFFICACITE_LIBELLES,
  type Langue,
  type StatutEfficacite,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import { normaliserNombreSaisi, type Resultat } from "../../lib/saisie";

/**
 * Efficacité des recommandations (CAP-03) : types des réponses de l'API, libellés, lecture des
 * saisies. Aucun calcul : scores, moyennes et médianes viennent de l'API (moteur pur).
 */

export const CHEMIN_EFFICACITE = "/api/capitalisation/efficacite";

export interface ContexteScore {
  cle: string;
  dimensions: ("type_initiative" | "secteur" | "taille")[];
  valeurs: Partial<Record<"type_initiative" | "secteur" | "taille", string>>;
  effectif: number | null;
  score_moyen: number | null;
  mediane: number | null;
  au_dessus_du_seuil: boolean;
  raison: string | null;
}

export interface ReponseScores {
  seuil: number;
  recommandations_suivies: number;
  evaluees: number;
  elements: ContexteScore[];
}

export interface RecommandationResume {
  id: string;
  statut: StatutEfficacite;
  /** Null hors mission visible (le contexte pourrait identifier une mission). */
  type_initiative: string | null;
  secteur: string | null;
  taille: string | null;
  mise_en_oeuvre_le: string | null;
  visible: boolean;
  libelle: string | null;
  mission_id: string | null;
  mission_intitule: string | null;
  score: number | null;
  evaluable: boolean | null;
  raison: string | null;
}

export interface OptionsMission {
  kpi: { id: string; libelle: string; unite: string; sens: string; deja_recommande: boolean }[];
  initiatives: { id: string; titre: string | null }[];
}

const TAILLES: Record<string, string> = {
  tpe: "TPE",
  pme: "PME",
  eti: "ETI",
  grande_entreprise: "Grande entreprise",
};

const TAILLES_EN: Record<string, string> = {
  tpe: "Micro business",
  pme: "SME",
  eti: "Mid-cap",
  grande_entreprise: "Large company",
};

const STATUT_EFFICACITE_LIBELLES_EN: Record<StatutEfficacite, string> = {
  recommandee: "Recommended",
  mise_en_oeuvre: "Implemented",
  abandonnee: "Abandoned",
};

export const libelleStatutEfficacite = (s: StatutEfficacite, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_EFFICACITE_LIBELLES_EN : STATUT_EFFICACITE_LIBELLES)[s];

export function tonaliteStatutEfficacite(s: StatutEfficacite): "neutre" | "succes" | "attention" {
  return s === "mise_en_oeuvre" ? "succes" : s === "recommandee" ? "attention" : "neutre";
}

/** « Formation · Agro-industrie · PME » : le contexte d'un score, dans l'ordre des dimensions. */
export function libelleContexte(c: Pick<ContexteScore, "valeurs">, langue: Langue = "fr"): string {
  const v = c.valeurs;
  const tailles = langue === "en" ? TAILLES_EN : TAILLES;
  return [v.type_initiative, v.secteur, v.taille ? (tailles[v.taille] ?? v.taille) : undefined]
    .filter((x): x is string => Boolean(x))
    .join(" · ");
}

/** Score affiché, ou la raison de son absence (jamais un zéro trompeur). */
export function libelleScore(
  c: Pick<ContexteScore, "score_moyen" | "effectif" | "raison">,
  seuil: number,
  langue: Langue = "fr",
) {
  if (c.score_moyen === null) {
    return creerTraduire(langue)(
      `Effectif insuffisant (${seuil} observations requises)`,
      `Insufficient sample (${seuil} observations required)`,
    );
  }
  return `${c.score_moyen} / 100`;
}

export function libelleScoreRecommandation(
  r: Pick<RecommandationResume, "score" | "evaluable" | "raison" | "statut">,
  langue: Langue = "fr",
) {
  const t = creerTraduire(langue);
  if (r.statut !== "mise_en_oeuvre") return "—";
  if (r.evaluable === null) return t("Effet non mesuré", "Effect not measured");
  if (r.score === null) return r.raison ?? t("Non évaluable", "Cannot be assessed");
  return `${r.score} / 100`;
}

const VALEUR = /^-?\d{1,15}([.,]\d{1,6})?$/;
// eslint-disable-next-line no-control-regex -- rejet volontaire des caractères de contrôle
const CONTROLE = /[\u0000-\u001f\u007f]/;

type ChampRecommandation = "kpi_id" | "libelle" | "type_initiative" | "valeur_cible";

export function lireRecommandation(
  missionId: string,
  s: {
    kpi_id: string;
    plan_initiative_id: string;
    libelle: string;
    type_initiative: string;
    valeur_cible: string;
  },
  langue: Langue = "fr",
): Resultat<
  {
    mission_id: string;
    kpi_id: string;
    plan_initiative_id: string | null;
    libelle: string;
    type_initiative: string;
    valeur_cible: string;
  },
  ChampRecommandation
> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampRecommandation, string>> = {};
  const libelle = s.libelle.trim();
  const type = s.type_initiative.trim();
  const valeur = normaliserNombreSaisi(s.valeur_cible.trim(), langue);
  if (s.kpi_id === "") erreurs.kpi_id = t("Choisissez le KPI observé.", "Choose the observed KPI.");
  if (libelle === "" || libelle.length > 200 || CONTROLE.test(libelle)) {
    erreurs.libelle = t("Libellé de 1 à 200 caractères.", "Label of 1 to 200 characters.");
  }
  if (type === "" || type.length > 80 || CONTROLE.test(type)) {
    erreurs.type_initiative = t("Type de 1 à 80 caractères.", "Type of 1 to 80 characters.");
  }
  if (!VALEUR.test(s.valeur_cible.trim())) {
    erreurs.valeur_cible = t(
      "Un nombre (6 décimales au plus), par exemple 120 ou 4,5.",
      "A number (6 decimals maximum), for example 120 or 4.5.",
    );
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      mission_id: missionId,
      kpi_id: s.kpi_id,
      plan_initiative_id: s.plan_initiative_id === "" ? null : s.plan_initiative_id,
      libelle,
      type_initiative: type,
      valeur_cible: valeur,
    },
  };
}

export function lireMiseEnOeuvre(
  date: string,
  langue: Langue = "fr",
): Resultat<{ mise_en_oeuvre_le: string }, "date"> {
  const d = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return {
      ok: false,
      erreurs: { date: creerTraduire(langue)("Indiquez une date.", "Enter a date.") },
    };
  }
  return { ok: true, charge: { mise_en_oeuvre_le: d } };
}

export function lireAbandon(
  motif: string,
  langue: Langue = "fr",
): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "" || m.length > 500) {
    return {
      ok: false,
      erreurs: {
        motif: creerTraduire(langue)(
          "Motif de 1 à 500 caractères.",
          "Reason of 1 to 500 characters.",
        ),
      },
    };
  }
  return { ok: true, charge: { motif: m } };
}

const MESSAGES: Record<string, string> = {
  RECOMMANDATION_EXISTANTE: "Une recommandation existe déjà pour ce KPI de cette mission.",
  TRANSITION_INTERDITE: "Cette recommandation est déjà décidée.",
  NON_MISE_EN_OEUVRE: "L'effet ne se mesure qu'une fois la recommandation mise en oeuvre.",
  DATE_FUTURE: "La date de mise en oeuvre ne peut pas être dans le futur.",
};

const MESSAGES_EN: Record<string, string> = {
  RECOMMANDATION_EXISTANTE: "A recommendation already exists for this KPI of this engagement.",
  TRANSITION_INTERDITE: "This recommendation has already been decided.",
  NON_MISE_EN_OEUVRE: "The effect can only be measured once the recommendation is implemented.",
  DATE_FUTURE: "The implementation date cannot be in the future.",
};

export function messageEfficacite(e: unknown, langue: Langue = "fr"): string {
  const messages = langue === "en" ? MESSAGES_EN : MESSAGES;
  if (e instanceof ErreurApi && messages[e.code]) return messages[e.code] as string;
  return messageErreur(e);
}

/** « · mise en œuvre le 15 oct. 2026 » (jamais la date ISO brute) ; chaîne vide sans date. */
export function libelleMiseEnOeuvre(date: string | null, langue: Langue = "fr"): string {
  return date
    ? creerTraduire(langue)(
        ` · mise en œuvre le ${formaterDate(date)}`,
        ` · implemented on ${formaterDate(date, "UTC", langue)}`,
      )
    : "";
}
