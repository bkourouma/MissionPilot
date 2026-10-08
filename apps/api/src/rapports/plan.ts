import type { Devise } from "@missionpilot/engines";
import { STATUT_INITIATIVE_LIBELLES, type StatutInitiative } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { ElementCourant } from "../plans/elements.js";
import { donneesRapport } from "../plans/rapport.js";
import { sousTitreRapport, tronquer } from "./etat-avancement.js";
import { dateAffichee, PLAFONDS_MODELE, type Bloc, type Rapport, type Section } from "./modele.js";
import {
  annees,
  borner,
  cellule,
  jours,
  lireEnteteMission,
  liste,
  montantAffiche,
  multiple,
  NON_DISPONIBLE,
  paragraphe,
  points,
  pourcentage,
  section,
} from "./outils.js";
import { sectionSources } from "./sources.js";

/*
 * Rapport du plan stratégique intégré (PLA-11) : synthèse, diagnostic, SWOT,
 * vision et mission, axes et objectifs, initiatives et leur ROI, modèle
 * financier (scénarios, compte de résultat, bilan, flux, indicateurs, alertes).
 *
 * RÈGLE « L'IA PROPOSE, L'EXPERT DISPOSE » : seuls les contenus dont la
 * version courante est VALIDÉE sont reproduits ; un brouillon (de l'IA ou
 * d'un consultant) ou un contenu modifié depuis sa validation n'apparaît
 * jamais, le rapport indique seulement combien sont en attente. Il en va de
 * même du modèle financier : une version non validée n'est pas reproduite, une
 * section le dit (« non validé, non repris ») et la source du rapport n'en cite
 * aucune version. Le statut du
 * document est « validé » quand le plan est prêt pour le client (même règle
 * que le partage : tout le contenu validé, modèle validé), « brouillon »
 * sinon.
 *
 * PROVENANCE DES CHIFFRES (aucun calcul ici) : budgets et gains saisis,
 * VAN et TRI par initiative et modèle financier calculés par le moteur
 * (plans/rapport.ts `donneesRapport`, résultat figé de la version du modèle
 * retenue : celle demandée, sinon la dernière validée, sinon la dernière ;
 * reproduite seulement si elle est validée).
 */

type DonneesPlan = Awaited<ReturnType<typeof donneesRapport>>;
type Financier = NonNullable<DonneesPlan["financier"]>;
type TableauFinancier = Financier["tableaux"]["compte_resultat"];

const PERSPECTIVES: Record<string, string> = {
  finances: "Finances",
  clients: "Clients",
  processus: "Processus internes",
  apprentissage: "Apprentissage et croissance",
};

const SCENARIOS: Record<string, string> = {
  base: "Base",
  optimiste: "Optimiste",
  pessimiste: "Pessimiste",
};

const ALERTES: Record<string, string> = {
  TRESORERIE_NEGATIVE: "Trésorerie nette de clôture négative",
  CAPITAUX_PROPRES_NEGATIFS: "Capitaux propres négatifs",
  CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL:
    "Capitaux propres inférieurs à la moitié du capital (Acte uniforme OHADA)",
  BILAN_DESEQUILIBRE: "Bilan déséquilibré (anomalie du moteur)",
};

/** Format des indicateurs du modèle (clés de plans/rapport.ts) ; montant par défaut. */
const FORMATS_INDICATEUR: Record<string, (v: number | null) => string> = {
  point_mort_jours: jours,
  taux_marge_couts_variables: pourcentage,
  ratio_endettement: multiple,
  capacite_remboursement: annees,
  autonomie_financiere: pourcentage,
  couverture_service_dette: multiple,
};

/** Plafond des paragraphes repris d'un long texte (diagnostic). */
const PARAGRAPHES_MAX = 12;

const texteDe = (donnees: Record<string, unknown>, cle: string): string => {
  const v = donnees[cle];
  return typeof v === "string" ? v : "";
};

const listeDe = (donnees: Record<string, unknown>, cle: string): string[] => {
  const v = donnees[cle];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

/** Texte long découpé en paragraphes (par saut de ligne double, puis par tranches). */
function paragraphesDe(texte: string): Bloc[] {
  const max = PLAFONDS_MODELE.longueurTexte;
  const morceaux = texte
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => {
      const tranches: string[] = [];
      for (let i = 0; i < p.length; i += max) tranches.push(p.slice(i, i + max));
      return tranches;
    });
  const blocs: Bloc[] = morceaux.slice(0, PARAGRAPHES_MAX).map((t) => ({
    type: "paragraphe",
    texte: t,
  }));
  if (morceaux.length > PARAGRAPHES_MAX) {
    blocs.push({ type: "paragraphe", texte: "Suite non reproduite : voir l'application." });
  }
  return blocs;
}

