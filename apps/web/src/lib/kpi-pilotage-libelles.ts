/**
 * Libellés et mise en forme du pilotage augmenté des KPI. Voir `kpi-pilotage.ts`, point
 * d'entrée du module.
 */
import {
  RELATION_ARBRE_KPI_LIBELLES,
  STATUT_ACTION_KPI_LIBELLES,
  STATUT_DECISION_KPI_LIBELLES,
  STATUT_REVUE_KPI_LIBELLES,
  type StatutActionKpi,
  type StatutDecisionKpi,
} from "@missionpilot/shared";
import {
  formaterDate,
  formaterNombre,
  formaterPourcentage,
  libelleUnite,
  VALEUR_ABSENTE,
} from "./format";
import {
  descriptionAlerte,
  METHODE_PROJECTION_LIBELLES,
  type AlerteEnregistree,
  type ProjectionKpiVue,
} from "./kpi";
import type {
  DecisionKpi,
  EfficaciteVue,
  EvenementDecision,
  NiveauQualite,
  NoeudArbre,
  PointOrdreDuJour,
  RevueKpi,
  VerdictEfficacite,
} from "./kpi-pilotage-types";
import type { Resultat } from "./saisie";

// --- Libellés -------------------------------------------------------------------------------

export const LIBELLES_RELATION = RELATION_ARBRE_KPI_LIBELLES;
export const LIBELLES_STATUT_ACTION = STATUT_ACTION_KPI_LIBELLES;
export const LIBELLES_STATUT_DECISION = STATUT_DECISION_KPI_LIBELLES;
export const LIBELLES_STATUT_REVUE = STATUT_REVUE_KPI_LIBELLES;

export const LIBELLES_NIVEAU_QUALITE: Record<NiveauQualite, string> = {
  bon: "Bonne",
  moyen: "Moyenne",
  faible: "Faible",
};

export const LIBELLES_MOTIF_QUALITE: Record<string, string> = {
  AUCUNE_MESURE: "Aucune mesure alors que des périodes sont échues",
  MESURE_EN_RETARD: "Mesure en retard",
  PERIODES_MANQUANTES: "Périodes échues sans mesure",
  VALEURS_ABERRANTES: "Valeurs à vérifier (écart inhabituel)",
  CORRECTIONS_FREQUENTES: "Corrections fréquentes",
};

export const LIBELLES_VERDICT: Record<VerdictEfficacite, string> = {
  efficace: "Efficace : amélioration mesurée",
  inefficace: "Sans effet favorable : dégradation mesurée",
  neutre: "Neutre : variation dans la tolérance",
  indeterminee: "Indéterminée : périodes insuffisantes",
};

export const LIBELLES_POINT_REVUE: Record<string, string> = {
  OUVERTURE: "Ouverture",
  DECISION_OUVERTE: "Décision à suivre",
  ACTION_EN_RETARD: "Action en retard",
  ACTION_INEFFICACE: "Action sans effet mesuré",
  KPI_ROUGE: "KPI en rouge",
  KPI_DEGRADATION: "KPI en dégradation",
  KPI_ORANGE: "KPI en orange",
  QUALITE_DONNEES: "Qualité des données",
  KPI_NON_MESURE: "KPI non mesuré",
  DECISIONS_A_PRENDRE: "Décisions à prendre",
  MANUEL: "Point ajouté",
};

export const AVERTISSEMENT_EFFICACITE =
  "Variation avant/après : une corrélation dans le temps, pas une preuve que l'action en est la cause.";

// --- Mise en forme --------------------------------------------------------------------------

export function libelleNiveauQualite(n: NiveauQualite | null): string {
  return n ? LIBELLES_NIVEAU_QUALITE[n] : "Non évaluable";
}

/** « 79 / 100 », ou « — » sans score. */
export function texteScoreQualite(score: number | null): string {
  return score === null ? VALEUR_ABSENTE : `${formaterNombre(score, 0)} / 100`;
}

export const texteComposante = (v: number | null) => formaterPourcentage(v, 1);

export function libelleMotifQualite(code: string): string {
  return LIBELLES_MOTIF_QUALITE[code] ?? code;
}

/** Contribution signée : « +400 », « −200 » ; la couleur ne porte jamais seule le sens. */
export function texteContribution(v: number | null | undefined, unite = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return VALEUR_ABSENTE;
  const n = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 4,
    signDisplay: "exceptZero",
  }).format(v);
  return unite ? `${n}\u00a0${libelleUnite(unite)}` : n;
}

export function texteFavorable(f: boolean | null): string {
  if (f === null) return "Sans effet";
  return f ? "Favorable" : "Défavorable";
}

export function texteVerdict(e: Pick<EfficaciteVue, "verdict"> | null | undefined): string {
  return e ? LIBELLES_VERDICT[e.verdict] : "Pas encore mesurable (action non terminée)";
}

