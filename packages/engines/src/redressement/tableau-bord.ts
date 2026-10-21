/**
 * Voyant de pilotage d'un dossier de redressement (RED-15, version interne). Fonctions pures,
 * déterministes, sans horloge ni entrée/sortie, sans IA : le voyant est calculé à partir de
 * résultats DÉJÀ produits par les autres moteurs (urgence, alerte précoce, trésorerie, covenants,
 * plan, suivi, clôture). Il est INDICATIF : il aide à ordonner l'attention d'un portefeuille, il
 * ne qualifie jamais la situation juridique du client.
 *
 * Toutes les règles ci-dessous sont PROVISOIRES (à valider par un expert) ; elles sont réunies en
 * constantes nommées pour être ajustées sans toucher à l'algorithme.
 *
 * Règles (le voyant est celui du motif le plus grave) :
 *  - URGENCE : voyant d'urgence rouge -> critique ; orange -> vigilance ;
 *  - ALERTE : niveau d'alerte précoce critique -> critique ; élevé ou modéré -> vigilance ;
 *  - TRÉSORERIE : au moins SEMAINES_TENSION_CRITIQUE semaines de tension -> critique ; au moins une -> vigilance ;
 *  - COVENANTS : au moins COVENANTS_DEFAUT_CRITIQUE covenants en défaut -> critique ; au moins un -> vigilance ;
 *  - ACTIONS : au moins ACTIONS_RETARD_CRITIQUE actions en retard -> critique ; au moins une -> vigilance ;
 *  - SUIVI (dossier clos) : au moins une alerte « attention » -> vigilance ; les autres alertes -> information ;
 *  - CLÔTURE (dossier clos) : bilan absent ou en brouillon -> information.
 * Sans aucune donnée exploitable et sans motif : voyant « inconnu ».
 */
import type { NiveauAlerte } from "./alerte";
import type { VoyantUrgence } from "./urgence";

/** PROVISOIRE : semaines de tension à partir desquelles la trésorerie est jugée critique. */
export const SEMAINES_TENSION_CRITIQUE = 4;
/** PROVISOIRE : covenants en défaut à partir desquels le motif est critique. */
export const COVENANTS_DEFAUT_CRITIQUE = 2;
/** PROVISOIRE : actions en retard à partir desquelles le motif est critique. */
export const ACTIONS_RETARD_CRITIQUE = 5;
/** Nombre maximal de motifs rendus pour le portefeuille (« motifs principaux »). */
export const MOTIFS_PRINCIPAUX_MAX = 3;

export type VoyantPilotage = "vert" | "orange" | "rouge" | "inconnu";
export const VOYANTS_PILOTAGE: readonly VoyantPilotage[] = ["rouge", "orange", "vert", "inconnu"];

/** Gravité d'un motif : « critique » -> rouge, « vigilance » -> orange, « information » -> sans effet. */
export type GraviteMotifPilotage = "critique" | "vigilance" | "information";

export type CodeMotifPilotage =
  | "URGENCE_ROUGE"
  | "URGENCE_ORANGE"
  | "ALERTE_CRITIQUE"
  | "ALERTE_ELEVEE"
  | "ALERTE_MODEREE"
  | "TRESORERIE_TENSION_PROLONGEE"
  | "TRESORERIE_TENSION"
  | "COVENANTS_DEFAUT_MULTIPLES"
  | "COVENANT_DEFAUT"
  | "ACTIONS_RETARD_NOMBREUSES"
  | "ACTIONS_RETARD"
  | "SUIVI_ATTENTION"
  | "SUIVI_INFORMATION"
  | "CLOTURE_ABSENTE"
  | "CLOTURE_BROUILLON";

export interface MotifVoyant {
  readonly code: CodeMotifPilotage;
  readonly gravite: GraviteMotifPilotage;
  /** Libellé français, sans qualification juridique. */
  readonly libelle: string;
}

/**
 * Entrées déjà calculées. `null` signifie « donnée absente » (rien n'est supposé).
 */