const valides = (elements: readonly ElementCourant[]) =>
  elements.filter((e) => e.statut_contenu === "valide");

function sectionSynthese(d: DonneesPlan, total: number, nbValides: number): Section {
  const f = d.financier;
  const blocs: Bloc[] = [
    {
      type: "indicateurs",
      elements: [
        { libelle: "Horizon", valeur: `${d.plan.horizon} ans` },
        { libelle: "Devise", valeur: d.plan.devise },
        {
          libelle: "Contenus validés",
          valeur: `${nbValides} sur ${total}`,
          detail: "Seuls les contenus validés sont reproduits",
        },
        {
          libelle: "Modèle financier",
          valeur: f ? `Version ${f.version.version}` : "Aucun",
          detail: f
            ? f.version.validation
              ? `Validée le ${dateAffichee(isoDe(f.version.validation.valide_le))}`
              : "Non validée"
            : undefined,
        },
        {
          libelle: "Statut du document",
          valeur: d.pret_pour_client ? "Prêt pour le client" : "Brouillon",
          detail: d.pret_pour_client ? undefined : "Contenus ou modèle à valider",
        },
      ],
    },
  ];
  if (nbValides < total) {
    blocs.push({
      type: "paragraphe",
      texte:
        `${total - nbValides} contenu(s) en attente de validation ne sont pas reproduits : ` +
        `un contenu n'entre dans un rapport qu'une fois validé par un responsable de la mission.`,
    });
  }
  return section("Synthèse", blocs);
}

const isoDe = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

function sectionsContenus(d: DonneesPlan): Section[] {
  const par = (type: string) => valides(d.sections.find((s) => s.type === type)?.elements ?? []);
  const sections: Section[] = [];
  const diagnostic = par("diagnostic")[0];
  if (diagnostic) {
    sections.push(section("Diagnostic", paragraphesDe(texteDe(diagnostic.donnees, "synthese"))));
  }
  const swot = par("swot")[0];
  if (swot) {
    const blocs: Bloc[] = (
      [
        ["forces", "Forces"],
        ["faiblesses", "Faiblesses"],
        ["opportunites", "Opportunités"],
        ["menaces", "Menaces"],
      ] as const
    ).flatMap(([cle, libelle]) => {
      const items = listeDe(swot.donnees, cle);
      return [
        { type: "paragraphe", texte: `${libelle} :` },
        items.length ? liste(items) : { type: "paragraphe", texte: "Aucun constat." },
      ] satisfies Bloc[];
    });
    sections.push(section("Analyse SWOT", blocs));
  }
  const vm = par("vision_mission")[0];
  if (vm) {
    const valeurs = listeDe(vm.donnees, "valeurs");
    sections.push(
      section("Vision et mission", [
        paragraphe(`Vision : ${texteDe(vm.donnees, "vision")}`),
        paragraphe(`Mission : ${texteDe(vm.donnees, "mission")}`),
        ...(valeurs.length
          ? ([{ type: "paragraphe", texte: "Valeurs :" }, liste(valeurs)] satisfies Bloc[])
          : []),
      ]),
    );
  }
  return sections;
}

function sectionAxes(d: DonneesPlan): Section | null {
  const axes = valides(d.sections.find((s) => s.type === "axe")?.elements ?? []);
  const objectifs = valides(d.sections.find((s) => s.type === "objectif")?.elements ?? []);
  if (axes.length === 0 && objectifs.length === 0) return null;
  const tableau = (titre: string, liste: ElementCourant[]): Bloc[] => {
    if (liste.length === 0) return [{ type: "paragraphe", texte: "Aucun objectif validé." }];
    const { lignes, note } = borner(
      liste.map((o) => [
        cellule(texteDe(o.donnees, "titre")),
        PERSPECTIVES[texteDe(o.donnees, "perspective")] ?? NON_DISPONIBLE,
        cellule(texteDe(o.donnees, "indicateur") || NON_DISPONIBLE),
        cellule(texteDe(o.donnees, "cible") || NON_DISPONIBLE),
        dateAffichee(texteDe(o.donnees, "echeance") || null),
      ]),
    );
    return [
      {
        type: "tableau",
        titre: tronquer(titre, PLAFONDS_MODELE.longueurTitre),
        colonnes: ["Objectif", "Perspective", "Indicateur", "Cible", "Échéance"],
        lignes,
      },
      ...note,
    ];
  };
  const blocs: Bloc[] = axes.flatMap((a) => {
    const description = texteDe(a.donnees, "description");
    return [
      ...(description ? [paragraphe(`${texteDe(a.donnees, "titre")} : ${description}`)] : []),
      ...tableau(
        `Axe : ${texteDe(a.donnees, "titre")}`,
        objectifs.filter((o) => o.parent_id === a.id),
      ),
    ];
  });
  const orphelins = objectifs.filter((o) => !axes.some((a) => a.id === o.parent_id));
  if (orphelins.length)
    blocs.push(...tableau("Objectifs d'axes en attente de validation", orphelins));
  return section("Axes stratégiques et objectifs", blocs);
}

