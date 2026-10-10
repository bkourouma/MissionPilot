import { scoreDe } from "./evaluation.js";
import type { Db } from "../db/pool.js";
import { STATUT_ACTION_KPI_LIBELLES, STATUT_DECISION_KPI_LIBELLES } from "@missionpilot/shared";
import { sousTitreRapport, tronquer } from "../rapports/etat-avancement.js";
import {
  dateAffichee,
  normaliserRapport,
  PLAFONDS_MODELE,
  type Bloc,
  type Rapport,
  type Section,
  type StatutRapport,
} from "../rapports/modele.js";
import {
  borner,
  cellule,
  lireEnteteMission,
  NON_DISPONIBLE,
  pourcentage,
  section,
} from "../rapports/outils.js";
import type { LigneAction } from "./actions.js";
import { actionsDeRevue, decisionsDeRevue, type LigneRevue } from "./revues-donnees.js";
import { definitionsDeMission } from "./donnees.js";
import { efficaciteAction } from "./actions.js";
import { evaluerDefinitions, evaluerKpisParIds, MAX_LIGNES_PILOTAGE } from "./pilotage-donnees.js";
import { qualiteDesKpi } from "./qualite-donnees.js";

/*
 * Dossier d'une revue de performance (KPI-17) : le MÊME contenu alimente le document (PDF,
 * Word) et la présentation (PowerPoint) par le moteur de rapports (rapports/rendu.ts).
 *
 * PROVENANCE (aucun calcul ici) : statuts, valeurs, cibles, atteintes, tendances, alertes et
 * score composite viennent de l'évaluation du moteur KPI (kpi/evaluation.ts) à la date d'arrêté
 * de la revue ; la qualité des données du moteur (kpi/qualite-donnees.ts) ; l'efficacité des
 * actions du moteur (kpi/actions.ts) ; l'ordre du jour est celui enregistré dans la revue. Les
 * nombres sont seulement MIS EN FORME (Intl). Aucun texte produit par un modèle de langage.
 *
 * Revue planifiée : dossier « brouillon » calculé à la demande. Revue tenue : la partie
 * « situation » est celle FIGÉE à la tenue (ce qui a été examiné) ; les décisions, actions et
 * le compte rendu sont ajoutés à chaque rendu, car ils continuent de vivre jusqu'à la clôture.
 */

const NOMBRE = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });
const valeur = (v: number | null | undefined, unite: string) =>
  typeof v === "number" && Number.isFinite(v)
    ? `${NOMBRE.format(v)}${unite ? ` ${unite}` : ""}`
    : NON_DISPONIBLE;

const STATUT_KPI: Record<string, string> = {
  vert: "Vert (conforme)",
  orange: "Orange (vigilance)",
  rouge: "Rouge (écart important)",
  non_mesure: "Non mesuré",
  sans_cible: "Sans cible",
};
const TENDANCE: Record<string, string> = {
  amelioration: "En amélioration",
  degradation: "En dégradation",
  stable: "Stable",
  indeterminee: "Indéterminée",
};
const QUALITE: Record<string, string> = { bon: "Bonne", moyen: "Moyenne", faible: "Faible" };
const ALERTE: Record<string, string> = {
  DEGRADATION_CONSECUTIVE: "Dégradation sur plusieurs périodes consécutives",
  MESURE_EN_RETARD: "Mesure en retard",
  SEUIL_HAUT: "Seuil haut franchi",
  SEUIL_BAS: "Seuil bas franchi",
  VARIATION: "Variation excessive entre deux périodes",
};
export const VERDICT_EFFICACITE: Record<string, string> = {
  efficace: "Efficace (amélioration mesurée)",
  inefficace: "Sans effet favorable (dégradation mesurée)",
  neutre: "Neutre (variation dans la tolérance)",
  indeterminee: "Indéterminée (périodes insuffisantes)",
};

const dateOuTiret = (d: string | null) => (d ? dateAffichee(d) : NON_DISPONIBLE);

/** Mention d'une liste plafonnée à la lecture (500 lignes) : jamais de troncature silencieuse. */
const noteTronquee = (tronque: boolean, quoi: string): Bloc[] =>
  tronque
    ? [
        {
          type: "paragraphe",
          texte: `Liste limitée aux ${MAX_LIGNES_PILOTAGE} premières ${quoi} : les suivantes ne figurent pas dans ce dossier.`,
        },
      ]
    : [];

