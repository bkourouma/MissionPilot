/** Contenus du plan stratégique : texte comparable d'une version et options des formulaires. */
import {
  PERSPECTIVES_PLAN,
  STATUTS_INITIATIVE,
  creerTraduire,
  type Langue,
  type PerspectivePlan,
  type StatutInitiative,
  type Traduire,
  type TypeElementPlan,
} from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "./format";
import {
  libellePerspective,
  libelleStatutInitiative,
  lireListe,
  lireTexte,
  PERSPECTIVE_LIBELLES,
} from "./plan-strategique";

// --- Texte comparable d'une version -----------------------------------------------------------

export interface ContexteTexte {
  devise: Devise;
  /** Nom d'un responsable d'initiative (identifiant → nom affichable). */
  nomResponsable: (id: string | null) => string;
  /** Titre d'une initiative du plan (dépendances) ; absent : « initiative du plan ». */
  nomInitiative?: (id: string) => string;
  /** Langue du texte produit (défaut "fr"). */
  langue?: Langue;
}

const PERSPECTIVE_LIBELLES_EN: Record<PerspectivePlan, string> = {
  finances: "Financial",
  clients: "Customer",
  processus: "Internal processes",
  apprentissage: "Learning and growth",
};
const STATUT_INITIATIVE_LIBELLES_EN: Record<StatutInitiative, string> = {
  a_lancer: "To launch",
  en_cours: "In progress",
  terminee: "Completed",
  suspendue: "Suspended",
  abandonnee: "Abandoned",
};
/** Perspective d'un objectif dans la langue demandée. */
export const libellePerspectiveLangue = (p: unknown, langue: Langue = "fr") =>
  langue === "en"
    ? (PERSPECTIVE_LIBELLES_EN[p as PerspectivePlan] ?? "Perspective not specified")
    : libellePerspective(p);
/** Statut d'une initiative dans la langue demandée. */
export const libelleStatutInitiativeLangue = (s: unknown, langue: Langue = "fr") =>
  langue === "en"
    ? (STATUT_INITIATIVE_LIBELLES_EN[s as StatutInitiative] ?? "Status not specified")
    : libelleStatutInitiative(s);

const puces = (titre: string, l: readonly string[], t: Traduire) =>
  `${titre}\n${l.length ? l.map((x) => `• ${x}`).join("\n") : t("(aucun)", "(none)")}`;

function ligne(libelle: string, v: string | null | undefined): string | null {
  return v ? `${libelle} : ${v}` : null;
}

function texteInitiative(d: Record<string, unknown>, c: ContexteTexte): string[] {
  const langue = c.langue ?? "fr";
  const t = creerTraduire(langue);
  const gains = Array.isArray(d.gains_annuels) ? (d.gains_annuels as unknown[]) : [];
  return [
    ligne(
      t("Responsable", "Owner"),
      d.responsable_id
        ? c.nomResponsable(String(d.responsable_id))
        : t("Non désigné", "Not assigned"),
    ),
    ligne(
      t("Début", "Start"),
      lireTexte(d, "debut") ? formaterDate(lireTexte(d, "debut"), "UTC", langue) : null,
    ),
    ligne(t("Échéance", "Due date"), formaterDate(lireTexte(d, "echeance"), "UTC", langue)),
    ligne(
      "Budget",
      formaterMontantMineur(typeof d.budget === "number" ? d.budget : null, c.devise, langue),
    ),
    ligne(t("Statut", "Status"), libelleStatutInitiativeLangue(d.statut, langue)),
    ligne(
      t("Dépend de", "Depends on"),
      lireListe(d, "dependances")
        .map((id) => c.nomInitiative?.(id) ?? t("initiative du plan", "plan initiative"))
        .join(", ") || null,
    ),
    ligne(
      t("Gains nets annuels", "Annual net gains"),
      gains.length
        ? gains
            .map(
              (g, i) =>
                `${t("année", "year")} ${i + 1} : ${formaterMontantMineur(g as number, c.devise, langue)}`,
            )
            .join(" ; ")
        : t("non estimés", "not estimated"),
    ),
  ].filter((x): x is string => x !== null);
}

/** Texte lisible et stable d'une version, pour l'historique et la comparaison mot à mot. */
export function texteElement(
  type: TypeElementPlan,
  d: Record<string, unknown>,
  c: ContexteTexte,
): string {
  const langue = c.langue ?? "fr";
  const t = creerTraduire(langue);
  const parties: (string | null)[] = (() => {
    switch (type) {
      case "diagnostic":
        return [lireTexte(d, "synthese")];
      case "swot":
        return [
          puces(t("Forces", "Strengths"), lireListe(d, "forces"), t),
          puces(t("Faiblesses", "Weaknesses"), lireListe(d, "faiblesses"), t),
          puces(t("Opportunités", "Opportunities"), lireListe(d, "opportunites"), t),
          puces(t("Menaces", "Threats"), lireListe(d, "menaces"), t),
        ];
      case "vision_mission":
        return [
          ligne("Vision", lireTexte(d, "vision")),
          ligne("Mission", lireTexte(d, "mission")),
          ligne(t("Valeurs", "Values"), lireListe(d, "valeurs").join(", ") || null),
        ];
      case "axe":
        return [ligne(t("Titre", "Title"), lireTexte(d, "titre")), lireTexte(d, "description")];
      case "objectif":
        return [
          ligne(t("Titre", "Title"), lireTexte(d, "titre")),
          ligne("Perspective", libellePerspectiveLangue(d.perspective, langue)),
          ligne("KPI", lireTexte(d, "indicateur")),
          ligne(t("Cible", "Target"), lireTexte(d, "cible")),
          ligne(
            t("Échéance", "Due date"),
            lireTexte(d, "echeance") ? formaterDate(lireTexte(d, "echeance"), "UTC", langue) : null,
          ),
          lireTexte(d, "description"),
        ];
      case "initiative":
        return [
          ligne(t("Titre", "Title"), lireTexte(d, "titre")),
          ...texteInitiative(d, c),
          lireTexte(d, "description"),
        ];
    }
  })();
  return parties.filter((x): x is string => Boolean(x)).join("\n\n");
}

/** Options de perspective (formulaire d'objectif). */
export const OPTIONS_PERSPECTIVES = PERSPECTIVES_PLAN.map((p) => ({
  valeur: p,
  libelle: PERSPECTIVE_LIBELLES[p],
}));
export const optionsPerspectives = (langue: Langue = "fr") =>
  PERSPECTIVES_PLAN.map((p) => ({
    valeur: p,
    libelle: libellePerspectiveLangue(p, langue),
  }));

/** Options de statut d'initiative. */
export const OPTIONS_STATUTS_INITIATIVE = STATUTS_INITIATIVE.map((s) => ({
  valeur: s,
  libelle: libelleStatutInitiative(s),
}));
export const optionsStatutsInitiative = (langue: Langue = "fr") =>
  STATUTS_INITIATIVE.map((s) => ({
    valeur: s,
    libelle: libelleStatutInitiativeLangue(s, langue),
  }));
