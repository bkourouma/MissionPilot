import {
  aPermission,
  ASSERTIONS_MISSION_MAX,
  TYPE_SOURCE_PREUVE_LIBELLES,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { assertionsDeMission, type AssertionCourante } from "../preuves/donnees.js";
import { chargerEtat } from "../preuves/synthese.js";
import { vuePreuve } from "../preuves/vues.js";
import { dateAffichee, type Bloc, type Section } from "./modele.js";
import { borner, cellule, NON_DISPONIBLE, section } from "./outils.js";

/*
 * Annexe « Sources » des rapports de notation et de plan (PRV-06), commune aux exports PDF et
 * Word (le contenu est le même modèle de rapport, rendu par chaque format).
 *
 * - Assertions CITÉES : assertions RETENUES du registre des preuves de la mission dont le
 *   livrable désigne le rapport (« notation » pour un rapport de notation, « plan » pour un
 *   rapport de plan stratégique ; comparaison sans casse ni accents). Une assertion sans
 *   livrable n'est citée par aucun rapport.
 * - Sources : liste NUMÉROTÉE des preuves reliées (pour ou contre) à ces assertions, dans
 *   l'ordre de première citation, avec leur type, leur date et leur fiabilité (A à D) ; chaque
 *   assertion renvoie à ses numéros, avec sa solidité calculée par le moteur.
 * - Un rapport est destiné au client : un verbatim NOMINATIF sans accord de la personne est
 *   masqué pour TOUS (`vuePreuve(…, false)`, preuves/vues.ts) — ni extrait, ni source précise —,
 *   quels que soient les droits du générateur.
 * - L'annexe n'est produite que si le générateur a `preuve.lire` (on n'exporte pas ce qu'on ne
 *   pourrait pas lire) et qu'au moins une assertion est citée ; sinon le rapport est inchangé.
 */

export type LivrableSources = "notation" | "plan";

const MOTS_CLES: Record<LivrableSources, string> = { notation: "notation", plan: "plan" };

const LECTURES: Record<string, string> = {
  solide: "Solide",
  etayee: "Étayée",
  fragile: "Fragile",
};

const normaliser = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** L'assertion est-elle citée par un rapport de ce livrable ? */
export function assertionCitee(
  a: Pick<AssertionCourante, "statut" | "livrable">,
  l: LivrableSources,
) {
  return (
    a.statut === "retenue" && a.livrable !== null && normaliser(a.livrable).includes(MOTS_CLES[l])
  );
}

/** Annexe des sources du rapport, ou null (aucune assertion citée, ou pas `preuve.lire`). */
export async function sectionSources(
  db: Db,
  auth: Auth,
  missionId: string,
  livrable: LivrableSources,
): Promise<Section | null> {
  if (!aPermission(auth.roles, "preuve.lire")) return null;
  const citees = (await assertionsDeMission(db, missionId, ASSERTIONS_MISSION_MAX)).filter((a) =>
    assertionCitee(a, livrable),
  );
  if (citees.length === 0) return null;
  const etat = await chargerEtat(db, missionId, citees);
  const numeros = new Map<string, number>();
  const lignesAssertions = citees.map((a) => {
    const liens = etat.liens
      .filter((l) => l.assertion_id === a.id && etat.preuves.has(l.preuve_id))
      // Ordre stable : preuves « pour » d'abord, puis ordre de liaison, puis identifiant.
      .sort(
        (x, y) =>
          (x.sens === y.sens ? 0 : x.sens === "pour" ? -1 : 1) ||
          (x.horodatage < y.horodatage ? -1 : x.horodatage > y.horodatage ? 1 : 0) ||
          (x.preuve_id < y.preuve_id ? -1 : x.preuve_id > y.preuve_id ? 1 : 0),
      );
    const renvois = { pour: [] as number[], contre: [] as number[] };
    for (const l of liens) {
      if (!numeros.has(l.preuve_id)) numeros.set(l.preuve_id, numeros.size + 1);
      renvois[l.sens].push(numeros.get(l.preuve_id)!);
    }
    const solidite = etat.evaluations.get(a.id)?.solidite;
    const lecture = solidite ? (LECTURES[solidite.lecture] ?? solidite.lecture) : NON_DISPONIBLE;
    const sources = [
      renvois.pour.length ? renvois.pour.map((n) => `[${n}]`).join(", ") : "",
      renvois.contre.length ? `contre : ${renvois.contre.map((n) => `[${n}]`).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" ; ");
    return [
      cellule(a.enonce),
      a.avis_expert && a.signe_par !== null ? `${lecture} (avis d'expert signé)` : lecture,
      sources || "Aucune preuve reliée",
    ];
  });
  const lignesSources = [...numeros.entries()].map(([id, n]) => {
    const p = vuePreuve(etat.preuves.get(id)!, false);
    return [
      String(n),
      TYPE_SOURCE_PREUVE_LIBELLES[p.type_source as keyof typeof TYPE_SOURCE_PREUVE_LIBELLES] ??
        p.type_source,
      cellule(p.source_precise),
      dateAffichee(p.date_preuve),
      p.fiabilite,
      p.masque
        ? "Verbatim nominatif non cité : accord de la personne non recueilli."
        : p.extrait
          ? cellule(p.extrait)
          : NON_DISPONIBLE,
    ];
  });
  const a = borner(lignesAssertions);
  const s = borner(lignesSources);
  const blocs: Bloc[] = [
    {
      type: "paragraphe",
      texte:
        "Assertions du registre des preuves citées par ce rapport, leur solidité (calculée par le " +
        "moteur à partir de la fiabilité et de l'indépendance des sources) et les sources qui les " +
        "fondent. Fiabilité des sources : de A (la plus élevée) à D (la plus faible).",
    },
    {
      type: "tableau",
      titre: "Assertions citées",
      colonnes: ["Assertion", "Solidité", "Sources"],
      alignements: ["gauche", "gauche", "gauche"],
      lignes: a.lignes,
    },
    ...a.note,
  ];
  if (lignesSources.length > 0) {
    blocs.push(
      {
        type: "tableau",
        titre: "Sources",
        colonnes: ["N°", "Type", "Source", "Date", "Fiabilité", "Extrait"],
        alignements: ["droite", "gauche", "gauche", "gauche", "gauche", "gauche"],
        lignes: s.lignes,
      },
      ...s.note,
    );
  }
  return section("Annexe — Sources", blocs);
}
