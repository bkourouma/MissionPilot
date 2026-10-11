import { formaterJours } from "../planning/suivi-budget";
import { LIMITE_ELEMENTS_COPILOTE, type OutilLectureCopilote } from "./catalogue";

/*
 * Gabarits de réponse du copilote (AGT-08) : le CODE répond, jamais le modèle de langage. Chaque
 * réponse est construite à partir des FAITS rendus par les services de l'API (nombres, libellés
 * d'entités, dates), avec des phrases françaises fixes (pluriels, états vides). Aucun texte libre
 * n'est généré : aucun chiffre ne peut donc être inventé. Les libellés d'entités (titres,
 * intitulés, noms) sont recopiés tels quels et ne sont jamais interprétés ; un contenu issu d'un
 * client (verbatim, réponse de questionnaire, texte de document) n'entre dans aucun fait.
 */

export const MESSAGE_ACCES_REFUSE = "Vous n'avez pas accès à cette information.";
export const MESSAGE_ACTION_REFUSEE = "Vous n'avez pas le droit d'effectuer cette action.";
export const MESSAGE_MODE_SANS_IA =
  "Mode sans IA : votre demande a été comprise par des règles simples, sans modèle de langage.";
export const MESSAGE_MISSION_INTROUVABLE = "Aucune mission visible ne correspond à votre demande.";
export const QUESTION_MISSION = "De quelle mission parlez-vous ? Indiquez son nom.";

export interface ElementCopilote {
  libelle: string;
  detail?: string;
  /** Lien relatif vers l'écran de l'élément. */
  lien: string;
}

export interface ReponseComposee {
  texte: string;
  elements: ElementCopilote[];
}

