import {
  formaterPointsDeBase,
  sectionsDeLaNote,
  type Devise,
  type SectionNote,
  type VarianteNote,
} from "@missionpilot/engines";
import {
  ANALYSE_DD_LIBELLES,
  ANALYSES_DD,
  CATEGORIE_ANALYSE_DD_LIBELLES,
  CODE_AVERTISSEMENT_NOTE_LIBELLES,
  DECISION_EXCLUSION_LIBELLES,
  ETAT_CONSTAT_SIGNAL_LIBELLES,
  FAMILLE_RISQUE_DD_LIBELLES,
  FAMILLES_RISQUE_DD,
  METHODE_DIMENSIONNEMENT_LIBELLES,
  NIVEAU_ES_LIBELLES,
  NIVEAU_RISQUE_DD_LIBELLES,
  noteBaseSchema,
  PARAMETRE_DIMENSIONNEMENT_LIBELLES,
  PARAMETRES_DIMENSIONNEMENT,
  RECOMMANDATION_NOTE_LIBELLES,
  STATUT_ACTION_100J_LIBELLES,
  THEME_ES_LIBELLES,
  TYPE_OPERATION_DD_LIBELLES,
  TYPE_SOURCE_PREUVE_LIBELLES,
  VERDICT_DD_LIBELLES,
  type NoteBase,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { dossierAccessible } from "../due-diligence/acces.js";
import {
  lireNote,
  validationsDeNote,
  versionsDeNote,
  versionValidee,
} from "../due-diligence/notes.js";
import { chargerEtatDossier, controleNoteDe } from "../due-diligence/synthese.js";
import { sousTitreRapport, tronquer } from "./etat-avancement.js";
import { dateAffichee, PLAFONDS_MODELE, type Bloc, type Rapport, type Section } from "./modele.js";
import {
  borner,
  cellule,
  lireEnteteMission,
  liste,
  montantAffiche,
  NON_DISPONIBLE,
  paragraphe,
  section,
} from "./outils.js";

/*
 * Rapport de la note au comité (DD-13, SPEC-3b §9.3) : deux VARIANTES, « exécutive » et
 * « détaillée », rendues depuis la MÊME `base_figee` de la version VALIDÉE de la note (409
 * NOTE_NON_VALIDEE sinon ; doublé en base, MPR04). Aucun calcul ici : la base est lue, validée par
 * `noteBaseSchema` puis mise en forme (montants par `formaterMontant` dans la devise du dossier,
 * points de base par `formaterPointsDeBase`, dates JJ/MM/AAAA). Les chiffres sont placés dans des
 * blocs « indicateurs » : le suivi qualité les liste comme chiffres issus des moteurs. Les extraits
 * de preuve sont ceux, déjà masqués, de la base (verbatim nominatif sans accord masqué pour tous).
 * Niveau « dd » (lecture : « dd.lire »), confidentiel.
 */

export interface SourceNote {
  missionId: string;
  noteId: string;
  version: number;
  variante: VarianteNote;
  titre: string;
}

const ENTIER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const LECTURES: Record<string, string> = { solide: "Solide", etayee: "Étayée", fragile: "Fragile" };
const NIVEAUX_ELEVES = new Set(["eleve", "critique"]);

const lecture = (l: string | null) => (l === null ? "Non évaluée" : (LECTURES[l] ?? l));
const niveauRisque = (n: string | null) =>
  n === null
    ? NON_DISPONIBLE
    : (NIVEAU_RISQUE_DD_LIBELLES[n as keyof typeof NIVEAU_RISQUE_DD_LIBELLES] ?? n);
const bp = (v: number | null) => (v === null ? NON_DISPONIBLE : formaterPointsDeBase(v));

const tableau = (colonnes: string[], lignes: string[][], titre?: string): Bloc[] => {
  const b = borner(lignes);
  return [{ type: "tableau", ...(titre ? { titre } : {}), colonnes, lignes: b.lignes }, ...b.note];
};

function sectionRecommandation(base: NoteBase, contenu: ContenuNote): Section {
  const blocs: Bloc[] = [
    {
      type: "indicateurs",
      elements: [
        {
          libelle: "Recommandation",
          valeur: RECOMMANDATION_NOTE_LIBELLES[contenu.recommandation],
        },
      ],
    },
    paragraphe(`Base figée le ${dateAffichee(base.genere_le)}.`),
  ];
  if (contenu.conditions.length > 0) {
    blocs.push(paragraphe("Conditions :"), liste(contenu.conditions));
  }
  if (base.avertissements.length > 0) {
    blocs.push(
      paragraphe("Points d'attention relevés par les contrôles :"),
      liste(base.avertissements.map((a) => CODE_AVERTISSEMENT_NOTE_LIBELLES[a])),
    );
  }
  return section("Recommandation", blocs);
}

function sectionCadrage(base: NoteBase): Section {
  const c = base.cadrage;
  const lignes: string[][] = [
    ["Titre", cellule(c.titre)],
    ["Secteur", cellule(c.secteur_libelle)],
    ["Filière", cellule(c.filiere_libelle ?? NON_DISPONIBLE)],
    ["Pays", cellule(c.pays_libelle)],
    ["Cible", cellule(c.cible_nom ?? NON_DISPONIBLE)],
    ["Type d'opération", TYPE_OPERATION_DD_LIBELLES[c.type_operation]],
    ["Devise", c.devise],
    ["Date de l'opération", dateAffichee(c.date_operation)],
    ["Question d'investissement", cellule(c.question_investissement ?? NON_DISPONIBLE)],
    ["Périmètre", cellule(c.perimetre ?? NON_DISPONIBLE)],
  ];
  return section("Cadrage", tableau(["Rubrique", "Valeur"], lignes));
}

function sectionVerdicts(base: NoteBase, variante: VarianteNote): Section {
  const detaillee = variante === "detaillee";
  const colonnes = detaillee
    ? [
        "Hypothèse",
        "Verdict",
        "Solidité minimale",
        "Indication du moteur",
        "Critère",
        "Sources citées",
      ]
    : ["Hypothèse", "Verdict", "Solidité minimale"];
  const lignes = base.hypotheses.map((h) => {
    const commun = [
      cellule(h.libelle),
      h.verdict === null ? "Sans verdict validé" : VERDICT_DD_LIBELLES[h.verdict],
      lecture(h.solidite_min),
    ];
    return detaillee
      ? [
          ...commun,
          h.indication_moteur === null ? NON_DISPONIBLE : VERDICT_DD_LIBELLES[h.indication_moteur],
          cellule(h.critere ?? NON_DISPONIBLE),
          ENTIER.format(h.nb_citees),
        ]
      : commun;
  });
  return section(
    "Verdicts des hypothèses",
    lignes.length === 0 ? [paragraphe("Aucune hypothèse.")] : tableau(colonnes, lignes),
  );
}

function sectionAnalyses(base: NoteBase): Section {
  const blocs: Bloc[] = [];
  for (const analyse of ANALYSES_DD) {
    const points = base.detail.analyses.filter((a) => a.analyse === analyse);
    if (points.length === 0) continue;
    blocs.push(
      ...tableau(
        ["Catégorie", "Affirmation", "Importance", "Solidité", "Sources"],
        points.map((p) => [
          CATEGORIE_ANALYSE_DD_LIBELLES[
            p.categorie as keyof typeof CATEGORIE_ANALYSE_DD_LIBELLES
          ] ?? p.categorie,
          cellule(p.enonce),
          niveauRisque(p.niveau),
          lecture(p.lecture),
          p.renvois.length === 0 ? "Aucune source" : p.renvois.map((n) => `[${n}]`).join(" "),
        ]),
        ANALYSE_DD_LIBELLES[analyse],
      ),
    );
  }
  return section(
    "Analyses",
    blocs.length === 0 ? [paragraphe("Aucun point d'analyse saisi.")] : blocs,
  );
}

function sectionChaine(base: NoteBase): Section {
  const lignes = base.detail.chaine.map((e) => [
    ENTIER.format(e.ordre),
    cellule(e.libelle),
    bp(e.part_cout_bp),
    bp(e.part_marge_bp),
    e.rang_marge === null ? NON_DISPONIBLE : ENTIER.format(e.rang_marge),
  ]);
  return section(
    "Chaîne de valeur",
    lignes.length === 0
      ? [paragraphe("Aucune étape saisie.")]
      : tableau(["Ordre", "Étape", "Part des coûts", "Part de la marge", "Rang de marge"], lignes),
  );
}

function sectionRisques(base: NoteBase, variante: VarianteNote): Section {
  const retenus =
    variante === "executive"
      ? base.risques.filter((r) => NIVEAUX_ELEVES.has(r.niveau))
      : base.risques;
  const ordre = new Map(FAMILLES_RISQUE_DD.map((f, i) => [f as string, i]));
  const tries = [...retenus].sort(
    (a, b) => (ordre.get(a.famille) ?? 0) - (ordre.get(b.famille) ?? 0),
  );
  const lignes = tries.map((r) => [
    FAMILLE_RISQUE_DD_LIBELLES[r.famille],
    niveauRisque(r.niveau),
    cellule(r.libelle),
    cellule(r.etape ?? NON_DISPONIBLE),
    lecture(r.lecture),
  ]);
  return section(
    variante === "executive" ? "Risques majeurs" : "Risques",
    lignes.length === 0
      ? [
          paragraphe(
            variante === "executive"
              ? "Aucun risque élevé ou critique n'a été saisi dans le dossier."
              : "Aucun risque n'a été saisi dans le dossier.",
          ),
        ]
      : tableau(["Famille", "Niveau", "Risque", "Étape", "Solidité"], lignes),
  );
}

function sectionSignaux(base: NoteBase): Section {
  const lignes = base.detail.signaux.map((s) => [
    cellule(s.libelle),
    FAMILLE_RISQUE_DD_LIBELLES[s.famille],
    niveauRisque(s.gravite),
    ETAT_CONSTAT_SIGNAL_LIBELLES[s.etat],
  ]);
  return section(
    "Signaux d'alerte",
    lignes.length === 0
      ? [paragraphe("Aucun signal constaté, écarté ou à vérifier.")]
      : tableau(["Signal", "Famille", "Gravité indicative", "État"], lignes),
  );
}

function libelleMarche(devise: Devise, code: string, valeur: number): string {
  const unite = [
    ...PARAMETRES_DIMENSIONNEMENT.descendant,
    ...PARAMETRES_DIMENSIONNEMENT.ascendant,
  ].find((p) => p.code === code)?.unite;
  if (unite === "montant") return montantAffiche(valeur, devise);
  if (unite === "pourcentage_bp") return formaterPointsDeBase(valeur);
  return ENTIER.format(valeur);
}

function sectionMarche(base: NoteBase, variante: VarianteNote): Section {
  const devise = base.cadrage.devise as Devise;
  if (!base.marche.present) {
    return section("Marché", [paragraphe("Aucun dimensionnement de marché renseigné.")]);
  }
  const blocs: Bloc[] = [];
  for (const d of base.marche.dimensionnements.slice(0, 6)) {
    blocs.push({
      type: "indicateurs",
      elements: [
        {
          libelle: `${tronquer(d.libelle, 200)} — bas`,
          valeur: montantAffiche(d.resultat.bas, devise),
          detail: METHODE_DIMENSIONNEMENT_LIBELLES[d.methode],
        },
        {
          libelle: `${tronquer(d.libelle, 200)} — base`,
          valeur: montantAffiche(d.resultat.base, devise),
        },
        {
          libelle: `${tronquer(d.libelle, 200)} — haut`,
          valeur: montantAffiche(d.resultat.haut, devise),
        },
      ],
    });
  }
  const r = base.marche.recoupement;
  if (r !== null) {
    blocs.push({
      type: "indicateurs",
      elements: [
        {
          libelle: "Écart entre les deux méthodes",
          valeur: formaterPointsDeBase(r.ecart_bp),
          detail: r.alerte
            ? "Écart supérieur au seuil d'alerte (provisoire)"
            : "Écart inférieur au seuil d'alerte (provisoire)",
        },
      ],
    });
  }
  if (variante === "detaillee") {
    for (const d of base.marche.dimensionnements.slice(0, 6)) {
      blocs.push(
        ...tableau(
          ["Paramètre", "Bas", "Base", "Haut", "Source"],
          d.parametres.map((p) => [
            PARAMETRE_DIMENSIONNEMENT_LIBELLES[p.code],
            libelleMarche(devise, p.code, p.bas),
            libelleMarche(devise, p.code, p.base),
            libelleMarche(devise, p.code, p.haut),
            p.source === "preuve"
              ? "Preuve du registre"
              : p.source === "avis_expert"
                ? "Avis d'expert"
                : "Sans source",
          ]),
          cellule(d.libelle),
        ),
      );
    }
  }
  return section("Marché", blocs);
}

function sectionSensibilite(base: NoteBase): Section {
  const devise = base.cadrage.devise as Devise;
  const lignes = base.detail.sensibilite.map((s) => [
    METHODE_DIMENSIONNEMENT_LIBELLES[s.methode],
    PARAMETRE_DIMENSIONNEMENT_LIBELLES[s.code],
    montantAffiche(s.resultat_bas, devise),
    montantAffiche(s.resultat_haut, devise),
    montantAffiche(s.amplitude, devise),
    formaterPointsDeBase(s.part_amplitude_bp),
  ]);
  return section(
    "Sensibilité",
    lignes.length === 0
      ? [paragraphe("Aucune sensibilité calculée.")]
      : tableau(
          [
            "Méthode",
            "Paramètre",
            "Résultat bas",
            "Résultat haut",
            "Amplitude",
            "Part de l'amplitude",
          ],
          lignes,
        ),
  );
}

function sectionFiltrage(base: NoteBase, variante: VarianteNote): Section {
  const f = base.filtrage_es;
  if (!f.realise) {
    return section("Filtrage environnemental et social", [
      paragraphe("Aucun filtrage environnemental et social n'a été réalisé."),
    ]);
  }
  const blocs: Bloc[] = [
    {
      type: "indicateurs",
      elements: [
        {
          libelle: "Niveau global",
          valeur: f.niveau_global === null ? NON_DISPONIBLE : NIVEAU_ES_LIBELLES[f.niveau_global],
        },
        {
          libelle: "Exclusions non levées",
          valeur: ENTIER.format(base.exclusions_bloquantes),
          detail: f.bloquant ? "Bloquant" : "Aucune exclusion bloquante",
        },
      ],
    },
  ];
  const anterieurs = f.filtrages_anterieurs;
  blocs.push(
    paragraphe(
      `Filtrage réalisé avec la liste d'exclusion « ${f.liste?.nom ?? NON_DISPONIBLE} », version ${
        f.liste === null ? NON_DISPONIBLE : ENTIER.format(f.liste.version)
      }.${
        anterieurs > 0
          ? ` Le dossier compte ${ENTIER.format(anterieurs)} filtrage(s) antérieur(s).`
          : ""
      }`,
    ),
  );
  if (f.exclusions_anterieures_non_levees > 0) {
    blocs.push(
      paragraphe(
        `Exclusion(s) confirmée(s) dans un filtrage antérieur et non levée(s) dans le dernier : ${ENTIER.format(f.exclusions_anterieures_non_levees)}. Elles restent bloquantes.`,
      ),
    );
  }
  if (f.touches.length === 0) {
    blocs.push(
      paragraphe(
        "Aucune règle de la liste d'exclusion n'a été touchée par les activités déclarées dans le dernier filtrage.",
      ),
    );
  } else {
    blocs.push(
      ...tableau(
        ["Règle d'exclusion touchée", "Décision"],
        f.touches.map((t) => [
          cellule(t.libelle),
          t.decision === null ? "Sans décision" : DECISION_EXCLUSION_LIBELLES[t.decision],
        ]),
      ),
    );
  }
  const themes =
    variante === "executive" ? f.themes.filter((t) => NIVEAUX_ELEVES.has(t.niveau)) : f.themes;
  if (themes.length > 0) {
    blocs.push(
      ...tableau(
        ["Thème", "Niveau", "Justification"],
        themes.map((t) => [
          THEME_ES_LIBELLES[t.code],
          NIVEAU_ES_LIBELLES[t.niveau],
          cellule(t.justification ?? NON_DISPONIBLE),
        ]),
        variante === "executive" ? "Thèmes à documenter" : undefined,
      ),
    );
  }
  return section("Filtrage environnemental et social", blocs);
}

function sectionPlan(base: NoteBase, variante: VarianteNote): Section {
  const p = base.plan_100j;
  if (!p.present) {
    return section("Plan des 100 jours", [paragraphe("Aucune action planifiée.")]);
  }
  const phase = (x: { total: number; terminees: number }) =>
    `${ENTIER.format(x.total)} action(s), dont ${ENTIER.format(x.terminees)} terminée(s)`;
  const blocs: Bloc[] = [
    {
      type: "indicateurs",
      elements: [
        {
          libelle: "Actions terminées",
          valeur: `${ENTIER.format(p.terminees)} sur ${ENTIER.format(p.total)}`,
        },
        { libelle: "Jours 0 à 30", valeur: phase(p.par_phase.jours_0_30) },
        { libelle: "Jours 31 à 60", valeur: phase(p.par_phase.jours_31_60) },
        { libelle: "Jours 61 à 100", valeur: phase(p.par_phase.jours_61_100) },
      ],
    },
  ];
  if (variante === "detaillee") {
    blocs.push(
      ...tableau(
        ["Action", "Jours", "Dates", "Statut"],
        p.actions.map((a) => [
          cellule(a.libelle),
          `${ENTIER.format(a.jour_debut)} à ${ENTIER.format(a.jour_fin)}`,
          a.date_debut === null || a.date_fin === null
            ? NON_DISPONIBLE
            : `${dateAffichee(a.date_debut)} au ${dateAffichee(a.date_fin)}`,
          STATUT_ACTION_100J_LIBELLES[a.statut],
        ]),
      ),
    );
  }
  return section("Plan des 100 jours", blocs);
}

function sectionAjustements(base: NoteBase, variante: VarianteNote): Section {
  const total = base.ajustements.length;
  if (total === 0) {
    return section("Ajustements des experts", [
      paragraphe("Aucun écart à une proposition d'un moteur n'a été tracé."),
    ]);
  }
  const resume: Bloc = {
    type: "indicateurs",
    elements: [{ libelle: "Ajustements tracés", valeur: ENTIER.format(total) }],
  };
  if (variante === "executive") {
    return section("Ajustements des experts", [
      resume,
      liste(base.ajustements.map((a) => `${a.champ} : ${a.motif}`)),
    ]);
  }
  return section("Ajustements des experts", [
    resume,
    ...tableau(
      ["Cible", "Champ", "Avant", "Après", "Motif"],
      base.ajustements.map((a) => [
        a.cible_type === "verdict"
          ? "Verdict"
          : a.cible_type === "risque"
            ? "Risque"
            : "Dimensionnement",
        cellule(a.champ),
        cellule(a.avant),
        cellule(a.apres),
        cellule(a.motif),
      ]),
    ),
  ]);
}

function sectionSources(base: NoteBase): Section {
  const lignes = base.detail.sources.map((s) => [
    `[${s.n}]`,
    TYPE_SOURCE_PREUVE_LIBELLES[s.type as keyof typeof TYPE_SOURCE_PREUVE_LIBELLES] ?? s.type,
    cellule(s.source),
    dateAffichee(s.date),
    s.fiabilite,
    cellule(s.extrait ?? (s.masque ? "Extrait masqué" : NON_DISPONIBLE)),
  ]);
  return section(
    "Sources",
    lignes.length === 0
      ? [paragraphe("Aucune source liée aux analyses.")]
      : tableau(["N°", "Type", "Source", "Date", "Fiabilité", "Extrait"], lignes),
  );
}

interface ContenuNote {
  recommandation: keyof typeof RECOMMANDATION_NOTE_LIBELLES;
  synthese: string;
  conditions: string[];
}

function construireSection(
  code: SectionNote,
  base: NoteBase,
  contenu: ContenuNote,
  variante: VarianteNote,
): Section {
  switch (code) {
    case "recommandation":
      return sectionRecommandation(base, contenu);
    case "synthese":
      return section("Synthèse", [paragraphe(contenu.synthese)]);
    case "cadrage":
      return sectionCadrage(base);
    case "verdicts":
      return sectionVerdicts(base, variante);
    case "analyses":
      return sectionAnalyses(base);
    case "chaine_valeur":
      return sectionChaine(base);
    case "risques":
      return sectionRisques(base, variante);
    case "signaux":
      return sectionSignaux(base);
    case "marche":
      return sectionMarche(base, variante);
    case "sensibilite":
      return sectionSensibilite(base);
    case "filtrage_es":
      return sectionFiltrage(base, variante);
    case "plan_100_jours":
      return sectionPlan(base, variante);
    case "ajustements":
      return sectionAjustements(base, variante);
    case "sources":
      return sectionSources(base);
  }
}

/**
 * Contenu du rapport d'une version VALIDÉE de la note (la dernière si `version` est absente) :
 * 404 si la note est invisible, 409 NOTE_NON_VALIDEE si la version n'est pas validée.
 */
export async function rapportNoteComite(
  db: Db,
  auth: Auth,
  noteId: string,
  version: number | undefined,
  variante: VarianteNote,
  aujourdhui: string,
): Promise<{ rapport: Rapport; source: SourceNote }> {
  const note = await lireNote(db, noteId);
  const { dossier, mission } = await dossierAccessible(db, auth, note.dossier_id, false, "Note");
  const validations = await validationsDeNote(db, note.id);
  const validee = version ?? versionValidee(validations);
  const decision = validations.find((v) => v.version === validee && v.decision === "valide");
  if (validee === null || !decision) {
    throw new AppError(
      409,
      "NOTE_NON_VALIDEE",
      "Seule une version validée de la note se rend en rapport.",
    );
  }
  // Une version soumise plus récente (en attente, rejetée ou validée) périme la version demandée.
  const derniereSoumise = (await versionsDeNote(db, note.id)).find((v) => v.etat === "soumise");
  if (!derniereSoumise || derniereSoumise.version !== validee) {
    throw new AppError(
      409,
      "NOTE_PERIMEE",
      "Cette version n'est plus la dernière version soumise de la note : une version plus récente existe.",
    );
  }
  const r = await db.query(
    `SELECT recommandation, synthese, conditions, base_figee
     FROM dd_note_versions WHERE note_id = $1 AND version = $2 AND etat = 'soumise'`,
    [note.id, validee],
  );
  if (!r.rows[0]) throw introuvable("Version de la note");
  // Le dossier a pu changer depuis la validation : les contrôles bloquants sont recalculés sur
  // l'état courant, comme à la validation (NOTE_BLOQUEE).
  const controle = controleNoteDe(
    await chargerEtatDossier(db, mission, dossier),
    r.rows[0].recommandation,
    (r.rows[0].conditions as string[]).length,
  );
  if (controle.bloquants.length > 0) {
    throw new AppError(
      409,
      "NOTE_BLOQUEE",
      "Le dossier a changé depuis la validation : des contrôles bloquants réapparaissent, la note ne se rend pas en rapport.",
      { manquants: [...controle.bloquants] },
    );
  }
  const parse = noteBaseSchema.safeParse(r.rows[0].base_figee);
  if (!parse.success) {
    throw new AppError(
      409,
      "NOTE_BASE_INVALIDE",
      "La base figée de cette version de la note est illisible.",
    );
  }
  const base = parse.data;
  const contenu: ContenuNote = {
    recommandation: r.rows[0].recommandation,
    synthese: r.rows[0].synthese,
    conditions: r.rows[0].conditions,
  };
  const entete = await lireEnteteMission(db, mission.id);
  const sections = sectionsDeLaNote(variante).map((code) =>
    construireSection(code, base, contenu, variante),
  );
  return {
    source: {
      missionId: mission.id,
      noteId: note.id,
      version: validee,
      variante,
      titre: note.titre,
    },
    rapport: {
      titre: "Note au comité",
      sous_titre: sousTitreRapport(note.titre, entete.client),
      emetteur: tronquer(entete.cabinet, PLAFONDS_MODELE.longueurTitre),
      statut: "valide",
      genere_le: aujourdhui,
      confidentiel: true,
      sections: sections.slice(0, PLAFONDS_MODELE.sections),
    },
  };
}
