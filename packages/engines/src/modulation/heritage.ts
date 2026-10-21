/**
 * Contrôle de la chaîne d'héritage d'une méthode et de ses versions (STD-11) :
 * cycles, maillons manquants, bases incohérentes. Fonction pure, terminaison
 * garantie (chaque parcours s'arrête au premier maillon déjà vu).
 */
import { erreurCoherence, trierAnomaliesCoherence, type AnomalieCoherence } from "./coherence";

export interface NoeudMethode {
  id: string;
  parent_id: string | null;
}
export interface NoeudVersion {
  id: string;
  methode_id: string;
  base_standard_id: string | null;
  statut: "brouillon" | "publiee";
}

/** Cycles d'un graphe à un seul successeur par nœud, chacun ramené à son plus petit identifiant. */
function cycles(suivants: ReadonlyMap<string, string | null>): string[][] {
  const trouves = new Map<string, string[]>();
  for (const depart of [...suivants.keys()].sort()) {
    const chemin: string[] = [];
    let courant: string | null = depart;
    while (courant !== null && suivants.has(courant)) {
      const position = chemin.indexOf(courant);
      if (position >= 0) {
        const boucle = chemin.slice(position);
        const min = boucle.reduce((m, x) => (x < m ? x : m));
        const k = boucle.indexOf(min);
        const normalise = [...boucle.slice(k), ...boucle.slice(0, k)];
        trouves.set(normalise.join("\u0000"), normalise);
        break;
      }
      chemin.push(courant);
      courant = suivants.get(courant)!;
    }
  }
  return [...trouves.values()];
}

export function analyserHeritage(
  methodes: readonly NoeudMethode[],
  versions: readonly NoeudVersion[],
): AnomalieCoherence[] {
  const sortie: AnomalieCoherence[] = [];
  const parMethode = new Map<string, NoeudMethode>();
  for (const m of methodes) if (!parMethode.has(m.id)) parMethode.set(m.id, m);
  const parVersion = new Map<string, NoeudVersion>();
  for (const v of versions) if (!parVersion.has(v.id)) parVersion.set(v.id, v);

  for (const m of parMethode.values()) {
    if (m.parent_id !== null && !parMethode.has(m.parent_id)) {
      sortie.push(
        erreurCoherence(
          "REFERENCE_CASSEE",
          null,
          `methodes.${m.id}.parent`,
          `La méthode « ${m.id} » hérite de « ${m.parent_id} », qui est introuvable.`,
        ),
      );
    }
  }
  for (const v of parVersion.values()) {
    const methode = parMethode.get(v.methode_id);
    if (methode === undefined) {
      sortie.push(
        erreurCoherence(
          "REFERENCE_CASSEE",
          null,
          `versions.${v.id}.methode`,
          `La version « ${v.id} » appartient à la méthode « ${v.methode_id} », qui est introuvable.`,
        ),
      );
    }
    if (v.base_standard_id === null) continue;
    const base = parVersion.get(v.base_standard_id);
    if (base === undefined) {
      sortie.push(
        erreurCoherence(
          "REFERENCE_CASSEE",
          null,
          `versions.${v.id}.base`,
          `La version « ${v.id} » repose sur « ${v.base_standard_id} », qui est introuvable.`,
        ),
      );
      continue;
    }
    if (base.statut !== "publiee") {
      sortie.push(
        erreurCoherence(
          "HERITAGE_INCOHERENT",
          null,
          `versions.${v.id}.base`,
          `La version de base « ${base.id} » n'est pas publiée.`,
        ),
      );
    }
    if (methode !== undefined && methode.parent_id !== base.methode_id) {
      sortie.push(
        erreurCoherence(
          "HERITAGE_INCOHERENT",
          null,
          `versions.${v.id}.base`,
          `La base « ${base.id} » relève de la méthode « ${base.methode_id} », qui n'est pas la méthode parente de « ${methode.id} ».`,
        ),
      );
    }
  }

  const chaines: [string, string, Map<string, string | null>][] = [
    ["methodes", "parent_id", new Map([...parMethode.values()].map((m) => [m.id, m.parent_id]))],
    [
      "versions",
      "base_standard_id",
      new Map([...parVersion.values()].map((v) => [v.id, v.base_standard_id])),
    ],
  ];
  for (const [type, champ, suivants] of chaines) {
    for (const boucle of cycles(suivants)) {
      sortie.push(
        erreurCoherence(
          "CYCLE_HERITAGE",
          null,
          `${type}.${boucle[0]}`,
          `Cycle d'héritage (${champ}) : ${[...boucle, boucle[0]].join(" → ")}.`,
        ),
      );
    }
  }
  return trierAnomaliesCoherence(sortie);
}