/** « 1 tâche », « 0 tâche », « 3 tâches » : zéro et un prennent le singulier. */
export function compterCopilote(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

/** `AAAA-MM-JJ` → `JJ/MM/AAAA` (le reste est rendu tel quel). */
export function formaterDateCopilote(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const borner = <T>(liste: readonly T[]): T[] => liste.slice(0, LIMITE_ELEMENTS_COPILOTE);

function mentionTronque(total: number, affiches: number): string {
  return affiches > 0 && total > affiches
    ? ` Les ${affiches} premiers sont affichés sur ${total}.`
    : "";
}

/* ----- Mes tâches ----- */

export interface FaitsMesTaches {
  total: number;
  en_retard: number;
  taches: readonly {
    titre: string;
    echeance: string | null;
    en_retard: boolean;
    lien: string;
  }[];
}

export function composerMesTaches(f: FaitsMesTaches): ReponseComposee {
  const elements = borner(f.taches).map((t) => ({
    libelle: t.titre,
    detail: t.echeance
      ? `Échéance : ${formaterDateCopilote(t.echeance)}${t.en_retard ? " (en retard)" : ""}`
      : "Sans échéance",
    lien: t.lien,
  }));
  if (f.total === 0) return { texte: "Vous n'avez aucune tâche ouverte.", elements: [] };
  const retard =
    f.en_retard === 0
      ? "aucune en retard"
      : `dont ${compterCopilote(f.en_retard, "en retard", "en retard")}`;
  return {
    texte: `Vous avez ${compterCopilote(f.total, "tâche ouverte", "tâches ouvertes")}, ${retard}.${mentionTronque(f.total, elements.length)}`,
    elements,
  };
}

/* ----- Mes feuilles de temps ----- */

export interface FaitsMesFeuilles {
  total: number;
  feuilles: readonly { semaine: string; etat: "brouillon" | "rejetee" | "absente"; lien: string }[];
}

const ETAT_FEUILLE: Record<"brouillon" | "rejetee" | "absente", string> = {
  brouillon: "Brouillon à soumettre",
  rejetee: "Rejetée : à corriger puis soumettre",
  absente: "Pas encore commencée",
};

export function composerMesFeuilles(f: FaitsMesFeuilles): ReponseComposee {
  if (f.total === 0) {
    return { texte: "Aucune feuille de temps à soumettre : tout est à jour.", elements: [] };
  }
  const elements = borner(f.feuilles).map((x) => ({
    libelle: `Semaine du ${formaterDateCopilote(x.semaine)}`,
    detail: ETAT_FEUILLE[x.etat],
    lien: x.lien,
  }));
  return {
    texte: `Vous avez ${compterCopilote(f.total, "feuille de temps à soumettre", "feuilles de temps à soumettre")}.${mentionTronque(f.total, elements.length)}`,
    elements,
  };
}

/* ----- Résumé d'une mission ----- */

export const LIBELLES_STATUT_MISSION: Readonly<Record<string, string>> = {
  opportunite: "Opportunité",
  proposition: "Proposition",
  signee: "Signée",
  en_cours: "En cours",
  a_cloturer: "À clôturer",
  cloturee: "Clôturée",
};

export interface FaitsResumeMission {
  intitule: string;
  statut: string;
  lien: string;
  /** Avancement physique dans [0 ; 1] (moteur) ; null : non calculable ; absent : pas le droit. */
  avancement?: number | null;
  /** Jours (moteur) ; absent sans « budget.lire_jours ». */
  jours?: { budget: number; realise: number; atterrissage: number };
  jalons_en_retard: readonly { libelle: string; date_prevue: string }[];
  /** Libellés des KPI au rouge ; null sans « kpi.lire ». */
  kpi_rouges: readonly string[] | null;
  lien_kpi: string;
}

const pourcentage = (ratio: number): string =>
  `${String(Math.round(ratio * 1000) / 10).replace(".", ",")} %`;

export function composerResumeMission(f: FaitsResumeMission): ReponseComposee {
  const statut = LIBELLES_STATUT_MISSION[f.statut] ?? f.statut;
  const phrases = [`Mission « ${f.intitule} » : ${statut.toLowerCase()}.`];
  if (f.avancement !== undefined) {
    phrases.push(
      f.avancement === null
        ? "Avancement : pas encore calculable."
        : `Avancement : ${pourcentage(f.avancement)}.`,
    );
  }
  if (f.jours) {
    phrases.push(
      `Jours : budget ${formaterJours(f.jours.budget)} j, réalisé ${formaterJours(f.jours.realise)} j, atterrissage ${formaterJours(f.jours.atterrissage)} j.`,
    );
  }
  phrases.push(
    f.jalons_en_retard.length === 0
      ? "Aucun jalon en retard."
      : `${compterCopilote(f.jalons_en_retard.length, "jalon en retard", "jalons en retard")}.`,
  );
  if (f.kpi_rouges !== null) {
    phrases.push(
      f.kpi_rouges.length === 0
        ? "Aucun KPI au rouge."
        : `${compterCopilote(f.kpi_rouges.length, "KPI au rouge", "KPI au rouge")}.`,
    );
  }
  const elements: ElementCopilote[] = [
    ...f.jalons_en_retard.map((j) => ({
      libelle: j.libelle,
      detail: `Jalon prévu le ${formaterDateCopilote(j.date_prevue)}`,
      lien: f.lien,
    })),
    ...(f.kpi_rouges ?? []).map((k) => ({ libelle: k, detail: "KPI au rouge", lien: f.lien_kpi })),
  ];
  return { texte: phrases.join(" "), elements: borner(elements) };
}

export interface FaitsMissionsCandidates {
  candidates: readonly { intitule: string; lien: string }[];
}

export function composerMissionsCandidates(f: FaitsMissionsCandidates): ReponseComposee {
  return {
    texte: `Plusieurs missions correspondent : précisez laquelle (${f.candidates.length} proposées).`,
    elements: borner(f.candidates).map((c) => ({ libelle: c.intitule, lien: c.lien })),
  };
}

/* ----- KPI au rouge ----- */

export interface FaitsKpiRouges {
  missions_analysees: number;
  total_kpi: number;
  missions: readonly { intitule: string; lien: string; kpi: readonly string[] }[];
  /** Davantage de missions que la limite d'analyse. */
  tronque: boolean;
}

export function composerKpiRouges(f: FaitsKpiRouges): ReponseComposee {
  const limite = f.tronque ? " Seules les premières missions ont été analysées." : "";
  if (f.missions_analysees === 0) {
    return { texte: "Vous n'avez aucune mission en cours à analyser.", elements: [] };
  }
  if (f.total_kpi === 0) {
    return {
      texte: `Aucun KPI au rouge sur ${compterCopilote(f.missions_analysees, "de vos missions", "de vos missions")}.${limite}`,
      elements: [],
    };
  }
  const elements = borner(
    f.missions.flatMap((m) =>
      m.kpi.map((k) => ({ libelle: k, detail: `Mission « ${m.intitule} »`, lien: m.lien })),
    ),
  );
  return {
    texte: `${compterCopilote(f.total_kpi, "KPI au rouge", "KPI au rouge")} sur ${compterCopilote(f.missions.length, "mission", "missions")}.${mentionTronque(f.total_kpi, elements.length)}${limite}`,
    elements,
  };
}

/* ----- Factures échues ----- */

export interface FaitsFacturesEchues {
  total: number;
  /** Davantage de factures que la limite de lecture : le total est un minimum. */
  tronque: boolean;
  factures: readonly {
    libelle: string;
    client: string;
    echeance: string;
    jours_retard: number;
    /** Montant restant dû, formaté par le moteur ; null sans « finance.lire ». */
    solde: string | null;
    lien: string;
  }[];
  /** Totaux par devise formatés par le moteur ; null sans « finance.lire ». */
  totaux: readonly string[] | null;
}

export function composerFacturesEchues(f: FaitsFacturesEchues): ReponseComposee {
  if (f.total === 0) return { texte: "Aucune facture échue non soldée.", elements: [] };
  const elements = borner(f.factures).map((x) => ({
    libelle: x.libelle,
    detail: `${x.client} · ${compterCopilote(x.jours_retard, "jour de retard", "jours de retard")}, échue le ${formaterDateCopilote(x.echeance)}${x.solde ? ` · reste dû : ${x.solde}` : ""}`,
    lien: x.lien,
  }));
  const plus = f.tronque ? "au moins " : "";
  const totaux =
    f.totaux && f.totaux.length > 0 ? ` Total restant dû : ${f.totaux.join(" ; ")}.` : "";
  return {
    texte: `${plus}${compterCopilote(f.total, "facture échue non soldée", "factures échues non soldées")}.${totaux}${mentionTronque(f.total, elements.length)}`,
    elements,
  };
}

/* ----- Recherche ----- */

export const LIBELLES_TYPE_RESULTAT: Readonly<Record<string, string>> = {
  mission: "Mission",
  livrable: "Livrable",
  rapport: "Rapport",
  preuve: "Preuve",
  connaissance: "Retour d'expérience",
};

export interface FaitsRecherche {
  texte: string;
  total: number;
  tronque: boolean;
  resultats: readonly { type: string; titre: string; mission_intitule: string; lien: string }[];
}

export function composerRecherche(f: FaitsRecherche): ReponseComposee {
  if (f.total === 0) {
    return {
      texte: `Aucun résultat pour « ${f.texte} » dans ce que vous pouvez consulter.`,
      elements: [],
    };
  }
  const elements = borner(f.resultats).map((r) => ({
    libelle: r.titre,
    detail: `${LIBELLES_TYPE_RESULTAT[r.type] ?? r.type} · mission « ${r.mission_intitule} »`,
    lien: r.lien,
  }));
  return {
    texte: `${compterCopilote(f.total, "résultat", "résultats")} pour « ${f.texte} ».${mentionTronque(f.total, elements.length)}${f.tronque ? " D'autres résultats existent : précisez votre recherche." : ""}`,
    elements,
  };
}

/* ----- Action : créer une tâche ----- */

export interface FaitsCreerTache {
  titre: string;
  echeance: string | null;
  /** Nom du collaborateur ; null : l'utilisateur lui-même. */
  pour_nom: string | null;
  mission_intitule: string | null;
}

export const LIBELLE_ACTION_CREER_TACHE = "Créer une tâche";

/** Ce qui sera fait, champ par champ : le texte vient du code, jamais du modèle. */
export function resumerCreerTache(f: FaitsCreerTache): string {
  const morceaux = [
    `Créer la tâche « ${f.titre} »`,
    f.pour_nom ? `pour ${f.pour_nom}` : "pour vous",
    f.echeance ? `échéance le ${formaterDateCopilote(f.echeance)}` : "sans échéance",
    f.mission_intitule ? `liée à la mission « ${f.mission_intitule} »` : "sans mission liée",
  ];
  return `${morceaux.join(", ")}.`;
}

export const TEXTE_ACTION_PROPOSEE =
  "Je propose l'action ci-dessous. Elle ne sera effectuée que si vous la confirmez.";

/* ----- Aide et incompréhension ----- */

export const EXEMPLES_OUTILS: Readonly<Record<string, string>> = {
  mes_taches: "Quelles sont mes tâches en retard ?",
  mes_feuilles_temps: "Quelles feuilles de temps dois-je soumettre ?",
  resume_mission: "Où en est la mission Plan stratégique ?",
  kpi_rouges: "Quels KPI sont au rouge sur mes missions ?",
  factures_echues: "Quelles factures sont échues ?",
  recherche: "Cherche transformation digitale",
  creer_tache: "Crée une tâche : relancer le client avant le 15/11/2026",
};

export function composerAide(
  outils: readonly (OutilLectureCopilote | "creer_tache")[],
): ReponseComposee {
  const exemples = outils.map((o) => EXEMPLES_OUTILS[o]).filter((e): e is string => Boolean(e));
  return {
    texte:
      exemples.length === 0
        ? "Aucune question n'est disponible avec vos droits."
        : `Je peux répondre à des questions simples sur votre activité, dans vos droits. Par exemple : ${exemples.map((e) => `« ${e} »`).join(" ; ")}.`,
    elements: [],
  };
}

export const TEXTE_NON_COMPRIS =
  "Je n'ai pas compris votre demande. Reformulez-la, ou choisissez l'une des suggestions.";
