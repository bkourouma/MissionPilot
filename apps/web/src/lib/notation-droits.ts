/** Notation : assemblage des données et droits d'affichage (voir `notation.ts`). */
import { estExpertPublieur } from "./notation-libelles";
import { aPermission, type Role, type StatutVersionNotation } from "@missionpilot/shared";
import type { Classe, RepondantEcart, VueVersionNotation } from "./notation-types";

// --- Assemblage des données de l'API (jointure par identifiant, sans calcul) ----------------

export interface LigneDimension {
  dimension: string;
  libelle: string;
  famille: string;
  notable: boolean;
  poids: number | null;
  couverture: number | null;
  scoreCalcule: number | null;
  deltaCumule: number;
  score: number | null;
  classe: Classe | null;
}

/** Une ligne par dimension, dans l'ordre de la grille : calcul figé + score ajusté. */
export function lignesDimensions(
  vue: Pick<VueVersionNotation, "resultat" | "score">,
): LigneDimension[] {
  return vue.score.dimensions.map((d) => {
    const r = vue.resultat.dimensions.find((x) => x.dimension === d.dimension);
    return {
      dimension: d.dimension,
      libelle: d.libelle,
      famille: d.famille,
      notable: r?.notable ?? d.scoreCalcule !== null,
      poids: r?.poids ?? null,
      couverture: r?.couverture ?? null,
      scoreCalcule: d.scoreCalcule,
      deltaCumule: d.deltaCumule,
      score: d.score,
      classe: d.classe,
    };
  });
}

/** Dimensions non notables (réponses insuffisantes), dans l'ordre de la grille. */
export const dimensionsNonNotables = (vue: Pick<VueVersionNotation, "resultat" | "score">) =>
  lignesDimensions(vue).filter((l) => !l.notable);

/** Libellé d'une dimension connue de la version, sinon son code. */
export function libelleDimension(
  vue: Pick<VueVersionNotation, "score">,
  dimension: string,
): string {
  return vue.score.dimensions.find((d) => d.dimension === dimension)?.libelle ?? dimension;
}

/** « Nom (fonction) », ou un libellé neutre si le nom n'est plus connu. */
export function nomRepondant(r: RepondantEcart): string {
  const nom = r.nom?.trim() || "Répondant";
  return r.fonction ? `${nom} (${r.fonction})` : nom;
}

// --- Droits d'affichage ----------------------------------------------------------------------

export interface ContexteNotation {
  roles: readonly Role[];
  utilisateurId: string;
  missionCloturee: boolean;
}

/** Raisons pour lesquelles CET utilisateur est auteur de la version (séparation des tâches). */
export function contributionsUtilisateur(
  vue: Pick<VueVersionNotation, "calcule_par" | "ajustements" | "revue">,
  utilisateurId: string,
): string[] {
  const raisons: string[] = [];
  if (vue.calcule_par.id === utilisateurId) raisons.push("vous avez lancé ce calcul");
  if (vue.ajustements.some((a) => a.auteur.id === utilisateurId)) {
    raisons.push("vous avez ajusté une dimension");
  }
  if (vue.revue.some((e) => e.action === "soumission" && e.par.id === utilisateurId)) {
    raisons.push("vous avez soumis cette version en revue");
  }
  return raisons;
}

function enumerer(elements: readonly string[]): string {
  if (elements.length <= 1) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} et ${elements[elements.length - 1]}`;
}

export const MESSAGE_PUBLICATION_EXPERT =
  "La publication revient à un expert métier du cabinet, après relecture (revue obligatoire, NOT-07). Votre rôle ne le permet pas : un expert métier de la mission doit relire et publier cette version.";

export interface DroitsVersion {
  ajuster: boolean;
  soumettre: boolean;
  /** Raison affichée quand la soumission est impossible pour une version en brouillon. */
  blocageSoumission: string | null;
  renvoyer: boolean;
  publier: boolean;
  /** Explication affichée quand le bouton « Publier » n'est pas proposé (version en revue). */
  explicationPublication: string | null;
}

/**
 * Actions proposées sur la version AFFICHÉE. L'API n'agit que sur la DERNIÈRE version : une
 * version plus ancienne est en lecture seule.
 */
export function droitsVersion(
  ctx: ContexteNotation,
  vue: Pick<VueVersionNotation, "statut" | "score" | "calcule_par" | "ajustements" | "revue">,
  derniere: boolean,
): DroitsVersion {
  const gerer = aPermission(ctx.roles, "notation.gerer");
  const expert = estExpertPublieur(ctx.roles);
  const brouillon = derniere && vue.statut === "brouillon";
  const enRevue = derniere && vue.statut === "en_revue";
  const notableUne = vue.score.dimensions.some((d) => d.scoreCalcule !== null);
  const raisons = contributionsUtilisateur(vue, ctx.utilisateurId);
  let explicationPublication: string | null = null;
  if (enRevue && !expert) explicationPublication = MESSAGE_PUBLICATION_EXPERT;
  else if (enRevue && raisons.length > 0) {
    explicationPublication = `Vous ne pouvez pas publier cette version : ${enumerer(raisons)}. Un autre expert métier doit la relire et la publier (séparation des tâches).`;
  }
  return {
    ajuster: gerer && brouillon && !ctx.missionCloturee && notableUne,
    soumettre: gerer && brouillon && vue.score.notable,
    blocageSoumission:
      gerer && brouillon && !vue.score.notable
        ? "Le score global n'est pas notable : complétez les réponses (ou relancez un calcul) avant de soumettre la version en revue."
        : null,
    renvoyer: expert && enRevue,
    publier: expert && enRevue && raisons.length === 0,
    explicationPublication,
  };
}

/** Pourquoi le formulaire d'ajustement n'est pas proposé sur la version affichée. */
export function messageSansAjustement(
  ctx: ContexteNotation,
  statut: StatutVersionNotation,
  derniere: boolean,
): string {
  if (!derniere) return "Version antérieure : elle ne s'ajuste plus.";
  if (statut !== "brouillon") {
    return "Seule une version en brouillon s'ajuste : elle doit être renvoyée en brouillon, ou un nouveau calcul lancé.";
  }
  if (!aPermission(ctx.roles, "notation.gerer")) {
    return "L'ajustement revient au consultant ou au chef de mission.";
  }
  if (ctx.missionCloturee) return "La mission est clôturée : plus aucun ajustement n'est possible.";
  return "Aucune dimension notable à ajuster : complétez les réponses puis relancez un calcul.";
}

/**
 * Raison pour laquelle un nouveau calcul n'est pas possible, ou null. `statutDerniere` est le
 * statut de la dernière version (null : aucun calcul encore).
 */
export function blocageCalcul(
  ctx: ContexteNotation,
  statutDerniere: StatutVersionNotation | null,
): string | null {
  if (!aPermission(ctx.roles, "notation.gerer")) {
    return "Le calcul d'une notation revient au consultant ou au chef de mission.";
  }
  if (ctx.missionCloturee) {
    return "La mission est clôturée : aucun nouveau calcul ni ajustement n'est possible. Les versions existantes restent consultables.";
  }
  if (statutDerniere === "en_revue") {
    return "La dernière version est en revue : un expert métier doit la publier ou la renvoyer en brouillon avant un nouveau calcul.";
  }
  return null;
}
