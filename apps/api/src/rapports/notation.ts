import {
  SEUIL_FAIBLESSE_DEFAUT,
  SEUIL_FORCE_DEFAUT,
  type Classe,
  type ComparaisonNotations,
  type DimensionAjustee,
  type DimensionClassee,
  type Evolution,
} from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import {
  chargerVersion,
  exigerNotationVisible,
  rapport as donneesNotation,
} from "../notation/notations.js";
import { sousTitreRapport, tronquer } from "./etat-avancement.js";
import { dateAffichee, PLAFONDS_MODELE, type Bloc, type Rapport, type Section } from "./modele.js";
import {
  borner,
  cellule,
  ecartScore,
  lireEnteteMission,
  liste,
  NON_DISPONIBLE,
  score,
  section,
} from "./outils.js";

/*
 * Rapport de notation (NOT-07) : rendu d'une version PUBLIÉE (revue d'un
 * expert métier, séparation des tâches MPN04), jamais d'un brouillon ni d'une
 * version en revue (409 NOTATION_NON_PUBLIEE ; doublé en base, MPR02).
 *
 * PROVENANCE (aucun calcul ici) :
 * - scores, classes, forces et faiblesses, comparaison : moteur de notation
 *   (`donneesRapport`, `comparerNotations`, scores ajustés rejoués par
 *   `appliquerAjustement`), lus par notation/notations.ts comme
 *   GET /notations/:id/rapport ;
 * - ajustements : historique en ajout seul, motifs saisis par les consultants
 *   et publiés avec la version (aucun texte produit par l'IA).
 * Les scores sont seulement MIS EN FORME (rapports/outils.ts).
 *
 * Non reproduits : écarts entre répondants (noms des répondants du client),
 * radar et barres graphiques (rendus en tableaux), plan d'action recommandé
 * (aucune donnée structurée dans la notation).
 */

/** Libellés des classes (miroir de apps/web/src/lib/notation.ts, à valider par les experts). */
export const LIBELLES_CLASSE: Record<Classe, string> = {
  A: "Très avancé",
  B: "Avancé",
  C: "Intermédiaire",
  D: "Fragile",
  E: "Critique",
};

const FAMILLES: Record<string, string> = {
  excellence: "Excellence opérationnelle",
  competitivite: "Compétitivité",
};

const EVOLUTIONS: Record<Evolution, string> = {
  hausse: "En hausse",
  baisse: "En baisse",
  stable: "Stable",
  non_comparable: "Non comparable",
};

const STRATEGIES: Record<string, string> = {
  ignorer: "réponses manquantes ignorées (poids renormalisés)",
  penaliser: "réponses manquantes comptées pour 0 point",
};

export const libelleClasse = (c: Classe | null | undefined) =>
  c ? `${c} — ${LIBELLES_CLASSE[c]}` : "Non notable";

export const libelleFamille = (code: string) =>
  FAMILLES[code] ?? (code.trim() === "" ? "Sans famille" : code);

/** Version publiée retenue pour le rapport et ce que le rendu en lit. */
export interface SourceNotation {
  missionId: string;
  notationId: string;
  version: number;
}

const nonPubliee = () =>
  new AppError(
    409,
    "NOTATION_NON_PUBLIEE",
    "Seule une notation publiée après revue d'un expert métier peut être rendue en rapport.",
  );

function sectionSynthese(
  d: Awaited<ReturnType<typeof donneesNotation>>,
  grille: { titre: string; version: number },
  reponses: number,
): Section {
  const g = d.donnees.global;
  return section("Synthèse", [
    {
      type: "indicateurs",
      elements: [
        {
          libelle: "Score global",
          valeur: g.score === null ? "Non notable" : `${score(g.score)} / 100`,
          detail: g.classe ? `Classe ${libelleClasse(g.classe)}` : undefined,
        },
        { libelle: "Points forts", valeur: String(d.donnees.forces.length) },
        { libelle: "Points faibles", valeur: String(d.donnees.faiblesses.length) },
        {
          libelle: "Version publiée",
          valeur: `Version ${d.version.numero}`,
          detail: `Publiée le ${dateAffichee(isoDe(d.version.publiee_le))}`,
        },
        {
          libelle: "Grille de notation",
          valeur: tronquer(grille.titre, PLAFONDS_MODELE.longueurCellule),
          detail: `Version ${grille.version}`,
        },
        { libelle: "Réponses utilisées", valeur: String(reponses) },
      ],
    },
  ]);
}

