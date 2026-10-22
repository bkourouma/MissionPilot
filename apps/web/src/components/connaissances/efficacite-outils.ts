import { STATUT_EFFICACITE_LIBELLES, type StatutEfficacite } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import type { Resultat } from "../../lib/saisie";

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

export const libelleStatutEfficacite = (s: StatutEfficacite) => STATUT_EFFICACITE_LIBELLES[s];

export function tonaliteStatutEfficacite(s: StatutEfficacite): "neutre" | "succes" | "attention" {
  return s === "mise_en_oeuvre" ? "succes" : s === "recommandee" ? "attention" : "neutre";
}

/** « Formation · Agro-industrie · PME » : le contexte d'un score, dans l'ordre des dimensions. */
export function libelleContexte(c: Pick<ContexteScore, "valeurs">): string {
  const v = c.valeurs;
  return [v.type_initiative, v.secteur, v.taille ? (TAILLES[v.taille] ?? v.taille) : undefined]
    .filter((x): x is string => Boolean(x))
    .join(" · ");
}

/** Score affiché, ou la raison de son absence (jamais un zéro trompeur). */
export function libelleScore(
  c: Pick<ContexteScore, "score_moyen" | "effectif" | "raison">,
  seuil: number,
) {
  if (c.score_moyen === null) {
    return `Effectif insuffisant (${seuil} observations requises)`;
  }
  return `${c.score_moyen} / 100`;
}

export function libelleScoreRecommandation(
  r: Pick<RecommandationResume, "score" | "evaluable" | "raison" | "statut">,
) {
  if (r.statut !== "mise_en_oeuvre") return "—";
  if (r.evaluable === null) return "Effet non mesuré";
  if (r.score === null) return r.raison ?? "Non évaluable";
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
  const erreurs: Partial<Record<ChampRecommandation, string>> = {};
  const libelle = s.libelle.trim();
  const type = s.type_initiative.trim();
  const valeur = s.valeur_cible.trim().replace(",", ".");
  if (s.kpi_id === "") erreurs.kpi_id = "Choisissez le KPI observé.";
  if (libelle === "" || libelle.length > 200 || CONTROLE.test(libelle)) {
    erreurs.libelle = "Libellé de 1 à 200 caractères.";
  }
  if (type === "" || type.length > 80 || CONTROLE.test(type)) {
    erreurs.type_initiative = "Type de 1 à 80 caractères.";
  }
  if (!VALEUR.test(s.valeur_cible.trim())) {
    erreurs.valeur_cible = "Un nombre (6 décimales au plus), par exemple 120 ou 4,5.";
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

export function lireMiseEnOeuvre(date: string): Resultat<{ mise_en_oeuvre_le: string }, "date"> {
  const d = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, erreurs: { date: "Indiquez une date." } };
  return { ok: true, charge: { mise_en_oeuvre_le: d } };
}

export function lireAbandon(motif: string): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "" || m.length > 500) {
    return { ok: false, erreurs: { motif: "Motif de 1 à 500 caractères." } };
  }
  return { ok: true, charge: { motif: m } };
}

const MESSAGES: Record<string, string> = {
  RECOMMANDATION_EXISTANTE: "Une recommandation existe déjà pour ce KPI de cette mission.",
  TRANSITION_INTERDITE: "Cette recommandation est déjà décidée.",
  NON_MISE_EN_OEUVRE: "L'effet ne se mesure qu'une fois la recommandation mise en oeuvre.",
  DATE_FUTURE: "La date de mise en oeuvre ne peut pas être dans le futur.",
};

export function messageEfficacite(e: unknown): string {
  if (e instanceof ErreurApi && MESSAGES[e.code]) return MESSAGES[e.code] as string;
  return messageErreur(e);
}

/** « · mise en œuvre le 15 oct. 2026 » (jamais la date ISO brute) ; chaîne vide sans date. */
export function libelleMiseEnOeuvre(date: string | null): string {
  return date ? ` · mise en œuvre le ${formaterDate(date)}` : "";
}
