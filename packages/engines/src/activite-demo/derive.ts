/**
 * Mission maintenue en dérive (D5, DT6) : choix d'UNE mission et d'une paire (tâche, collaborateur)
 * porteuse, puis déclaration de reste à faire qui place l'écart à terminaison dans la bande
 * ]80 ; 160] ‰ (cible 120 ‰, au pas supérieur). Calcul pur en centièmes entiers, aucun montant ;
 * l'atterrissage suit `temps/suivi.ts` : réalisé + somme des dernières déclarations, ou
 * max(0, budget − réalisé) pour une tâche sans déclaration.
 */
import {
  PARAMETRES_ACTIVITE_DEMO,
  type ParametresActiviteDemo,
  comparerTexteDemo,
  exigerCentiemes,
  plafondPas,
} from "./parametres";

export interface TacheDeriveDemo {
  tacheId: string;
  budgetCentiemes: number;
  realiseCentiemes: number;
  /** Dernière déclaration de chaque collaborateur ; vide : reste estimé. */
  declarations: Readonly<Record<string, number>>;
  /** Collaborateurs internes actifs affectés à la tâche. */
  affectes: readonly string[];
}

export interface MissionDeriveDemo {
  missionId: string;
  taches: readonly TacheDeriveDemo[];
  /** Un déclarant existe (chef, directeur ou associé : `declarantMissionDemo`). */
  declarable: boolean;
}

export interface AtterrissageDemo {
  budgetCentiemes: number;
  atterrissageCentiemes: number;
  /** (atterrissage − budget) × 1000 / budget, tronqué vers zéro ; `null` si le budget est nul. */
  ecartPourMille: number | null;
}

/** Paire (tâche, collaborateur) qui porte la déclaration de dérive. */
export interface PorteuseDemo {
  tacheId: string;
  collaborateurId: string;
}

export interface AjustementDeriveDemo extends PorteuseDemo {
  /** Nouvelle déclaration du collaborateur porteur sur la tâche porteuse. */
  centiemes: number;
  avantPourMille: number | null;
  apresPourMille: number | null;
}

const declarees = (t: TacheDeriveDemo): [string, number][] => Object.entries(t.declarations);

const somme = (valeurs: readonly number[]): number => valeurs.reduce((s, v) => s + v, 0);

/** Reste d'une tâche : somme des déclarations, ou max(0, budget − réalisé) s'il n'y en a aucune. */
function resteTache(t: TacheDeriveDemo): number {
  const d = declarees(t);
  if (d.length > 0) return somme(d.map(([, v]) => v));
  return Math.max(0, t.budgetCentiemes - t.realiseCentiemes);
}

function verifierTache(t: TacheDeriveDemo): void {
  exigerCentiemes(t.budgetCentiemes, "Budget de tâche");
  exigerCentiemes(t.realiseCentiemes, "Réalisé de tâche");
  for (const [, v] of declarees(t)) exigerCentiemes(v, "Reste à faire déclaré");
}

function pourMille(atterrissage: number, budget: number): number | null {
  return budget > 0 ? Math.trunc(((atterrissage - budget) * 1000) / budget) : null;
}

/** Budget, atterrissage et écart à terminaison de la mission. */
export function atterrissageDemo(m: MissionDeriveDemo): AtterrissageDemo {
  for (const t of m.taches) verifierTache(t);
  const budget = somme(m.taches.map((t) => t.budgetCentiemes));
  const atterrissage = somme(m.taches.map((t) => t.realiseCentiemes + resteTache(t)));
  return {
    budgetCentiemes: budget,
    atterrissageCentiemes: atterrissage,
    ecartPourMille: pourMille(atterrissage, budget),
  };
}

interface CandidateDerive {
  missionId: string;
  budget: number;
  ecart: number;
}

/** Mission éligible : un déclarant, un budget non nul, au moins une tâche avec un affecté. */
function candidate(m: MissionDeriveDemo): CandidateDerive | null {
  const a = atterrissageDemo(m);
  if (!m.declarable || a.ecartPourMille === null) return null;
  if (!m.taches.some((t) => t.affectes.length > 0)) return null;
  return { missionId: m.missionId, budget: a.budgetCentiemes, ecart: a.ecartPourMille };
}

/** Première candidate selon `cle` croissante, puis budget décroissant, puis id. */
function meilleure(
  candidates: readonly CandidateDerive[],
  cle: (c: CandidateDerive) => number,
): string | null {
  const ordre = (a: CandidateDerive, b: CandidateDerive): number =>
    cle(a) - cle(b) || b.budget - a.budget || comparerTexteDemo(a.missionId, b.missionId);
  return [...candidates].sort(ordre)[0]?.missionId ?? null;
}

/**
 * Mission en dérive de la semaine : celle du dernier marqueur si elle est encore éligible ; sinon,
 * parmi les éligibles dont l'écart dépasse 50 ‰, la plus proche de la cible (une dérive semée est
 * ainsi reprise sans écriture) ; sinon celle du plus fort écart. Égalités : budget le plus élevé,
 * puis id. `null` si aucune mission n'est éligible.
 */
