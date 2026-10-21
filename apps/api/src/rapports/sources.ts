import { aPermission, TYPE_SOURCE_PREUVE_LIBELLES } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { assertionCitee, sourcesDuLivrable, type LivrableSources } from "../preuves/citations.js";
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
 * - La numérotation, le tri et la solidité sont calculés par `preuves/citations.ts`, partagé avec
 *   les citations cliquables du web (mêmes numéros [n]) ; ce fichier ne fait que la mise en page.
 * - L'annexe n'est produite que si le générateur a `preuve.lire` (on n'exporte pas ce qu'on ne
 *   pourrait pas lire) et qu'au moins une assertion est citée ; sinon le rapport est inchangé.
 */

export { assertionCitee, type LivrableSources };

const LECTURES: Record<string, string> = {
  solide: "Solide",
  etayee: "Étayée",
  fragile: "Fragile",
};

/** Annexe des sources du rapport, ou null (aucune assertion citée, ou pas `preuve.lire`). */
export async function sectionSources(
  db: Db,
  auth: Auth,
  missionId: string,
  livrable: LivrableSources,
): Promise<Section | null> {
  if (!aPermission(auth.roles, "preuve.lire")) return null;
  const { assertions, sources } = await sourcesDuLivrable(db, auth, missionId, livrable);
  if (assertions.length === 0) return null;
  const refs = (ns: number[]) => ns.map((n) => `[${n}]`).join(", ");
  const lignesAssertions = assertions.map((a) => {
    const lecture = a.solidite
      ? (LECTURES[a.solidite.lecture] ?? a.solidite.lecture)
      : NON_DISPONIBLE;
    const renvoisTexte = [
      a.renvois.pour.length ? refs(a.renvois.pour) : "",
      a.renvois.contre.length ? `contre : ${refs(a.renvois.contre)}` : "",
    ]
      .filter(Boolean)
      .join(" ; ");
    return [
      cellule(a.enonce),
      a.avis_expert_signe ? `${lecture} (avis d'expert signé)` : lecture,
      renvoisTexte || "Aucune preuve reliée",
    ];
  });
  const lignesSources = sources.map((p) => [
    String(p.numero),
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
  ]);
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