/** Situation des KPI à la date d'arrêté de la revue : sections du dossier (partie figée). */
async function sectionsSituation(db: Db, revue: LigneRevue): Promise<Section[]> {
  const date = revue.date_reference;
  const defs = await definitionsDeMission(db, revue.mission_id, true);
  const evalues = await evaluerDefinitions(db, defs, date);
  const qualites = new Map((await qualiteDesKpi(db, defs, date)).map((q) => [q.def.id, q.qualite]));
  const liste = defs.flatMap((d) => {
    const e = evalues.get(d.id);
    return e ? [e] : [];
  });
  const score = scoreDe(liste);

  const blocsSynthese: Bloc[] = [];
  if (liste.length === 0) {
    blocsSynthese.push({
      type: "paragraphe",
      texte: "Aucun KPI actif n'est suivi pour cette mission.",
    });
  } else {
    blocsSynthese.push({
      type: "indicateurs",
      elements: [
        {
          libelle: "Score composite",
          valeur: score ? pourcentage(score.score) : NON_DISPONIBLE,
          detail: score
            ? `Statut ${STATUT_KPI[score.statut] ?? score.statut}`
            : "Aucune cible renseignée",
        },
        { libelle: "KPI suivis", valeur: String(liste.length) },
        {
          libelle: "KPI en rouge",
          valeur: String(liste.filter((k) => k.evaluation.statut === "rouge").length),
        },
        {
          libelle: "Alertes",
          valeur: String(liste.reduce((n, k) => n + k.evaluation.alertes.length, 0)),
        },
      ],
    });
    const lignes = liste.map((k) => {
      const d = k.evaluation.derniere;
      return [
        cellule(k.def.libelle),
        STATUT_KPI[k.evaluation.statut] ?? k.evaluation.statut,
        d ? valeur(d.valeur, k.def.unite) : NON_DISPONIBLE,
        d ? valeur(d.cible, k.def.unite) : NON_DISPONIBLE,
        d?.evaluation.atteinte ? pourcentage(d.evaluation.atteinte.taux) : NON_DISPONIBLE,
        TENDANCE[k.evaluation.tendance.evolution] ?? NON_DISPONIBLE,
        qualites.get(k.def.id)?.niveau
          ? `${QUALITE[qualites.get(k.def.id)?.niveau as string]} (${qualites.get(k.def.id)?.score ?? "—"}/100)`
          : "Non évaluable",
      ];
    });
    const b = borner(lignes);
    blocsSynthese.push({
      type: "tableau",
      titre: "Situation de chaque KPI à la date d'arrêté",
      colonnes: [
        "KPI",
        "Statut",
        "Dernière valeur",
        "Cible",
        "Atteinte",
        "Tendance",
        "Qualité des données",
      ],
      alignements: ["gauche", "gauche", "droite", "droite", "droite", "gauche", "gauche"],
      lignes: b.lignes,
    });
    blocsSynthese.push(...b.note);
  }

  const alertes = liste.flatMap((k) =>
    k.evaluation.alertes.map((a) => [
      cellule(k.def.libelle),
      ALERTE[a.alerte.code] ?? a.alerte.code,
      a.periode_cle,
    ]),
  );
  const blocsAlertes: Bloc[] =
    alertes.length === 0
      ? [{ type: "paragraphe", texte: "Aucune alerte à la date d'arrêté." }]
      : (() => {
          const b = borner(alertes);
          return [
            {
              type: "tableau" as const,
              colonnes: ["KPI", "Alerte", "Période"],
              lignes: b.lignes,
            },
            ...b.note,
          ];
        })();
  return [section("Situation des KPI", blocsSynthese), section("Alertes", blocsAlertes)];
}

async function sectionOrdreDuJour(revue: LigneRevue): Promise<Section> {
  const points = revue.ordre_du_jour;
  if (points.length === 0) {
    return section("Ordre du jour", [
      { type: "paragraphe", texte: "L'ordre du jour n'est pas encore établi." },
    ]);
  }
  const b = borner(
    points.map((p) => [String(p.rang), cellule(p.libelle), `${p.duree_minutes} min`]),
  );
  return section("Ordre du jour", [
    {
      type: "tableau",
      colonnes: ["N°", "Point", "Durée"],
      alignements: ["droite", "gauche", "droite"],
      lignes: b.lignes,
    },
    ...b.note,
    {
      type: "paragraphe",
      texte: `Durée prévue : ${points.reduce((s, p) => s + p.duree_minutes, 0)} minutes.`,
    },
  ]);
}

async function enteteRevue(db: Db, revue: LigneRevue, statut: StatutRapport) {
  const e = await lireEnteteMission(db, revue.mission_id);
  return {
    titre: tronquer(
      `Revue de performance n° ${revue.numero} — ${revue.titre}`,
      PLAFONDS_MODELE.longueurTitre,
    ),
    sous_titre: sousTitreRapport(e.intitule, e.client),
    emetteur: tronquer(e.cabinet, PLAFONDS_MODELE.longueurTitre),
    statut,
    genere_le: new Date().toISOString().slice(0, 10),
    // Les valeurs de KPI du client sont confidentielles : le dossier ne se diffuse pas tel quel.
    confidentiel: true,
  };
}