function sectionInitiatives(d: DonneesPlan, devise: Devise): Section | null {
  const initiatives = valides(d.sections.find((s) => s.type === "initiative")?.elements ?? []);
  if (initiatives.length === 0) return null;
  const titres = new Map(
    valides(d.sections.flatMap((s) => s.elements)).map((e) => [e.id, texteDe(e.donnees, "titre")]),
  );
  const tri = [...initiatives].sort((x, y) =>
    texteDe(x.donnees, "echeance").localeCompare(texteDe(y.donnees, "echeance")),
  );
  const { lignes, note } = borner(
    tri.map((i) => [
      cellule(texteDe(i.donnees, "titre")),
      cellule((i.parent_id && titres.get(i.parent_id)) || NON_DISPONIBLE),
      dateAffichee(texteDe(i.donnees, "debut") || null),
      dateAffichee(texteDe(i.donnees, "echeance") || null),
      STATUT_INITIATIVE_LIBELLES[texteDe(i.donnees, "statut") as StatutInitiative] ??
        NON_DISPONIBLE,
      montantAffiche(i.donnees.budget, devise),
    ]),
  );
  const ids = new Set(initiatives.map((i) => i.id));
  const roi = d.roi.initiatives.filter((r) => ids.has(r.id) && r.flux !== null);
  const blocs: Bloc[] = [
    {
      type: "tableau",
      titre: "Feuille de route",
      colonnes: ["Initiative", "Rattachement", "Début", "Échéance", "Statut", "Budget"],
      alignements: ["gauche", "gauche", "gauche", "gauche", "gauche", "droite"],
      lignes,
    },
    ...note,
  ];
  if (roi.length) {
    const t = borner(
      roi.map((r) => [
        cellule(r.titre),
        montantAffiche(r.budget, devise),
        montantAffiche(r.valeur_actuelle_nette, devise),
        pourcentage(r.taux_rendement_interne),
      ]),
    );
    blocs.push(
      {
        type: "tableau",
        titre: "Retour sur investissement",
        colonnes: ["Initiative", "Budget", "VAN", "TRI"],
        alignements: ["gauche", "droite", "droite", "droite"],
        lignes: t.lignes,
      },
      ...t.note,
      {
        type: "paragraphe",
        texte:
          `VAN au taux d'actualisation de ${points(d.roi.taux_actualisation)} sur le budget ` +
          `(année 0) et les gains annuels saisis ; TRI calculé par le moteur.`,
      },
    );
  }
  return section("Initiatives", blocs);
}

function tableauFinancier(t: TableauFinancier, devise: Devise, formats = false): Bloc[] {
  const { lignes, note } = borner(
    t.lignes.map((l) => [
      cellule(l.reference_syscohada ? `${l.libelle} (${l.reference_syscohada})` : l.libelle),
      ...l.valeurs.map((v) =>
        formats && FORMATS_INDICATEUR[l.cle]
          ? (FORMATS_INDICATEUR[l.cle] as (v: number | null) => string)(v)
          : montantAffiche(v, devise),
      ),
    ]),
  );
  const colonnes = ["Rubrique", ...t.colonnes.map(String)];
  return [
    {
      type: "tableau",
      colonnes,
      alignements: colonnes.map((_, j) => (j === 0 ? "gauche" : "droite")),
      lignes,
    },
    ...note,
  ];
}

