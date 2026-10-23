/**
 * Tirage reproductible pour la revue à froid des missions clôturées (QUA-05).
 *
 * Le tirage est déterministe : chaque mission éligible reçoit une clé
 * `empreinteTexte(graine + ":" + id)`, les missions sont triées par (clé, id)
 * et les premières sont retenues. Même graine et mêmes entrées, quel que soit
 * l'ordre des candidats, donnent le même résultat. Aucun aléa système, aucune
 * horloge, aucune base.
 */
import { ErreurQualite } from "./erreurs";

export interface CandidatEchantillon {
  id: string;
  type_mission_id: string | null;
  directeur_id: string | null;
  /** AAAA-MM-JJ */
  cloturee_le: string;
}

export interface CriteresTirage {
  /** Bornes incluses, AAAA-MM-JJ, sur `cloturee_le`. */
  periode_debut: string;
  periode_fin: string;
  /** Vide = tous. */
  types_mission_ids: readonly string[];
  /** Vide = tous. */
  directeur_ids: readonly string[];
  stratifier_par: "type_mission" | "directeur" | null;
  /** Missions déjà revues, à écarter. */
  exclus: readonly string[];
}

export interface ElementTire {
  id: string;
  /** À partir de 1, dans l'ordre de tirage. */
  rang: number;
  /** Empreinte hexadécimale (14 caractères). */
  cle: string;
}

export interface ResultatTirage {
  graine: string;
  taille_demandee: number;
  taille_obtenue: number;
  /** Identifiants éligibles, triés par id. */
  population: string[];
  /** Empreinte de la liste triée des identifiants éligibles. */
  empreinte_population: string;
  /** Dans l'ordre de tirage. */
  selection: ElementTire[];
}

/** Hash 53 bits déterministe (cyrb53), rendu en 14 caractères hexadécimaux. */
export function empreinteTexte(texte: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const valeur = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return valeur.toString(16).padStart(14, "0");
}

function dateValide(d: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const an = Number(m[1]);
  const mois = Number(m[2]);
  const jour = Number(m[3]);
  if (mois < 1 || mois > 12 || jour < 1) return false;
  const bissextile = (an % 4 === 0 && an % 100 !== 0) || an % 400 === 0;
  const jours = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return jour <= (jours[mois - 1] as number);
}

function comparer(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const STRATE_AUCUNE = "(aucun)";

export function tirerEchantillon(
  candidats: readonly CandidatEchantillon[],
  criteres: CriteresTirage,
  taille: number,
  graine: string,
): ResultatTirage {
  if (!Number.isInteger(taille) || taille < 1) {
    throw new ErreurQualite(
      "ECHANTILLON_INVALIDE",
      "La taille de l'échantillon doit être un entier supérieur ou égal à 1.",
    );
  }
  if (graine.length === 0 || graine.length > 64) {
    throw new ErreurQualite(
      "ECHANTILLON_INVALIDE",
      "La graine du tirage doit comporter entre 1 et 64 caractères.",
    );
  }
  if (!dateValide(criteres.periode_debut) || !dateValide(criteres.periode_fin)) {
    throw new ErreurQualite(
      "ECHANTILLON_INVALIDE",
      "Les bornes de la période doivent être des dates valides (AAAA-MM-JJ).",
    );
  }
  if (criteres.periode_debut > criteres.periode_fin) {
    throw new ErreurQualite(
      "ECHANTILLON_INVALIDE",
      "La période est inversée : la date de début suit la date de fin.",
    );
  }

  const types = new Set(criteres.types_mission_ids);
  const directeurs = new Set(criteres.directeur_ids);
  const exclus = new Set(criteres.exclus);
  const vus = new Set<string>();
  const eligibles: (CandidatEchantillon & { cle: string })[] = [];
  for (const c of candidats) {
    if (vus.has(c.id)) continue;
    vus.add(c.id);
    if (c.cloturee_le < criteres.periode_debut || c.cloturee_le > criteres.periode_fin) continue;
    if (types.size > 0 && (c.type_mission_id === null || !types.has(c.type_mission_id))) continue;
    if (directeurs.size > 0 && (c.directeur_id === null || !directeurs.has(c.directeur_id))) {
      continue;
    }
    if (exclus.has(c.id)) continue;
    eligibles.push({ ...c, cle: empreinteTexte(`${graine}:${c.id}`) });
  }

  const population = eligibles.map((c) => c.id).sort(comparer);
  const empreinte_population = empreinteTexte(population.join("\n"));
  const ordonnes = [...eligibles].sort((a, b) => comparer(a.cle, b.cle) || comparer(a.id, b.id));
  const taille_obtenue = Math.min(taille, ordonnes.length);

  let tires: typeof ordonnes;
  if (criteres.stratifier_par === null) {
    tires = ordonnes.slice(0, taille_obtenue);
  } else {
    const champ = criteres.stratifier_par === "type_mission" ? "type_mission_id" : "directeur_id";
    const strates = new Map<string, typeof ordonnes>();
    for (const c of ordonnes) {
      const code = c[champ] ?? STRATE_AUCUNE;
      const liste = strates.get(code);
      if (liste) liste.push(c);
      else strates.set(code, [c]);
    }
    const codes = [...strates.keys()].sort((a, b) =>
      a === STRATE_AUCUNE ? 1 : b === STRATE_AUCUNE ? -1 : comparer(a, b),
    );
    tires = [];
    for (let tour = 0; tires.length < taille_obtenue; tour++) {
      for (const code of codes) {
        const element = (strates.get(code) as typeof ordonnes)[tour];
        if (element && tires.length < taille_obtenue) tires.push(element);
      }
    }
  }

  return {
    graine,
    taille_demandee: taille,
    taille_obtenue,
    population,
    empreinte_population,
    selection: tires.map((c, i) => ({ id: c.id, rang: i + 1, cle: c.cle })),
  };
}