function sectionPiliers(dimensions: readonly DimensionAjustee[]): Section {
  const familles: { famille: string; dims: DimensionAjustee[] }[] = [];
  for (const d of dimensions) {
    let f = familles.find((x) => x.famille === d.famille);
    if (!f) {
      f = { famille: d.famille, dims: [] };
      familles.push(f);
    }
    f.dims.push(d);
  }
  const blocs: Bloc[] = familles.flatMap((f) => {
    const { lignes, note } = borner(
      f.dims.map((d) => [
        cellule(d.libelle),
        score(d.scoreCalcule),
        d.deltaCumule === 0 ? NON_DISPONIBLE : ecartScore(d.deltaCumule),
        score(d.score),
        libelleClasse(d.classe),
      ]),
    );
    return [
      {
        type: "tableau",
        titre: tronquer(libelleFamille(f.famille), PLAFONDS_MODELE.longueurTitre),
        colonnes: ["Pilier", "Score calculé", "Ajustement", "Score retenu", "Classe"],
        alignements: ["gauche", "droite", "droite", "droite", "gauche"],
        lignes,
      },
      ...note,
    ] satisfies Bloc[];
  });
  return section("Scores par pilier", [
    ...blocs,
    {
      type: "paragraphe",
      texte:
        "Scores sur 100. « Non notable » : réponses insuffisantes pour noter la dimension. " +
        "L'ajustement est l'écart motivé apporté par le consultant après ses entretiens (détail ci-après).",
    },
  ]);
}

function sectionForcesFaiblesses(
  forces: readonly DimensionClassee[],
  faiblesses: readonly DimensionClassee[],
): Section {
  const ligne = (d: DimensionClassee) => `${d.libelle} — ${score(d.score)} / 100`;
  return section("Forces et faiblesses", [
    {
      type: "paragraphe",
      texte: `Points forts : piliers au score de ${SEUIL_FORCE_DEFAUT} ou plus.`,
    },
    forces.length
      ? liste(forces.map(ligne))
      : { type: "paragraphe", texte: "Aucun pilier n'atteint ce seuil." },
    {
      type: "paragraphe",
      texte: `Points faibles : piliers au score inférieur à ${SEUIL_FAIBLESSE_DEFAUT}.`,
    },
    faiblesses.length
      ? liste(faiblesses.map(ligne))
      : { type: "paragraphe", texte: "Aucun pilier sous ce seuil." },
  ]);
}

interface AjustementLu {
  dimension: string;
  delta: string;
  motif: string;
  date_ajustement: string;
  score_avant: string;
  score_apres: string;
  auteur_nom: string;
}

function sectionAjustements(
  ajustements: readonly AjustementLu[],
  libelles: Map<string, string>,
): Section {
  if (ajustements.length === 0) {
    return section("Ajustements motivés", [
      { type: "paragraphe", texte: "Aucun ajustement : les scores retenus sont ceux du calcul." },
    ]);
  }
  const { lignes, note } = borner(
    ajustements.map((a) => [
      cellule(libelles.get(a.dimension) ?? a.dimension),
      ecartScore(Number(a.delta)),
      `${score(Number(a.score_avant))} → ${score(Number(a.score_apres))}`,
      cellule(a.motif),
      dateAffichee(a.date_ajustement),
      cellule(a.auteur_nom),
    ]),
  );
  return section("Ajustements motivés", [
    {
      type: "tableau",
      colonnes: ["Pilier", "Écart", "Score", "Motif", "Date", "Auteur"],
      alignements: ["gauche", "droite", "droite", "gauche", "gauche", "gauche"],
      lignes,
    },
    ...note,
  ]);
}