/** Sections du modèle financier validé (repris aussi par le dossier bancaire, PLA-17). */
export function sectionsFinancieres(f: Financier, devise: Devise): Section[] {
  const synthese = borner(
    f.scenarios.map((s) => [
      SCENARIOS[s.scenario] ?? s.scenario,
      montantAffiche(s.chiffreAffairesFinal, devise),
      montantAffiche(s.resultatNetCumule, devise),
      montantAffiche(s.tresorerieFinale, devise),
      montantAffiche(s.valeurActuelleNette, devise),
      pourcentage(s.tauxRendementInterne),
      String(s.nombreAlertes),
    ]),
  );
  const alertes = f.alertes.map(
    (a) =>
      `${ALERTES[a.code] ?? a.code} — exercice ${a.exercice} : ${montantAffiche(a.montant, devise)}`,
  );
  const validation = f.version.validation
    ? `validée le ${dateAffichee(isoDe(f.version.validation.valide_le))}`
    : "non validée";
  return [
    section("Modèle financier : synthèse des scénarios", [
      {
        type: "tableau",
        colonnes: [
          "Scénario",
          "CA final",
          "Résultat net cumulé",
          "Trésorerie finale",
          "VAN",
          "TRI",
          "Alertes",
        ],
        alignements: ["gauche", "droite", "droite", "droite", "droite", "droite", "droite"],
        lignes: synthese.lignes,
      },
      ...synthese.note,
      {
        type: "paragraphe",
        texte:
          `Version ${f.version.version} du modèle (${validation}), horizon ${f.horizon} ans, ` +
          `montants en ${devise}. États du scénario de base au format SYSCOHADA révisé (références entre parenthèses).`,
      },
      ...(alertes.length
        ? ([
            { type: "paragraphe", texte: "Alertes du scénario de base :" },
            liste(alertes),
          ] satisfies Bloc[])
        : [{ type: "paragraphe", texte: "Aucune alerte sur le scénario de base." } satisfies Bloc]),
    ]),
    section(f.tableaux.compte_resultat.titre, tableauFinancier(f.tableaux.compte_resultat, devise)),
    section(f.tableaux.bilan.titre, tableauFinancier(f.tableaux.bilan, devise)),
    section(f.tableaux.flux_tresorerie.titre, tableauFinancier(f.tableaux.flux_tresorerie, devise)),
    section(f.tableaux.indicateurs.titre, tableauFinancier(f.tableaux.indicateurs, devise, true)),
  ];
}

/** Mention tenant lieu de modèle financier dont la version retenue n'est pas validée. */
function sectionModeleNonValide(version: number): Section {
  return section("Modèle financier", [
    paragraphe(
      `Modèle financier non validé, non repris : la version ${version} du modèle financier n'a pas ` +
        `été validée par un responsable de la mission. Ses états prévisionnels paraîtront dans le ` +
        `rapport une fois la version validée.`,
    ),
  ]);
}

/** Source du rapport : plan, et version du modèle financier REPRODUITE (null : aucune). */
export interface SourcePlan {
  missionId: string;
  planId: string;
  version: number | null;
}

/** Contenu du rapport d'un plan visible ; `version` : version du modèle financier (404 si absente). */
export async function rapportPlan(
  db: Db,
  auth: Auth,
  planId: string,
  version: number | undefined,
  aujourdhui: string,
): Promise<{ rapport: Rapport; source: SourcePlan }> {
  const d = await donneesRapport(db, auth, planId, version);
  const entete = await lireEnteteMission(db, d.plan.mission_id);
  const devise = d.plan.devise as Devise;
  const tous = d.sections.flatMap((s) => s.elements);
  const sections: Section[] = [
    sectionSynthese(d, tous.length, valides(tous).length),
    ...sectionsContenus(d),
  ];
  const axes = sectionAxes(d);
  if (axes) sections.push(axes);
  const initiatives = sectionInitiatives(d, devise);
  if (initiatives) sections.push(initiatives);
  // Modèle financier : reproduit seulement s'il est validé (sinon, la mention dit qu'il est omis).
  const financier = d.financier?.version.validation ? d.financier : null;
  if (financier) sections.push(...sectionsFinancieres(financier, financier.devise as Devise));
  else if (d.financier) sections.push(sectionModeleNonValide(d.financier.version.version));
  sections.push(
    section("Méthode", [
      {
        type: "paragraphe",
        texte:
          `Plan « ${tronquer(d.plan.titre, 150)} ». Seuls les contenus validés par un responsable ` +
          `de la mission sont reproduits. Les chiffres (budgets et gains saisis, VAN, TRI, états ` +
          `prévisionnels) sont calculés par les moteurs de MissionPilot ; aucun chiffre ni texte ` +
          `de ce rapport n'est produit par l'IA sans validation.`,
      },
    ]),
  );
  const sources = await sectionSources(db, auth, d.plan.mission_id, "plan");
  return {
    source: {
      missionId: d.plan.mission_id,
      planId: d.plan.id,
      version: financier?.version.version ?? null,
    },
    rapport: {
      titre: "Plan stratégique",
      sous_titre: sousTitreRapport(d.plan.titre, entete.client),
      emetteur: tronquer(entete.cabinet, PLAFONDS_MODELE.longueurTitre),
      statut: d.pret_pour_client ? "valide" : "brouillon",
      genere_le: aujourdhui,
      confidentiel: false,
      // L'annexe des sources (PRV-06) est gardée même quand le plafond de sections coupe le reste.
      sections: sources
        ? [...sections.slice(0, PLAFONDS_MODELE.sections - 1), sources]
        : sections.slice(0, PLAFONDS_MODELE.sections),
    },
  };
}