export function choisirMissionDeriveDemo(
  missions: readonly MissionDeriveDemo[],
  marquee: string | null,
  p: ParametresActiviteDemo = PARAMETRES_ACTIVITE_DEMO,
): string | null {
  const eligibles = missions.flatMap((m) => {
    const c = candidate(m);
    return c === null ? [] : [c];
  });
  if (marquee !== null && eligibles.some((c) => c.missionId === marquee)) return marquee;
  const { ciblePourMille, seuilAffichePourMille } = p.derive;
  const visibles = eligibles.filter((c) => c.ecart > seuilAffichePourMille);
  if (visibles.length > 0) return meilleure(visibles, (c) => Math.abs(c.ecart - ciblePourMille));
  return meilleure(eligibles, (c) => -c.ecart);
}

interface DeclarationPorteuse extends PorteuseDemo {
  valeur: number;
}

function parDeclaration(a: DeclarationPorteuse, b: DeclarationPorteuse): number {
  return (
    b.valeur - a.valeur ||
    comparerTexteDemo(a.tacheId, b.tacheId) ||
    comparerTexteDemo(a.collaborateurId, b.collaborateurId)
  );
}

const parBudget = (a: TacheDeriveDemo, b: TacheDeriveDemo): number =>
  b.budgetCentiemes - a.budgetCentiemes || comparerTexteDemo(a.tacheId, b.tacheId);

/** Plus forte déclaration faite par un collaborateur encore affecté à sa tâche. */
function plusForteDeclaration(m: MissionDeriveDemo): PorteuseDemo | null {
  const declarations: DeclarationPorteuse[] = [];
  for (const t of m.taches) {
    for (const [c, valeur] of declarees(t)) {
      if (!t.affectes.includes(c)) continue;
      declarations.push({ tacheId: t.tacheId, collaborateurId: c, valeur });
    }
  }
  const d = declarations.sort(parDeclaration)[0];
  return d === undefined ? null : { tacheId: d.tacheId, collaborateurId: d.collaborateurId };
}

/**
 * Paire porteuse de la dérive : celle du marqueur si la tâche est dans la mission et le
 * collaborateur toujours affecté ; sinon la plus forte déclaration d'un affecté ; sinon la tâche de
 * plus gros budget qui a un affecté, avec son premier affecté par id. `null` sans aucun affecté.
 */
export function choisirPorteuseDemo(
  m: MissionDeriveDemo,
  marquee: PorteuseDemo | null,
): PorteuseDemo | null {
  if (marquee !== null) {
    const t = m.taches.find((x) => x.tacheId === marquee.tacheId);
    if (t?.affectes.includes(marquee.collaborateurId)) return { ...marquee };
  }
  const declaree = plusForteDeclaration(m);
  if (declaree !== null) return declaree;
  const tache = m.taches.filter((t) => t.affectes.length > 0).sort(parBudget)[0];
  if (tache === undefined) return null;
  const premier = [...tache.affectes].sort(comparerTexteDemo)[0] as string;
  return { tacheId: tache.tacheId, collaborateurId: premier };
}

/**
 * Déclaration qui ramène la mission dans la bande (DT6), en centièmes :
 *   A = Σ (réalisé + reste) ; écart = trunc((A − B) × 1000 / B) ; dans ]80 ; 160] : rien ;
 *   T = plafond_pas(B × 1,12) ; A_sans = A − reste(t*) ; S_autres = Σ décl(t*) hors c* ;
 *   X = plafond_pas(max(0, T − A_sans − S_autres)) ; X égal à la déclaration de c* : rien.
 * La même formule fait monter (écart ≤ 80 ‰) ou descendre (écart > 160 ‰) la seule paire
 * porteuse ; X = 0 quand la mission ne peut pas redescendre davantage. `null` : aucune écriture
 * (bande atteinte, budget nul, déclaration inchangée). Une tâche porteuse absente de la mission
 * lève une `RangeError`.
 */
export function ajusterDeriveDemo(
  m: MissionDeriveDemo,
  porteuse: PorteuseDemo,
  p: ParametresActiviteDemo = PARAMETRES_ACTIVITE_DEMO,
): AjustementDeriveDemo | null {
  const t = m.taches.find((x) => x.tacheId === porteuse.tacheId);
  if (t === undefined) throw new RangeError(`Tâche porteuse absente : ${porteuse.tacheId}`);
  const etat = atterrissageDemo(m);
  const avant = etat.ecartPourMille;
  const { ciblePourMille, basPourMille, hautPourMille } = p.derive;
  if (avant === null || (avant > basPourMille && avant <= hautPourMille)) return null;
  const b = etat.budgetCentiemes;
  const cible = plafondPas(Math.ceil((b * (1000 + ciblePourMille)) / 1000), p.pasCentiemes);
  const sansTache = etat.atterrissageCentiemes - resteTache(t);
  let autres = 0;
  for (const [c, v] of declarees(t)) if (c !== porteuse.collaborateurId) autres += v;
  const x = plafondPas(Math.max(0, cible - sansTache - autres), p.pasCentiemes);
  if (x === t.declarations[porteuse.collaborateurId]) return null;
  return {
    tacheId: t.tacheId,
    collaborateurId: porteuse.collaborateurId,
    centiemes: x,
    avantPourMille: avant,
    apresPourMille: pourMille(sansTache + autres + x, b),
  };
}