function sectionComparaison(c: ComparaisonNotations, precedenteLe: string | null): Section {
  const { lignes, note } = borner(
    c.dimensions.map((d) => [
      cellule(d.libelle),
      score(d.avant),
      score(d.apres),
      ecartScore(d.ecart),
      EVOLUTIONS[d.evolution],
    ]),
  );
  return section("Évolution depuis la notation précédente", [
    {
      type: "indicateurs",
      elements: [
        {
          libelle: "Score global",
          valeur: `${score(c.global.avant)} → ${score(c.global.apres)}`,
          detail: `Écart ${ecartScore(c.global.ecart)} (${EVOLUTIONS[c.global.evolution]})`,
        },
        {
          libelle: "Classe",
          valeur: `${c.classeAvant ?? NON_DISPONIBLE} → ${c.classeApres ?? NON_DISPONIBLE}`,
          detail:
            c.ecartClasses === null
              ? "Non comparable"
              : `${c.ecartClasses > 0 ? "+" : ""}${c.ecartClasses} classe(s)`,
        },
      ],
    },
    {
      type: "tableau",
      colonnes: ["Pilier", "Avant", "Après", "Écart", "Évolution"],
      alignements: ["gauche", "droite", "droite", "droite", "gauche"],
      lignes,
    },
    ...note,
    {
      type: "paragraphe",
      texte: `Notation précédente du même client publiée le ${dateAffichee(precedenteLe)}.`,
    },
  ]);
}

const isoDe = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

/**
 * Contenu du rapport de la version publiée `numero` (défaut : la dernière
 * publiée) d'une notation visible ; 404 notation ou version absente, 409 si
 * la version n'est pas publiée.
 */
export async function rapportNotation(
  db: Db,
  auth: Auth,
  notationId: string,
  numero: number | undefined,
  aujourdhui: string,
): Promise<{ rapport: Rapport; source: SourceNotation }> {
  const notation = await exigerNotationVisible(db, auth, notationId);
  const d = await donneesNotation(db, auth, notation, numero);
  if (d.version.statut !== "publiee") throw nonPubliee();
  const v = await chargerVersion(db, notation.id, d.version.numero);
  if (!v) throw nonPubliee();
  const entete = await lireEnteteMission(db, notation.mission_id);
  const publication = v.evenements.find((e) => e.action === "publication");
  const libelles = new Map(v.etat.dimensions.map((x) => [x.dimension, x.libelle]));
  const sections: Section[] = [
    sectionSynthese(d, v.version.grille, v.version.reponses_ids.length),
    sectionPiliers(v.etat.dimensions),
    sectionForcesFaiblesses(d.donnees.forces, d.donnees.faiblesses),
    sectionAjustements(v.ajustements, libelles),
  ];
  if (d.comparaison) {
    sections.push(sectionComparaison(d.comparaison, isoDe(d.comparaison.precedente.publiee_le)));
  }
  sections.push(
    section("Méthode", [
      {
        type: "paragraphe",
        texte:
          `Scores calculés par le moteur de notation de MissionPilot à partir des réponses soumises ` +
          `au questionnaire (grille « ${tronquer(v.version.grille.titre, 120)} », version ` +
          `${v.version.grille.version} ; ${STRATEGIES[v.version.strategie] ?? v.version.strategie}). ` +
          `Barème des classes : A à partir de 80, B à partir de 65, C à partir de 50, D à partir de 35, E en dessous.`,
      },
      {
        type: "paragraphe",
        texte:
          `Version ${v.version.numero} publiée le ${dateAffichee(isoDe(publication?.le))}` +
          `${publication ? ` par ${tronquer(publication.par_nom, 120)} (expert métier)` : ""}, ` +
          `après revue. Aucun texte de ce rapport n'a été rédigé par l'IA.`,
      },
    ]),
  );
  return {
    source: { missionId: notation.mission_id, notationId: notation.id, version: v.version.numero },
    rapport: {
      titre: "Rapport de notation",
      sous_titre: sousTitreRapport(entete.intitule, entete.client),
      emetteur: tronquer(entete.cabinet, PLAFONDS_MODELE.longueurTitre),
      statut: "valide",
      genere_le: aujourdhui,
      confidentiel: false,
      sections,
    },
  };
}
