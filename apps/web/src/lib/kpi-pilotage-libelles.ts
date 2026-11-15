/**
 * Libellés et mise en forme du pilotage augmenté des KPI. Voir `kpi-pilotage.ts`, point
 * d'entrée du module.
 */
import {
  creerTraduire,
  LOCALES_INTL,
  RELATION_ARBRE_KPI_LIBELLES,
  STATUT_ACTION_KPI_LIBELLES,
  STATUT_DECISION_KPI_LIBELLES,
  STATUT_REVUE_KPI_LIBELLES,
  type Langue,
  type StatutActionKpi,
  type StatutDecisionKpi,
  type StatutRevueKpi,
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
  libelleMethodeProjection,
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

export const LIBELLES_RELATION_EN: Record<keyof typeof RELATION_ARBRE_KPI_LIBELLES, string> = {
  somme: "Weighted sum of the drivers",
  produit: "Product of the drivers",
};
export const LIBELLES_STATUT_ACTION_EN: Record<StatutActionKpi, string> = {
  a_faire: "To do",
  en_cours: "In progress",
  terminee: "Completed",
  abandonnee: "Abandoned",
};
export const LIBELLES_STATUT_DECISION_EN: Record<StatutDecisionKpi, string> = {
  ouverte: "Open",
  en_cours: "In progress",
  executee: "Executed",
  abandonnee: "Abandoned",
};
export const LIBELLES_STATUT_REVUE_EN: Record<StatutRevueKpi, string> = {
  planifiee: "Scheduled",
  tenue: "Held",
  cloturee: "Closed",
  annulee: "Cancelled",
};

/** Libellés de relation, de statuts d'action, de décision et de revue dans la langue demandée. */
export const libelleRelation = (
  c: keyof typeof RELATION_ARBRE_KPI_LIBELLES,
  langue: Langue = "fr",
) => (langue === "en" ? LIBELLES_RELATION_EN : LIBELLES_RELATION)[c];
export const libelleStatutAction = (c: StatutActionKpi, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_STATUT_ACTION_EN : LIBELLES_STATUT_ACTION)[c];
export const libelleStatutDecision = (c: StatutDecisionKpi, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_STATUT_DECISION_EN : LIBELLES_STATUT_DECISION)[c];
export const libelleStatutRevue = (c: StatutRevueKpi, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_STATUT_REVUE_EN : LIBELLES_STATUT_REVUE)[c];

export const LIBELLES_NIVEAU_QUALITE: Record<NiveauQualite, string> = {
  bon: "Bonne",
  moyen: "Moyenne",
  faible: "Faible",
};

export const LIBELLES_NIVEAU_QUALITE_EN: Record<NiveauQualite, string> = {
  bon: "Good",
  moyen: "Medium",
  faible: "Low",
};

export const LIBELLES_MOTIF_QUALITE: Record<string, string> = {
  AUCUNE_MESURE: "Aucune mesure alors que des périodes sont échues",
  MESURE_EN_RETARD: "Mesure en retard",
  PERIODES_MANQUANTES: "Périodes échues sans mesure",
  VALEURS_ABERRANTES: "Valeurs à vérifier (écart inhabituel)",
  CORRECTIONS_FREQUENTES: "Corrections fréquentes",
};

export const LIBELLES_MOTIF_QUALITE_EN: Record<string, string> = {
  AUCUNE_MESURE: "No measurement although periods are due",
  MESURE_EN_RETARD: "Measurement overdue",
  PERIODES_MANQUANTES: "Due periods without measurement",
  VALEURS_ABERRANTES: "Values to check (unusual gap)",
  CORRECTIONS_FREQUENTES: "Frequent corrections",
};

export const LIBELLES_VERDICT: Record<VerdictEfficacite, string> = {
  efficace: "Efficace : amélioration mesurée",
  inefficace: "Sans effet favorable : dégradation mesurée",
  neutre: "Neutre : variation dans la tolérance",
  indeterminee: "Indéterminée : périodes insuffisantes",
};

export const LIBELLES_VERDICT_EN: Record<VerdictEfficacite, string> = {
  efficace: "Effective: improvement measured",
  inefficace: "No favorable effect: deterioration measured",
  neutre: "Neutral: variation within tolerance",
  indeterminee: "Undetermined: not enough periods",
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

export const LIBELLES_POINT_REVUE_EN: Record<string, string> = {
  OUVERTURE: "Opening",
  DECISION_OUVERTE: "Decision to follow up",
  ACTION_EN_RETARD: "Overdue action",
  ACTION_INEFFICACE: "Action with no measured effect",
  KPI_ROUGE: "Red KPI",
  KPI_DEGRADATION: "Deteriorating KPI",
  KPI_ORANGE: "Orange KPI",
  QUALITE_DONNEES: "Data quality",
  KPI_NON_MESURE: "Unmeasured KPI",
  DECISIONS_A_PRENDRE: "Decisions to make",
  MANUEL: "Added item",
};

/** Libellé d'un point d'ordre du jour ; un code inconnu est rendu tel quel. */
export const libellePointRevue = (code: string, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_POINT_REVUE_EN : LIBELLES_POINT_REVUE)[code] ?? code;

export const AVERTISSEMENT_EFFICACITE =
  "Variation avant/après : une corrélation dans le temps, pas une preuve que l'action en est la cause.";

export const AVERTISSEMENT_EFFICACITE_EN =
  "Before/after variation: a correlation over time, not proof that the action is the cause.";

// --- Mise en forme --------------------------------------------------------------------------

export function libelleNiveauQualite(n: NiveauQualite | null, langue: Langue = "fr"): string {
  if (!n) return langue === "en" ? "Not assessable" : "Non évaluable";
  return (langue === "en" ? LIBELLES_NIVEAU_QUALITE_EN : LIBELLES_NIVEAU_QUALITE)[n];
}

/** « 79 / 100 », ou « — » sans score. */
export function texteScoreQualite(score: number | null, langue: Langue = "fr"): string {
  return score === null ? VALEUR_ABSENTE : `${formaterNombre(score, 0, langue)} / 100`;
}

export const texteComposante = (v: number | null, langue: Langue = "fr") =>
  formaterPourcentage(v, 1, langue);

export function libelleMotifQualite(code: string, langue: Langue = "fr"): string {
  return (langue === "en" ? LIBELLES_MOTIF_QUALITE_EN : LIBELLES_MOTIF_QUALITE)[code] ?? code;
}

/** Contribution signée : « +400 », « −200 » ; la couleur ne porte jamais seule le sens. */
export function texteContribution(
  v: number | null | undefined,
  unite = "",
  langue: Langue = "fr",
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return VALEUR_ABSENTE;
  const n = new Intl.NumberFormat(LOCALES_INTL[langue], {
    maximumFractionDigits: 4,
    signDisplay: "exceptZero",
  }).format(v);
  return unite ? `${n}\u00a0${libelleUnite(unite)}` : n;
}

export function texteFavorable(f: boolean | null, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (f === null) return t("Sans effet", "No effect");
  return f ? t("Favorable", "Favorable") : t("Défavorable", "Unfavorable");
}

export function texteVerdict(
  e: Pick<EfficaciteVue, "verdict"> | null | undefined,
  langue: Langue = "fr",
): string {
  return e
    ? (langue === "en" ? LIBELLES_VERDICT_EN : LIBELLES_VERDICT)[e.verdict]
    : creerTraduire(langue)(
        "Pas encore mesurable (action non terminée)",
        "Not yet measurable (action not completed)",
      );
}

/** Détail chiffré de l'efficacité : moyennes avant et après, variation orientée. */
export function texteEfficaciteDetail(
  e: EfficaciteVue,
  unite: string,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (e.verdict === "indeterminee") {
    const manque = [
      e.manquant_avant > 0
        ? t(`${e.manquant_avant} période(s) avant`, `${e.manquant_avant} period(s) before`)
        : null,
      e.manquant_apres > 0
        ? t(`${e.manquant_apres} période(s) après`, `${e.manquant_apres} period(s) after`)
        : null,
    ].filter(Boolean);
    return t(
      `Il manque ${manque.join(" et ")} mesurée(s) et close(s) pour conclure.`,
      `${manque.join(" and ")} measured and closed are missing to conclude.`,
    );
  }
  const u = unite ? `\u00a0${libelleUnite(unite)}` : "";
  const rel =
    e.variation_relative === null
      ? ""
      : ` (${formaterPourcentage(e.variation_relative, 1, langue)})`;
  const avant = formaterNombre(e.moyenne_avant, 4, langue);
  const apres = formaterNombre(e.moyenne_apres, 4, langue);
  const variation = texteContribution(e.variation, unite, langue);
  return t(
    `Moyenne avant ${avant}${u}, après ${apres}${u} : variation ${variation}${rel}.`,
    `Average before ${avant}${u}, after ${apres}${u}: variation ${variation}${rel}.`,
  );
}

/** Projection de fin de période, arrondie à l'affichage (2 décimales) ; le moteur garde la valeur exacte. */
export function texteProjectionArrondie(
  p: ProjectionKpiVue | null | undefined,
  unite: string,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (!p || p.valeur_projetee === null) {
    return t(
      "Projection indisponible : aucune mesure exploitable dans la période en cours.",
      "Projection unavailable: no usable measurement in the current period.",
    );
  }
  const methode = libelleMethodeProjection(p.methode, langue);
  const valeur = formaterNombre(p.valeur_projetee, 2, langue);
  const u = unite ? `\u00a0${libelleUnite(unite)}` : "";
  const s = (n: number) => (n > 1 ? "s" : "");
  return t(
    `${valeur}${u} en fin de période (${methode}, ${p.jours_ecoules} jour${s(p.jours_ecoules)} écoulé${s(p.jours_ecoules)} sur ${p.jours_total})`,
    `${valeur}${u} at period end (${methode}, ${p.jours_ecoules} day${s(p.jours_ecoules)} elapsed of ${p.jours_total})`,
  );
}

/**
 * Part d'un nœud que l'arbre n'explique pas (valeur observée moins valeur calculée), en phrase :
 * « Non expliqué : +348 avant, +377 après ». Une valeur absente se dit « non mesuré ».
 */
export function texteResidu(
  avant: number | null,
  apres: number | null,
  unite = "",
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (avant === null && apres === null) return VALEUR_ABSENTE;
  const dire = (v: number | null) =>
    v === null ? t("non mesuré", "not measured") : texteContribution(v, unite, langue);
  return t(
    `Non expliqué : ${dire(avant)} avant, ${dire(apres)} après`,
    `Unexplained: ${dire(avant)} before, ${dire(apres)} after`,
  );
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
  langue: Langue = "fr",
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
  const levier = (uniteLevier ?? "").trim();
  return creerTraduire(langue)(
    `Unités différentes : la somme n'a pas de sens (« ${levier} » sous « ${parent.libelle} », qui additionne des « ${reference.trim()} »). Liez un KPI de même unité, ou faites combiner le nœud parent par un produit.`,
    `Different units: the sum makes no sense ("${levier}" under "${parent.libelle}", which adds up "${reference.trim()}"). Link a KPI with the same unit, or have the parent node combined by a product.`,
  );
}

/**
 * Origine de l'ordre du jour affiché : proposé par le moteur, saisi à la main, ou les deux
 * (un point ajouté à la main parmi des points du moteur). null sans point.
 */
export function libelleOrigineOrdreDuJour(
  points: readonly Pick<PointOrdreDuJour, "origine">[],
  langue: Langue = "fr",
): string | null {
  const t = creerTraduire(langue);
  if (points.length === 0) return null;
  const moteur = points.filter((p) => p.origine === "moteur").length;
  const manuel = points.length - moteur;
  if (manuel === 0)
    return t("Ordre du jour proposé par le moteur", "Agenda proposed by the engine");
  if (moteur === 0) return t("Ordre du jour saisi à la main", "Agenda entered manually");
  const s = (n: number) => (n > 1 ? "s" : "");
  return t(
    `Ordre du jour mixte : ${moteur} point${s(moteur)} proposé${s(moteur)} par le moteur, ${manuel} saisi${s(manuel)} à la main`,
    `Mixed agenda: ${moteur} item${s(moteur)} proposed by the engine, ${manuel} entered manually`,
  );
}

/**
 * Événements d'une décision qui portent un commentaire (ce qui a été fait, motif), du plus ancien
 * au plus récent, avec une phrase qui dit qui a fait quoi et quand.
 */
export function commentairesDecision(
  evenements: readonly EvenementDecision[] | undefined,
  decisionId: string,
  langue: Langue = "fr",
): { cle: string; texte: string; commentaire: string }[] {
  const t = creerTraduire(langue);
  return (evenements ?? [])
    .filter((e) => e.decision_id === decisionId && e.commentaire !== null && e.commentaire !== "")
    .map((e) => {
      const statut =
        libelleStatutDecision(e.statut_apres as StatutDecisionKpi, langue) ?? e.statut_apres;
      const quoi =
        e.type === "statut"
          ? t(`Passée à « ${statut} »`, `Moved to "${statut}"`)
          : e.type === "creation"
            ? t("Décision enregistrée", "Decision recorded")
            : t("Décision modifiée", "Decision edited");
      const date = formaterDate(e.cree_le, "UTC", langue);
      return {
        cle: e.id,
        texte: t(
          `${quoi}${e.auteur_nom ? ` par ${e.auteur_nom}` : ""}, le ${date}`,
          `${quoi}${e.auteur_nom ? ` by ${e.auteur_nom}` : ""}, on ${date}`,
        ),
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
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const texte =
    decision.libelle.length > 70 ? `${decision.libelle.slice(0, 67)}…` : decision.libelle;
  const statutRevue = libelleStatutRevue(revue.statut, langue).toLowerCase();
  const revueTexte =
    revue.statut === "tenue" ? "" : t(`, revue ${statutRevue}`, `, review ${statutRevue}`);
  return `${t("Revue", "Review")} ${revue.numero} · D${decision.numero} — ${texte} (${libelleStatutDecision(decision.statut, langue).toLowerCase()}${revueTexte})`;
}

/** Décisions de revues → choix du formulaire d'action, dans l'ordre des revues puis des décisions. */
export function optionsDecisions(
  revues: readonly (Pick<RevueKpi, "numero" | "statut"> & { decisions: readonly DecisionKpi[] })[],
  langue: Langue = "fr",
): OptionDecision[] {
  return revues.flatMap((r) =>
    r.decisions.map((d) => ({
      valeur: d.id,
      libelle: libelleOptionDecision(r, d, langue),
      kpiId: d.kpi_id,
    })),
  );
}

/** Alertes d'un KPI → choix du formulaire d'action (la plus récente d'abord, comme l'API). */
export function optionsAlertes(
  alertes: readonly AlerteEnregistree[],
  langue: Langue = "fr",
): { valeur: string; libelle: string }[] {
  return alertes.map((a) => ({
    valeur: a.id,
    libelle: `${descriptionAlerte({ ...(a.details ?? {}), code: a.code, periode: a.periode }, "", langue).titre} (${a.periode})`,
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

export function libelleEcheance(echeance: string | null, langue: Langue = "fr"): string {
  return echeance
    ? formaterDate(echeance, "UTC", langue)
    : creerTraduire(langue)("Sans échéance", "No due date");
}