function sectionObjet(revue: LigneRevue): Section {
  return section("Objet de la revue", [
    {
      type: "liste",
      elements: [
        `Date prévue : ${dateAffichee(revue.date_prevue)}`,
        `Date d'arrêté des KPI : ${dateAffichee(revue.date_reference)}`,
        `Animateur : ${revue.animateur_nom ?? "à désigner"}`,
      ],
    },
  ]);
}

/**
 * Dossier calculé à la volée (revue planifiée) ou à figer à la tenue : objet, ordre du jour,
 * situation des KPI et alertes à la date d'arrêté de la revue.
 */
export async function dossierRevue(
  db: Db,
  revue: LigneRevue,
  statut: StatutRapport,
): Promise<Rapport> {
  const rapport = {
    ...(await enteteRevue(db, revue, statut)),
    sections: [
      sectionObjet(revue),
      await sectionOrdreDuJour(revue),
      ...(await sectionsSituation(db, revue)),
    ],
  };
  return normaliserRapport(rapport);
}

async function sectionsSuivi(db: Db, revue: LigneRevue): Promise<Section[]> {
  const { lignes: decisions, tronque: decisionsTronquees } = await decisionsDeRevue(db, revue.id);
  const { lignes: actions, tronque: actionsTronquees } = await actionsDeRevue(db, revue.id);
  const evalues = await evaluerKpisParIds(
    db,
    actions.filter((a: LigneAction) => a.statut === "terminee").map((a: LigneAction) => a.kpi_id),
    revue.date_reference,
  );
  const sections: Section[] = [];
  if (revue.statut === "planifiee") return sections;
  const bd = borner(
    decisions.map((d) => [
      String(d.numero),
      cellule(d.libelle),
      d.responsable_nom ? cellule(d.responsable_nom) : NON_DISPONIBLE,
      dateOuTiret(d.echeance),
      STATUT_DECISION_KPI_LIBELLES[d.statut],
    ]),
  );
  sections.push(
    section("Décisions de la revue", [
      decisions.length === 0
        ? { type: "paragraphe", texte: "Aucune décision enregistrée." }
        : {
            type: "tableau",
            colonnes: ["N°", "Décision", "Responsable", "Échéance", "Statut"],
            alignements: ["droite", "gauche", "gauche", "gauche", "gauche"],
            lignes: bd.lignes,
          },
      ...bd.note,
      ...noteTronquee(decisionsTronquees, "décisions"),
    ]),
  );
  const ba = borner(
    actions.map((a: LigneAction) => [
      String(a.numero),
      cellule(a.titre),
      cellule(a.kpi_libelle),
      a.responsable_nom ? cellule(a.responsable_nom) : NON_DISPONIBLE,
      dateOuTiret(a.echeance),
      STATUT_ACTION_KPI_LIBELLES[a.statut],
      a.statut === "terminee"
        ? (VERDICT_EFFICACITE[
            efficaciteAction(a, evalues.get(a.kpi_id))?.verdict ?? "indeterminee"
          ] ?? NON_DISPONIBLE)
        : NON_DISPONIBLE,
    ]),
  );
  sections.push(
    section("Actions correctives issues de la revue", [
      actions.length === 0
        ? { type: "paragraphe", texte: "Aucune action rattachée à cette revue." }
        : {
            type: "tableau",
            colonnes: ["N°", "Action", "KPI", "Responsable", "Échéance", "Statut", "Efficacité"],
            alignements: ["droite", "gauche", "gauche", "gauche", "gauche", "gauche", "gauche"],
            lignes: ba.lignes,
          },
      ...ba.note,
      ...noteTronquee(actionsTronquees, "actions"),
    ]),
  );
  if (revue.compte_rendu) {
    sections.push(
      section("Compte rendu", [
        { type: "paragraphe", texte: tronquer(revue.compte_rendu, PLAFONDS_MODELE.longueurTexte) },
      ]),
    );
  }
  return sections;
}

/** Contenu à rendre : dossier figé à la tenue (sinon calculé) et suivi vivant des décisions. */
export async function rapportRevueARendre(db: Db, revue: LigneRevue): Promise<Rapport> {
  let base: Rapport;
  if (revue.dossier_fige) {
    const r = await db.query("SELECT dossier FROM kpi_revues WHERE id = $1", [revue.id]);
    base = normaliserRapport(r.rows[0].dossier);
  } else {
    base = await dossierRevue(db, revue, "brouillon");
  }
  const suivi = await sectionsSuivi(db, revue);
  return normaliserRapport({
    ...base,
    genere_le: new Date().toISOString().slice(0, 10),
    sections: [...base.sections, ...suivi],
  });
}