/** Détail chiffré de l'efficacité : moyennes avant et après, variation orientée. */
export function texteEfficaciteDetail(e: EfficaciteVue, unite: string): string {
  if (e.verdict === "indeterminee") {
    const manque = [
      e.manquant_avant > 0 ? `${e.manquant_avant} période(s) avant` : null,
      e.manquant_apres > 0 ? `${e.manquant_apres} période(s) après` : null,
    ].filter(Boolean);
    return `Il manque ${manque.join(" et ")} mesurée(s) et close(s) pour conclure.`;
  }
  const u = unite ? `\u00a0${libelleUnite(unite)}` : "";
  const rel =
    e.variation_relative === null ? "" : ` (${formaterPourcentage(e.variation_relative, 1)})`;
  return `Moyenne avant ${formaterNombre(e.moyenne_avant, 4)}${u}, après ${formaterNombre(e.moyenne_apres, 4)}${u} : variation ${texteContribution(e.variation, unite)}${rel}.`;
}

/** Projection de fin de période, arrondie à l'affichage (2 décimales) ; le moteur garde la valeur exacte. */
export function texteProjectionArrondie(
  p: ProjectionKpiVue | null | undefined,
  unite: string,
): string {
  if (!p || p.valeur_projetee === null) {
    return "Projection indisponible : aucune mesure exploitable dans la période en cours.";
  }
  const methode = METHODE_PROJECTION_LIBELLES[p.methode] ?? p.methode;
  const valeur = formaterNombre(p.valeur_projetee, 2);
  const u = unite ? `\u00a0${libelleUnite(unite)}` : "";
  const s = (n: number) => (n > 1 ? "s" : "");
  return `${valeur}${u} en fin de période (${methode}, ${p.jours_ecoules} jour${s(p.jours_ecoules)} écoulé${s(p.jours_ecoules)} sur ${p.jours_total})`;
}

/**
 * Part d'un nœud que l'arbre n'explique pas (valeur observée moins valeur calculée), en phrase :
 * « Non expliqué : +348 avant, +377 après ». Une valeur absente se dit « non mesuré ».
 */
export function texteResidu(avant: number | null, apres: number | null, unite = ""): string {
  if (avant === null && apres === null) return VALEUR_ABSENTE;
  const dire = (v: number | null) => (v === null ? "non mesuré" : texteContribution(v, unite));
  return `Non expliqué : ${dire(avant)} avant, ${dire(apres)} après`;
}

/**
 * Nœuds dans l'ordre de lecture d'un arbre : la racine d'abord, puis chaque levier suivi de ses
 * propres leviers ; les frères par rang puis par libellé. Un nœud dont le parent est absent de la
 * liste (cas anormal) est placé à la fin plutôt que perdu.
 */
export function ordonnerNoeudsArbre<
  T extends { id: string; parent_id: string | null; rang: number; libelle: string },
>(noeuds: readonly T[]): T[] {
  const enfants = new Map<string, T[]>();
  for (const n of noeuds) {
    if (n.parent_id === null) continue;
    const liste = enfants.get(n.parent_id) ?? [];
    liste.push(n);
    enfants.set(n.parent_id, liste);
  }
  const trier = (liste: T[]) =>
    [...liste].sort(
      (a, b) =>
        a.rang - b.rang || a.libelle.localeCompare(b.libelle, "fr") || a.id.localeCompare(b.id),
    );
  const sortie: T[] = [];
  const vus = new Set<string>();
  const parcourir = (n: T) => {
    if (vus.has(n.id)) return;
    vus.add(n.id);
    sortie.push(n);
    for (const e of trier(enfants.get(n.id) ?? [])) parcourir(e);
  };
  for (const r of trier(noeuds.filter((n) => n.parent_id === null))) parcourir(r);
  for (const n of noeuds) parcourir(n);
  return sortie;
}