export interface EntreesVoyant {
  /** Dernier voyant d'urgence du dossier ; `non_evalue` et `null` valent « absent ». */
  readonly voyantUrgence: VoyantUrgence | null;
  /** Dernier niveau d'alerte précoce ; `insuffisant` et `null` valent « absent ». */
  readonly niveauAlerte: NiveauAlerte | null;
  /** Nombre de semaines de tension de la trésorerie courante ; null sans prévision. */
  readonly semainesTension: number | null;
  /** Covenants en défaut de la version courante ; null si aucun covenant défini. */
  readonly covenantsEnDefaut: number | null;
  /** Actions du plan en retard à la date de référence. */
  readonly actionsEnRetard: number;
  /** Alertes du suivi post-mission (dossier clos) ; null hors dossier clos ou sans suivi. */
  readonly alertesSuivi: { readonly nombre: number; readonly attention: number } | null;
  /** Statut du bilan de clôture ; null hors dossier clos. */
  readonly statutCloture: "absent" | "brouillon" | "valide" | null;
}

export interface EtatVoyant {
  readonly voyant: VoyantPilotage;
  /** Motifs du plus grave au moins grave (ordre stable des règles à gravité égale). */
  readonly motifs: readonly MotifVoyant[];
  /** Au moins une donnée exploitable a été fournie. */
  readonly donneesDisponibles: boolean;
}

const RANG_GRAVITE: Readonly<Record<GraviteMotifPilotage, number>> = {
  critique: 0,
  vigilance: 1,
  information: 2,
};

function entierPositif(valeur: number | null, nom: string): number | null {
  if (valeur === null) return null;
  if (!Number.isInteger(valeur) || valeur < 0) {
    throw new RangeError(`${nom} doit être un entier positif ou nul.`);
  }
  return valeur;
}

const pluriel = (n: number, un: string, plusieurs: string): string => (n > 1 ? plusieurs : un);

/** Calcule le voyant de pilotage et ses motifs. Lève RangeError sur un compteur négatif ou non entier. */
export function calculerEtatVoyant(entrees: EntreesVoyant): EtatVoyant {
  const semaines = entierPositif(entrees.semainesTension, "semainesTension");
  const covenants = entierPositif(entrees.covenantsEnDefaut, "covenantsEnDefaut");
  const retard = entierPositif(entrees.actionsEnRetard, "actionsEnRetard") ?? 0;
  const suivi = entrees.alertesSuivi;
  if (suivi) {
    entierPositif(suivi.nombre, "alertesSuivi.nombre");
    entierPositif(suivi.attention, "alertesSuivi.attention");
  }

  const motifs: MotifVoyant[] = [];
  const ajouter = (code: CodeMotifPilotage, gravite: GraviteMotifPilotage, libelle: string) =>
    motifs.push({ code, gravite, libelle });

  if (entrees.voyantUrgence === "rouge") {
    ajouter("URGENCE_ROUGE", "critique", "Le dernier diagnostic d'urgence est au rouge.");
  } else if (entrees.voyantUrgence === "orange") {
    ajouter("URGENCE_ORANGE", "vigilance", "Le dernier diagnostic d'urgence est à l'orange.");
  }

  if (entrees.niveauAlerte === "critique") {
    ajouter("ALERTE_CRITIQUE", "critique", "Le score d'alerte précoce est au niveau critique.");
  } else if (entrees.niveauAlerte === "eleve") {
    ajouter("ALERTE_ELEVEE", "vigilance", "Le score d'alerte précoce est au niveau élevé.");
  } else if (entrees.niveauAlerte === "modere") {
    ajouter("ALERTE_MODEREE", "vigilance", "Le score d'alerte précoce est au niveau modéré.");
  }

  if (semaines !== null && semaines > 0) {
    const critique = semaines >= SEMAINES_TENSION_CRITIQUE;
    ajouter(
      critique ? "TRESORERIE_TENSION_PROLONGEE" : "TRESORERIE_TENSION",
      critique ? "critique" : "vigilance",
      `La trésorerie prévisionnelle passe sous le seuil de tension ${semaines} ${pluriel(semaines, "semaine", "semaines")} sur 13.`,
    );
  }

  if (covenants !== null && covenants > 0) {
    const critique = covenants >= COVENANTS_DEFAUT_CRITIQUE;
    ajouter(
      critique ? "COVENANTS_DEFAUT_MULTIPLES" : "COVENANT_DEFAUT",
      critique ? "critique" : "vigilance",
      `${covenants} ${pluriel(covenants, "covenant n'est pas respecté", "covenants ne sont pas respectés")} sur le dernier exercice.`,
    );
  }

  if (retard > 0) {
    const critique = retard >= ACTIONS_RETARD_CRITIQUE;
    ajouter(
      critique ? "ACTIONS_RETARD_NOMBREUSES" : "ACTIONS_RETARD",
      critique ? "critique" : "vigilance",
      `${retard} ${pluriel(retard, "action du plan est en retard", "actions du plan sont en retard")}.`,
    );
  }

  if (suivi && suivi.nombre > 0) {
    if (suivi.attention > 0) {
      ajouter(
        "SUIVI_ATTENTION",
        "vigilance",
        `Le suivi après mission signale ${suivi.attention} ${pluriel(suivi.attention, "point d'attention", "points d'attention")}.`,
      );
    } else {
      ajouter(
        "SUIVI_INFORMATION",
        "information",
        `Le suivi après mission signale ${suivi.nombre} ${pluriel(suivi.nombre, "information", "informations")}.`,
      );
    }
  }

  if (entrees.statutCloture === "absent") {
    ajouter("CLOTURE_ABSENTE", "information", "Le bilan de clôture n'est pas encore établi.");
  } else if (entrees.statutCloture === "brouillon") {
    ajouter("CLOTURE_BROUILLON", "information", "Le bilan de clôture est en brouillon.");
  }

  // Tri stable : gravité décroissante, ordre des règles à gravité égale.
  const ordonnes = motifs
    .map((m, i) => ({ m, i }))
    .sort((a, b) => RANG_GRAVITE[a.m.gravite] - RANG_GRAVITE[b.m.gravite] || a.i - b.i)
    .map((x) => x.m);

  const donneesDisponibles =
    (entrees.voyantUrgence !== null && entrees.voyantUrgence !== "non_evalue") ||
    (entrees.niveauAlerte !== null && entrees.niveauAlerte !== "insuffisant") ||
    semaines !== null ||
    covenants !== null ||
    retard > 0 ||
    suivi !== null ||
    entrees.statutCloture === "brouillon" ||
    entrees.statutCloture === "valide";

  let voyant: VoyantPilotage;
  if (!donneesDisponibles) voyant = "inconnu";
  else if (ordonnes.some((m) => m.gravite === "critique")) voyant = "rouge";
  else if (ordonnes.some((m) => m.gravite === "vigilance")) voyant = "orange";
  else voyant = "vert";

  return { voyant, motifs: ordonnes, donneesDisponibles };
}

