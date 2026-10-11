import { analyserDateISO } from "../commun/dates";
import {
  LIMITE_PAR_FAMILLE_BRIEF,
  LIMITE_PAR_FAMILLE_BRIEF_MAX,
  qualifierCandidat,
  rangGravite,
} from "./qualification";
import {
  ErreurBrief,
  FAMILLE_DU_TYPE,
  FAMILLES_BRIEF,
  TYPES_ELEMENT_BRIEF,
  type BriefCompose,
  type ElementBrief,
  type EntreeBrief,
  type FamilleBrief,
  type FamilleComposee,
} from "./types";

/*
 * Composition du brief : qualifie les candidats de chaque source, écarte les doublons, ordonne
 * (gravité décroissante, puis ancienneté décroissante, puis type, puis identifiant : l'ordre est
 * total et stable), borne chaque famille et rend le total RÉEL avec l'indicateur `tronque`.
 * Un jour sans rien à signaler donne un brief `vide`.
 */

const ORDRE_TYPE: ReadonlyMap<string, number> = new Map(
  TYPES_ELEMENT_BRIEF.map((t, i) => [t, i] as const),
);

/** Ordre du brief : plus grave d'abord, puis plus ancien, puis type, puis identifiant. */
export function comparerElementsBrief(a: ElementBrief, b: ElementBrief): number {
  return (
    rangGravite(b.gravite) - rangGravite(a.gravite) ||
    b.anciennete_jours - a.anciennete_jours ||
    (ORDRE_TYPE.get(a.type) ?? 0) - (ORDRE_TYPE.get(b.type) ?? 0) ||
    (a.entite_id < b.entite_id ? -1 : a.entite_id > b.entite_id ? 1 : 0)
  );
}

function limiteDe(entree: EntreeBrief): number {
  const limite = entree.limite_par_famille ?? LIMITE_PAR_FAMILLE_BRIEF;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_PAR_FAMILLE_BRIEF_MAX) {
    throw new ErreurBrief(
      "ENTREE_INVALIDE",
      `La limite par famille est un entier de 1 à ${LIMITE_PAR_FAMILLE_BRIEF_MAX}.`,
    );
  }
  return limite;
}

function composerFamille(
  famille: FamilleBrief,
  entree: EntreeBrief,
  limite: number,
): FamilleComposee {
  const vus = new Set<string>();
  const elements: ElementBrief[] = [];
  let restants = 0;
  let incomplet = false;
  for (const source of entree.sources) {
    if (source.famille !== famille) continue;
    if (!Number.isInteger(source.restants) || source.restants < 0) {
      throw new ErreurBrief("ENTREE_INVALIDE", "Le nombre de lignes restantes est un entier ≥ 0.");
    }
    restants += source.restants;
    if (source.incomplet === true) incomplet = true;
    for (const candidat of source.candidats) {
      if (FAMILLE_DU_TYPE[candidat.type] !== famille) {
        throw new ErreurBrief(
          "ENTREE_INVALIDE",
          `Un élément « ${candidat.type} » n'appartient pas à la famille « ${famille} ».`,
        );
      }
      const element = qualifierCandidat(candidat, entree.date_reference);
      if (!element) continue;
      const cle = `${element.type}:${element.entite_id}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      elements.push(element);
    }
  }
  const total = elements.length + restants;
  const servis = [...elements].sort(comparerElementsBrief).slice(0, limite);
  // `incomplet` : le total est un minimum (sources dont une partie des lignes n'a pas été lue).
  return { total, tronque: incomplet || total > servis.length, elements: servis };
}

/** Compose le brief d'un utilisateur à partir des faits extraits dans ses droits. */
export function composerBrief(entree: EntreeBrief): BriefCompose {
  if (!analyserDateISO(entree.date_reference).valide) {
    throw new ErreurBrief("ENTREE_INVALIDE", "La date de référence du brief est invalide.");
  }
  const limite = limiteDe(entree);
  const familles = Object.fromEntries(
    FAMILLES_BRIEF.map((f) => [f, composerFamille(f, entree, limite)] as const),
  ) as Record<FamilleBrief, FamilleComposee>;
  const total = FAMILLES_BRIEF.reduce((somme, f) => somme + familles[f].total, 0);
  return { date_reference: entree.date_reference, familles, total, vide: total === 0 };
}
