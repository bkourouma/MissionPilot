/** Contenus du plan stratégique : texte comparable d'une version et options des formulaires. */
import { PERSPECTIVES_PLAN, STATUTS_INITIATIVE, type TypeElementPlan } from "@missionpilot/shared";
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
}

const puces = (titre: string, l: readonly string[]) =>
  `${titre}\n${l.length ? l.map((x) => `• ${x}`).join("\n") : "(aucun)"}`;

function ligne(libelle: string, v: string | null | undefined): string | null {
  return v ? `${libelle} : ${v}` : null;
}

function texteInitiative(d: Record<string, unknown>, c: ContexteTexte): string[] {
  const gains = Array.isArray(d.gains_annuels) ? (d.gains_annuels as unknown[]) : [];
  return [
    ligne(
      "Responsable",
      d.responsable_id ? c.nomResponsable(String(d.responsable_id)) : "Non désigné",
    ),
    ligne("Début", lireTexte(d, "debut") ? formaterDate(lireTexte(d, "debut")) : null),
    ligne("Échéance", formaterDate(lireTexte(d, "echeance"))),
    ligne(
      "Budget",
      formaterMontantMineur(typeof d.budget === "number" ? d.budget : null, c.devise),
    ),
    ligne("Statut", libelleStatutInitiative(d.statut)),
    ligne(
      "Dépend de",
      lireListe(d, "dependances")
        .map((id) => c.nomInitiative?.(id) ?? "initiative du plan")
        .join(", ") || null,
    ),
    ligne(
      "Gains nets annuels",
      gains.length
        ? gains
            .map((g, i) => `année ${i + 1} : ${formaterMontantMineur(g as number, c.devise)}`)
            .join(" ; ")
        : "non estimés",
    ),
  ].filter((x): x is string => x !== null);
}

/** Texte lisible et stable d'une version, pour l'historique et la comparaison mot à mot. */
export function texteElement(
  type: TypeElementPlan,
  d: Record<string, unknown>,
  c: ContexteTexte,
): string {
  const parties: (string | null)[] = (() => {
    switch (type) {
      case "diagnostic":
        return [lireTexte(d, "synthese")];
      case "swot":
        return [
          puces("Forces", lireListe(d, "forces")),
          puces("Faiblesses", lireListe(d, "faiblesses")),
          puces("Opportunités", lireListe(d, "opportunites")),
          puces("Menaces", lireListe(d, "menaces")),
        ];
      case "vision_mission":
        return [
          ligne("Vision", lireTexte(d, "vision")),
          ligne("Mission", lireTexte(d, "mission")),
          ligne("Valeurs", lireListe(d, "valeurs").join(", ") || null),
        ];
      case "axe":
        return [ligne("Titre", lireTexte(d, "titre")), lireTexte(d, "description")];
      case "objectif":
        return [
          ligne("Titre", lireTexte(d, "titre")),
          ligne("Perspective", libellePerspective(d.perspective)),
          ligne("Indicateur", lireTexte(d, "indicateur")),
          ligne("Cible", lireTexte(d, "cible")),
          ligne(
            "Échéance",
            lireTexte(d, "echeance") ? formaterDate(lireTexte(d, "echeance")) : null,
          ),
          lireTexte(d, "description"),
        ];
      case "initiative":
        return [
          ligne("Titre", lireTexte(d, "titre")),
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

/** Options de statut d'initiative. */
export const OPTIONS_STATUTS_INITIATIVE = STATUTS_INITIATIVE.map((s) => ({
  valeur: s,
  libelle: libelleStatutInitiative(s),
}));