/** Compte des dossiers par voyant ; chaque voyant est présent (zéro si aucun). */
export type SynthesePortefeuilleVoyants = Readonly<Record<VoyantPilotage, number>>;

/** Nombre de dossiers par voyant. */
export function synthetiserPortefeuilleVoyants(
  voyants: readonly VoyantPilotage[],
): SynthesePortefeuilleVoyants {
  const synthese: Record<VoyantPilotage, number> = { rouge: 0, orange: 0, vert: 0, inconnu: 0 };
  for (const v of voyants) synthese[v] += 1;
  return synthese;
}

type ElementTriable = {
  readonly voyant: VoyantPilotage;
  readonly motifs: readonly MotifVoyant[];
};

/**
 * Comparateur d'attention : rouge, orange, vert, inconnu ; à voyant égal, le dossier ayant le plus
 * de motifs critiques puis de motifs de vigilance passe en premier. Négatif = a plus urgent que b.
 */
export function comparerAttention(a: ElementTriable, b: ElementTriable): number {
  const rang = (v: VoyantPilotage) => VOYANTS_PILOTAGE.indexOf(v);
  const compte = (x: ElementTriable, g: GraviteMotifPilotage) =>
    x.motifs.filter((m) => m.gravite === g).length;
  return (
    rang(a.voyant) - rang(b.voyant) ||
    compte(b, "critique") - compte(a, "critique") ||
    compte(b, "vigilance") - compte(a, "vigilance")
  );
}

/** Motifs principaux (les plus graves, `MOTIFS_PRINCIPAUX_MAX` au plus). */
export function motifsPrincipaux(motifs: readonly MotifVoyant[]): MotifVoyant[] {
  return motifs.slice(0, MOTIFS_PRINCIPAUX_MAX);
}
