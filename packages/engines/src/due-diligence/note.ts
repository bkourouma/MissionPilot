/**
 * Contrôle de la note au comité (DD-13, SPEC-3b §5.9) : bloquants (la note ne se soumet pas),
 * avertissements, sections de chaque variante. Fonctions pures ; les compteurs viennent des autres
 * moteurs et du registre des preuves (PRV-03).
 */
import { ErreurDueDiligence } from "./erreurs";
import {
  RECOMMANDATIONS_NOTE,
  VARIANTES_NOTE,
  type RecommandationNote,
  type VarianteNote,
  type VerdictDd,
} from "./vocabulaire";

export type SectionNote =
  | "recommandation"
  | "synthese"
  | "cadrage"
  | "verdicts"
  | "analyses"
  | "chaine_valeur"
  | "risques"
  | "signaux"
  | "marche"
  | "sensibilite"
  | "filtrage_es"
  | "plan_100_jours"
  | "ajustements"
  | "sources";

const SECTIONS_EXECUTIVE: readonly SectionNote[] = [
  "recommandation",
  "synthese",
  "verdicts",
  "risques",
  "marche",
  "filtrage_es",
  "plan_100_jours",
  "ajustements",
];
const SECTIONS_DETAILLEE: readonly SectionNote[] = [
  "recommandation",
  "synthese",
  "cadrage",
  "verdicts",
  "analyses",
  "chaine_valeur",
  "risques",
  "signaux",
  "marche",
  "sensibilite",
  "filtrage_es",
  "plan_100_jours",
  "ajustements",
  "sources",
];

/** Sections de la note, dans l'ordre du rendu ; l'exécutive est incluse dans la détaillée. */
export function sectionsDeLaNote(variante: VarianteNote): readonly SectionNote[] {
  if (!(VARIANTES_NOTE as readonly string[]).includes(variante)) {
    throw new ErreurDueDiligence("ENTREE_INVALIDE", `Variante inconnue : « ${String(variante)} ».`);
  }
  return variante === "executive" ? SECTIONS_EXECUTIVE : SECTIONS_DETAILLEE;
}

export interface HypotheseNote {
  readonly id: string;
  readonly parentId: string | null;
  readonly retiree: boolean;
  /** Verdict en vigueur (validé). */
  readonly verdict: VerdictDd | null;
}
export interface EntreeControleNote {
  readonly recommandation: RecommandationNote;
  readonly nbConditions: number;
  readonly hypotheses: readonly HypotheseNote[];
  /** Assertions R2/R3 du dossier sans preuve « pour » ni avis signé (PRV-03). */
  readonly anomaliesSources: number;
  /** `touchesBloquantes`. */
  readonly exclusionsBloquantes: number;
  /** Longueur de `aDocumenter` des risques. */
  readonly risquesCritiquesFragiles: number;
  readonly marche: { readonly present: boolean; readonly recoupementAlerte: boolean };
  readonly incoherencesArbre: number;
}
export type CodeBloquantNote =
  | "SANS_HYPOTHESE"
  | "HYPOTHESE_SANS_VERDICT_VALIDE"
  | "SOURCES_MANQUANTES"
  | "EXCLUSION_NON_LEVEE_FAVORABLE"
  | "HYPOTHESE_INFIRMEE_FAVORABLE"
  | "CONDITIONS_MANQUANTES";
export type CodeAvertissementNote =
  | "RISQUES_CRITIQUES_FRAGILES"
  | "AUCUN_DIMENSIONNEMENT"
  | "RECOUPEMENT_MARCHE_DIVERGENT"
  | "ARBRE_INCOHERENT";
export interface ControleNote {
  /** Ordre de la déclaration de `CodeBloquantNote`. */
  readonly bloquants: readonly CodeBloquantNote[];
  readonly avertissements: readonly CodeAvertissementNote[];
  readonly soumissible: boolean;
}

function entree(message: string): never {
  throw new ErreurDueDiligence("ENTREE_INVALIDE", message);
}

function compteurValide(valeur: number, nom: string): void {
  if (!Number.isInteger(valeur) || valeur < 0) entree(`${nom} : entier positif ou nul attendu.`);
}

/** Hypothèses effectivement retirées : une hypothèse dont un ancêtre est retiré l'est aussi. */
function retraitsEffectifs(hypotheses: readonly HypotheseNote[]): Map<string, boolean> {
  const parId = new Map<string, HypotheseNote>();
  for (const h of hypotheses) {
    if (parId.has(h.id)) entree(`Hypothèse « ${h.id} » en double.`);
    parId.set(h.id, h);
  }
  const resultat = new Map<string, boolean>();
  for (const h of hypotheses) {
    let retire = false;
    const vus = new Set<string>();
    let courant: HypotheseNote | undefined = h;
    while (courant !== undefined) {
      if (vus.has(courant.id)) entree(`Hypothèse « ${h.id} » : cycle dans l'arbre.`);
      vus.add(courant.id);
      retire = retire || courant.retiree;
      if (courant.parentId === null) break;
      courant = parId.get(courant.parentId);
      if (courant === undefined) entree(`Hypothèse « ${h.id} » : parent inconnu.`);
    }
    resultat.set(h.id, retire);
  }
  return resultat;
}

export function controlerNoteComite(entreeControle: EntreeControleNote): ControleNote {
  const e = entreeControle;
  if (!(RECOMMANDATIONS_NOTE as readonly string[]).includes(e.recommandation)) {
    entree(`Recommandation inconnue : « ${String(e.recommandation)} ».`);
  }
  compteurValide(e.nbConditions, "Nombre de conditions");
  compteurValide(e.anomaliesSources, "Anomalies de sources");
  compteurValide(e.exclusionsBloquantes, "Exclusions bloquantes");
  compteurValide(e.risquesCritiquesFragiles, "Risques critiques fragiles");
  compteurValide(e.incoherencesArbre, "Incohérences de l'arbre");

  const retraits = retraitsEffectifs(e.hypotheses);
  const actives = e.hypotheses.filter((h) => retraits.get(h.id) !== true);
  const favorable = e.recommandation === "favorable";
  const favorableOuConditions = favorable || e.recommandation === "favorable_sous_conditions";

  const bloquants: CodeBloquantNote[] = [];
  if (actives.length === 0) bloquants.push("SANS_HYPOTHESE");
  if (actives.some((h) => h.verdict === null)) bloquants.push("HYPOTHESE_SANS_VERDICT_VALIDE");
  if (e.anomaliesSources > 0) bloquants.push("SOURCES_MANQUANTES");
  if (e.exclusionsBloquantes > 0 && favorableOuConditions) {
    bloquants.push("EXCLUSION_NON_LEVEE_FAVORABLE");
  }
  if (favorable && actives.some((h) => h.parentId === null && h.verdict === "infirmee")) {
    bloquants.push("HYPOTHESE_INFIRMEE_FAVORABLE");
  }
  if (e.recommandation === "favorable_sous_conditions" && e.nbConditions === 0) {
    bloquants.push("CONDITIONS_MANQUANTES");
  }

  const avertissements: CodeAvertissementNote[] = [];
  if (e.risquesCritiquesFragiles > 0) avertissements.push("RISQUES_CRITIQUES_FRAGILES");
  if (!e.marche.present) avertissements.push("AUCUN_DIMENSIONNEMENT");
  if (e.marche.present && e.marche.recoupementAlerte) {
    avertissements.push("RECOUPEMENT_MARCHE_DIVERGENT");
  }
  if (e.incoherencesArbre > 0) avertissements.push("ARBRE_INCOHERENT");

  return { bloquants, avertissements, soumissible: bloquants.length === 0 };
}
