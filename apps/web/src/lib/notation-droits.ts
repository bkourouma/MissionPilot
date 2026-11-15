/** Notation : assemblage des données et droits d'affichage (voir `notation.ts`). */
import { estExpertPublieur } from "./notation-libelles";
import {
  aPermission,
  creerTraduire,
  type Langue,
  type Role,
  type StatutVersionNotation,
} from "@missionpilot/shared";
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
export function nomRepondant(r: RepondantEcart, langue: Langue = "fr"): string {
  const nom = r.nom?.trim() || (langue === "en" ? "Respondent" : "Répondant");
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
  langue: Langue = "fr",
): string[] {
  const t = creerTraduire(langue);
  const raisons: string[] = [];
  if (vue.calcule_par.id === utilisateurId) {
    raisons.push(t("vous avez lancé ce calcul", "you ran this computation"));
  }
  if (vue.ajustements.some((a) => a.auteur.id === utilisateurId)) {
    raisons.push(t("vous avez ajusté une dimension", "you adjusted a dimension"));
  }
  if (vue.revue.some((e) => e.action === "soumission" && e.par.id === utilisateurId)) {
    raisons.push(
      t("vous avez soumis cette version en revue", "you submitted this version for review"),
    );
  }
  return raisons;
}

function enumerer(elements: readonly string[], langue: Langue): string {
  if (elements.length <= 1) return elements.join("");
  const et = langue === "en" ? "and" : "et";
  return `${elements.slice(0, -1).join(", ")} ${et} ${elements[elements.length - 1]}`;
}

export const MESSAGE_PUBLICATION_EXPERT =
  "La publication revient à un expert métier du cabinet, après relecture (revue obligatoire, NOT-07). Votre rôle ne le permet pas : un expert métier de la mission doit relire et publier cette version.";

export const MESSAGE_PUBLICATION_EXPERT_EN =
  "Publication is up to a business expert of the firm, after review (mandatory review, NOT-07). Your role does not allow it: a business expert of the engagement must review and publish this version.";

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
  langue: Langue = "fr",
): DroitsVersion {
  const t = creerTraduire(langue);
  const gerer = aPermission(ctx.roles, "notation.gerer");
  const expert = estExpertPublieur(ctx.roles);
  const brouillon = derniere && vue.statut === "brouillon";
  const enRevue = derniere && vue.statut === "en_revue";
  const notableUne = vue.score.dimensions.some((d) => d.scoreCalcule !== null);
  const raisons = contributionsUtilisateur(vue, ctx.utilisateurId, langue);
  let explicationPublication: string | null = null;
  if (enRevue && !expert) {
    explicationPublication =
      langue === "en" ? MESSAGE_PUBLICATION_EXPERT_EN : MESSAGE_PUBLICATION_EXPERT;
  } else if (enRevue && raisons.length > 0) {
    explicationPublication = t(
      `Vous ne pouvez pas publier cette version : ${enumerer(raisons, langue)}. Un autre expert métier doit la relire et la publier (séparation des tâches).`,
      `You cannot publish this version: ${enumerer(raisons, langue)}. Another business expert must review and publish it (separation of duties).`,
    );
  }
  return {
    ajuster: gerer && brouillon && !ctx.missionCloturee && notableUne,
    soumettre: gerer && brouillon && vue.score.notable,
    blocageSoumission:
      gerer && brouillon && !vue.score.notable
        ? t(
            "Le score global n'est pas notable : complétez les réponses (ou relancez un calcul) avant de soumettre la version en revue.",
            "The overall score is not rated: complete the answers (or run a new computation) before submitting the version for review.",
          )
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
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (!derniere) {
    return t(
      "Version antérieure : elle ne s'ajuste plus.",
      "Earlier version: it can no longer be adjusted.",
    );
  }
  if (statut !== "brouillon") {
    return t(
      "Seule une version en brouillon s'ajuste : elle doit être renvoyée en brouillon, ou un nouveau calcul lancé.",
      "Only a draft version can be adjusted: it must be sent back to draft, or a new computation run.",
    );
  }
  if (!aPermission(ctx.roles, "notation.gerer")) {
    return t(
      "L'ajustement revient au consultant ou au chef de mission.",
      "Adjustment is up to the consultant or the engagement manager.",
    );
  }
  if (ctx.missionCloturee) {
    return t(
      "La mission est clôturée : plus aucun ajustement n'est possible.",
      "The engagement is closed: no further adjustment is possible.",
    );
  }
  return t(
    "Aucune dimension notable à ajuster : complétez les réponses puis relancez un calcul.",
    "No rated dimension to adjust: complete the answers, then run a new computation.",
  );
}

/**
 * Raison pour laquelle un nouveau calcul n'est pas possible, ou null. `statutDerniere` est le
 * statut de la dernière version (null : aucun calcul encore).
 */
export function blocageCalcul(
  ctx: ContexteNotation,
  statutDerniere: StatutVersionNotation | null,
  langue: Langue = "fr",
): string | null {
  const t = creerTraduire(langue);
  if (!aPermission(ctx.roles, "notation.gerer")) {
    return t(
      "Le calcul d'une notation revient au consultant ou au chef de mission.",
      "Computing a rating is up to the consultant or the engagement manager.",
    );
  }
  if (ctx.missionCloturee) {
    return t(
      "La mission est clôturée : aucun nouveau calcul ni ajustement n'est possible. Les versions existantes restent consultables.",
      "The engagement is closed: no new computation or adjustment is possible. Existing versions remain viewable.",
    );
  }
  if (statutDerniere === "en_revue") {
    return t(
      "La dernière version est en revue : un expert métier doit la publier ou la renvoyer en brouillon avant un nouveau calcul.",
      "The latest version is in review: a business expert must publish it or send it back to draft before a new computation.",
    );
  }
  return null;
}