const uniteNormalisee = (u: string | null | undefined) =>
  (u ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr-FR");

/**
 * Avertissement du formulaire d'ajout de levier : sous une SOMME, un KPI d'unité différente de celle
 * du parent (ou du premier levier qui en a une) n'a pas de sens à additionner, et l'API le
 * refuserait. Sous un produit, les unités peuvent différer. null s'il n'y a rien à dire.
 */
export function avertissementUniteLevier(
  parent: Pick<NoeudArbre, "id" | "relation" | "kpi_unite" | "libelle"> | undefined,
  noeuds: readonly Pick<NoeudArbre, "kpi_unite" | "parent_id" | "actif">[],
  uniteLevier: string | null | undefined,
): string | null {
  if (!parent || parent.relation !== "somme") return null;
  const choisie = uniteNormalisee(uniteLevier);
  if (choisie === "") return null;
  const reference =
    uniteNormalisee(parent.kpi_unite) !== ""
      ? parent.kpi_unite
      : noeuds.find(
          (f) => f.actif && f.parent_id === parent.id && uniteNormalisee(f.kpi_unite) !== "",
        )?.kpi_unite;
  if (!reference || uniteNormalisee(reference) === choisie) return null;
  return `Unités différentes : la somme n'a pas de sens (« ${(uniteLevier ?? "").trim()} » sous « ${parent.libelle} », qui additionne des « ${reference.trim()} »). Liez un KPI de même unité, ou faites combiner le nœud parent par un produit.`;
}

/**
 * Origine de l'ordre du jour affiché : proposé par le moteur, saisi à la main, ou les deux
 * (un point ajouté à la main parmi des points du moteur). null sans point.
 */
export function libelleOrigineOrdreDuJour(
  points: readonly Pick<PointOrdreDuJour, "origine">[],
): string | null {
  if (points.length === 0) return null;
  const moteur = points.filter((p) => p.origine === "moteur").length;
  const manuel = points.length - moteur;
  if (manuel === 0) return "Ordre du jour proposé par le moteur";
  if (moteur === 0) return "Ordre du jour saisi à la main";
  const s = (n: number) => (n > 1 ? "s" : "");
  return `Ordre du jour mixte : ${moteur} point${s(moteur)} proposé${s(moteur)} par le moteur, ${manuel} saisi${s(manuel)} à la main`;
}

/**
 * Événements d'une décision qui portent un commentaire (ce qui a été fait, motif), du plus ancien
 * au plus récent, avec une phrase qui dit qui a fait quoi et quand.
 */
export function commentairesDecision(
  evenements: readonly EvenementDecision[] | undefined,
  decisionId: string,
): { cle: string; texte: string; commentaire: string }[] {
  return (evenements ?? [])
    .filter((e) => e.decision_id === decisionId && e.commentaire !== null && e.commentaire !== "")
    .map((e) => {
      const statut =
        LIBELLES_STATUT_DECISION[e.statut_apres as StatutDecisionKpi] ?? e.statut_apres;
      const quoi =
        e.type === "statut"
          ? `Passée à « ${statut} »`
          : e.type === "creation"
            ? "Décision enregistrée"
            : "Décision modifiée";
      return {
        cle: e.id,
        texte: `${quoi}${e.auteur_nom ? ` par ${e.auteur_nom}` : ""}, le ${formaterDate(e.cree_le)}`,
        commentaire: e.commentaire as string,
      };
    });
}

/** Décision proposée dans le formulaire d'action : libellé lisible et KPI concerné (préremplissage). */
export interface OptionDecision {
  valeur: string;
  libelle: string;
  kpiId: string | null;
}

/** Libellé d'une décision pour une liste de choix : « Revue 2 · D1 — texte (ouverte) ». */
export function libelleOptionDecision(
  revue: Pick<RevueKpi, "numero" | "statut">,
  decision: Pick<DecisionKpi, "numero" | "libelle" | "statut">,
): string {
  const texte =
    decision.libelle.length > 70 ? `${decision.libelle.slice(0, 67)}…` : decision.libelle;
  const revueTexte =
    revue.statut === "tenue" ? "" : `, revue ${LIBELLES_STATUT_REVUE[revue.statut].toLowerCase()}`;
  return `Revue ${revue.numero} · D${decision.numero} — ${texte} (${LIBELLES_STATUT_DECISION[decision.statut].toLowerCase()}${revueTexte})`;
}

/** Décisions de revues → choix du formulaire d'action, dans l'ordre des revues puis des décisions. */
export function optionsDecisions(
  revues: readonly (Pick<RevueKpi, "numero" | "statut"> & { decisions: readonly DecisionKpi[] })[],
): OptionDecision[] {
  return revues.flatMap((r) =>
    r.decisions.map((d) => ({
      valeur: d.id,
      libelle: libelleOptionDecision(r, d),
      kpiId: d.kpi_id,
    })),
  );
}

/** Alertes d'un KPI → choix du formulaire d'action (la plus récente d'abord, comme l'API). */
export function optionsAlertes(
  alertes: readonly AlerteEnregistree[],
): { valeur: string; libelle: string }[] {
  return alertes.map((a) => ({
    valeur: a.id,
    libelle: `${descriptionAlerte({ ...(a.details ?? {}), code: a.code, periode: a.periode }, "").titre} (${a.periode})`,
  }));
}

/**
 * Erreur d'un champ à afficher : celle du dernier envoi, tant que la valeur saisie reste invalide.
 * Dès que le champ redevient valide, le message disparaît sans attendre un nouvel envoi.
 */
export function erreurEncoreValable<K extends string, C>(
  erreursEnvoi: Partial<Record<K, string>>,
  validation: Resultat<C, K>,
  champ: K,
): string | undefined {
  const envoi = erreursEnvoi[champ];
  if (!envoi) return undefined;
  return validation.ok || !validation.erreurs[champ] ? undefined : envoi;
}

export function enRetard(echeance: string, statut: StatutActionKpi, jour: string): boolean {
  return (statut === "a_faire" || statut === "en_cours") && echeance < jour;
}

export function libelleEcheance(echeance: string | null): string {
  return echeance ? formaterDate(echeance) : "Sans échéance";
}
