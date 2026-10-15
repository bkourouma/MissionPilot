/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from "vitest";
import type { Api } from "./api.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import { creerAssertion, creerPreuve } from "./preuves-outils.js";

/*
 * Outils des tests du service #2 « Due diligence » (lot 3b) : scénario à deux cabinets, deux
 * clients dans le cabinet A (plans, initiatives et KPI de chaque client pour les liens du plan des
 * 100 jours), utilisateurs aux rôles de la matrice, et jeu de données SQL complet (une ligne dans
 * chacune des vingt tables `dd_*`) pour les tests de la base.
 */

export const INCONNU = "00000000-0000-4000-8000-000000000000";

export const TABLES_DD = [
  "dd_dossiers",
  "dd_cadrage_versions",
  "dd_signaux",
  "dd_signal_versions",
  "dd_elements",
  "dd_element_versions",
  "dd_signal_constats",
  "dd_hypothese_liens",
  "dd_verdicts",
  "dd_verdict_validations",
  "dd_dimensionnements",
  "dd_dimensionnement_versions",
  "dd_exclusion_listes",
  "dd_exclusion_liste_versions",
  "dd_filtrages",
  "dd_filtrage_decisions",
  "dd_ajustements",
  "dd_notes",
  "dd_note_versions",
  "dd_note_validations",
] as const;

export type Reponse = Awaited<ReturnType<Api["get"]>>;

export function attendu(statut: number, r: Reponse): any {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

export interface ScenarioDd {
  a: CabinetMissions;
  b: CabinetMissions;
  /** Mission du client A1, cible des dossiers. */
  missionId: string;
  /** Seconde mission du MÊME client (plan, initiative et KPI liables). */
  mission2Id: string;
  /** Mission d'un AUTRE client du cabinet A (plan, initiative et KPI non liables). */
  missionAutreClient: string;
  autreClientId: string;
  missionB: string;
  consultantEquipe: ApiUtilisateur;
  consultant2: ApiUtilisateur;
  expertMetier: ApiUtilisateur;
  consultantHors: ApiUtilisateur;
  gestionnaire: ApiUtilisateur;
  expertExterne: ApiUtilisateur;
  ressources: ApiUtilisateur;
  /** Initiative et KPI de la seconde mission du même client. */
  initiativeMemeClient: string;
  kpiMemeClient: string;
  /** Initiative, axe et KPI de l'autre client. */
  initiativeAutreClient: string;
  axeMemeClient: string;
  kpiAutreClient: string;
}

async function planAvecInitiative(
  a: CabinetMissions,
  missionId: string,
): Promise<{ axe: string; initiative: string }> {
  const plan = attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/plans`, { titre: "Plan du dossier de test" }),
  ).id as string;
  const axe = attendu(
    201,
    await a.chef.post(`/api/plans/${plan}/elements`, {
      type: "axe",
      donnees: { titre: "Croissance" },
    }),
  ).id as string;
  const initiative = attendu(
    201,
    await a.chef.post(`/api/plans/${plan}/elements`, {
      type: "initiative",
      parent_id: axe,
      donnees: { titre: "Intégration", debut: "2027-01-01", echeance: "2027-06-30", budget: 1 },
    }),
  ).id as string;
  return { axe, initiative };
}

async function creerKpiDe(a: CabinetMissions, missionId: string): Promise<string> {
  return attendu(
    201,
    await a.chef.post(`/api/missions/${missionId}/kpi`, {
      libelle: "Chiffre d'affaires mensuel",
      unite: "kFCFA",
      perspective: "finances",
      sens: "plus_haut_mieux",
      nature: "flux",
      frequence: "mensuelle",
      debut_suivi: "2026-01-01",
      cible: 1000,
    }),
  ).id as string;
}

export async function preparerDd(ctx: Contexte, nom = "DD"): Promise<ScenarioDd> {
  const a = await preparerCabinet(ctx, `${nom} A`);
  const b = await preparerCabinet(ctx, `${nom} B`);
  const missionId = (await creerMission(a, { intitule: "Due diligence — cible" })).id;
  const mission2Id = (await creerMission(a, { intitule: "Plan du même client" })).id;
  const autre = await a.associe.post("/api/clients", { raison_sociale: "Autre client (fictif)" });
  attendre(201, autre, "autre client");
  const autreClientId = autre.json().id as string;
  const missionAutreClient = (
    await creerMission(a, { intitule: "Mission de l'autre client", client_id: autreClientId })
  ).id;
  const missionB = (await creerMission(b, { intitule: "Mission du cabinet B" })).id;
  const consultantEquipe = await a.avecRoles(["consultant"]);
  const consultant2 = await a.avecRoles(["consultant"]);
  const expertMetier = await a.avecRoles(["expert_metier"]);
  for (const u of [consultantEquipe, consultant2, expertMetier]) {
    attendre(
      201,
      await a.chef.post(`/api/missions/${missionId}/equipe`, { utilisateur_id: u.utilisateurId }),
      "équipe",
    );
  }
  const memeClient = await planAvecInitiative(a, mission2Id);
  const autreClient = await planAvecInitiative(a, missionAutreClient);
  return {
    a,
    b,
    missionId,
    mission2Id,
    missionAutreClient,
    autreClientId,
    missionB,
    consultantEquipe,
    consultant2,
    expertMetier,
    consultantHors: await a.avecRoles(["consultant"]),
    gestionnaire: await a.avecRoles(["gestionnaire"]),
    expertExterne: await a.avecRoles(["expert_externe"]),
    ressources: await a.avecRoles(["ressources"]),
    initiativeMemeClient: memeClient.initiative,
    axeMemeClient: memeClient.axe,
    kpiMemeClient: await creerKpiDe(a, mission2Id),
    initiativeAutreClient: autreClient.initiative,
    kpiAutreClient: await creerKpiDe(a, missionAutreClient),
  };
}

/* ----- SQL direct (propriétaire : RLS contournée, déclencheurs actifs) ----- */

export async function sql(texte: string, params: unknown[] = []): Promise<any[]> {
  return proprietaire(async (c) => (await c.query(texte, params)).rows);
}

/** INSERT générique : `valeurs` en colonnes ; les jsonb passent par JSON.stringify. */
export async function inserer(table: string, valeurs: Record<string, unknown>): Promise<any> {
  const cles = Object.keys(valeurs);
  const marques = cles.map((_, i) => `$${i + 1}`).join(", ");
  const colonnes = cles.map((c) => (c === "analyse" ? '"analyse"' : c)).join(", ");
  const r = await proprietaire((c) =>
    c.query(
      `INSERT INTO ${table} (${colonnes}) VALUES (${marques}) RETURNING *`,
      Object.values(valeurs),
    ),
  );
  return r.rows[0];
}

export const json = (v: unknown) => JSON.stringify(v);

/** Valeurs d'une version d'élément d'un type donné (état complet). */
export function colonnesVersion(type: string, extra: Record<string, unknown> = {}) {
  const base: Record<string, Record<string, unknown>> = {
    point_analyse: { categorie: "politique", libelle: "Stabilité politique" },
    etape_chaine: { libelle: "Production", ordre: 1, part_cout_bp: 5000, part_marge_bp: 3000 },
    risque: { libelle: "Risque de change", categorie: "change", niveau: "eleve" },
    hypothese: { libelle: "Le marché croît de 8 % par an", critere: "Croissance observée" },
    action_100j: {
      libelle: "Nommer le directeur",
      jour_debut: 0,
      jour_fin: 10,
      statut_action: "a_faire",
    },
  };
  return { ...base[type], ...extra };
}

export interface DonneesDd {
  dossierId: string;
  clientId: string;
  cadrageId: string;
  signalId: string;
  signalVersionId: string;
  pointId: string;
  pointAssertionId: string;
  etapeId: string;
  risqueId: string;
  risqueAssertionId: string;
  hypotheseId: string;
  hypotheseAssertionId: string;
  actionId: string;
  constatId: string;
  lienId: string;
  verdictId: string;
  validationId: string;
  dimId: string;
  dimVersionId: string;
  preuveId: string;
  listeId: string;
  listeVersionId: string;
  filtrageId: string;
  decisionId: string;
  ajustementId: string;
  noteId: string;
  noteBrouillonId: string;
  noteSoumiseId: string;
  noteValidationId: string;
}

export const BASE_FIGEE_OK = {
  version_base: 1,
  genere_le: "2026-10-12",
  bloquants: [],
  avertissements: [],
  exclusions_bloquantes: 0,
};

/**
 * Une ligne dans chacune des vingt tables `dd_*` du cabinet A (écriture SQL propriétaire :
 * déclencheurs actifs). Acteurs : hypothèse créée par `consultant2`, assertions et verdict de
 * `consultantEquipe`, validations de `expertMetier`.
 */
export async function peuplerDd(s: ScenarioDd, missionId = s.missionId): Promise<DonneesDd> {
  const cab = s.a.cabinetId;
  const A = s.consultantEquipe.utilisateurId;
  const B = s.consultant2.utilisateurId;
  const E = s.expertMetier.utilisateurId;

  const dossier = await inserer("dd_dossiers", {
    cabinet_id: cab,
    mission_id: missionId,
    client_id: s.a.clientId,
    cree_par: A,
  });
  const cadrage = await inserer("dd_cadrage_versions", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    version: 1,
    titre: "Entrée sur le marché ivoirien",
    secteur_code: "cacao",
    pays_code: "ci",
    type_operation: "entree_marche",
    devise: "XOF",
    cree_par: A,
  });
  const signal = await inserer("dd_signaux", {
    cabinet_id: cab,
    code: `sig-${dossier.numero}`,
    cree_par: E,
  });
  const signalVersion = await inserer("dd_signal_versions", {
    cabinet_id: cab,
    signal_id: signal.id,
    version: 1,
    libelle: "Contrôle des changes",
    famille: "change",
    gravite_indicative: "eleve",
    cree_par: E,
  });

  const a1 = (await creerAssertion(s.consultantEquipe, missionId)).id as string;
  const a2 = (await creerAssertion(s.consultant2, missionId)).id as string;
  const a3 = (await creerAssertion(s.consultantEquipe, missionId)).id as string;

  const point = await inserer("dd_elements", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    type: "point_analyse",
    analyse: "pestel",
    assertion_id: a1,
    cree_par: A,
  });
  await inserer("dd_element_versions", {
    cabinet_id: cab,
    element_id: point.id,
    type: "point_analyse",
    version: 1,
    auteur_id: A,
    ...colonnesVersion("point_analyse"),
  });
  const etape = await inserer("dd_elements", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    type: "etape_chaine",
    cree_par: A,
  });
  await inserer("dd_element_versions", {
    cabinet_id: cab,
    element_id: etape.id,
    type: "etape_chaine",
    version: 1,
    auteur_id: A,
    ...colonnesVersion("etape_chaine"),
  });
  const risque = await inserer("dd_elements", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    type: "risque",
    assertion_id: a2,
    cree_par: B,
  });
  await inserer("dd_element_versions", {
    cabinet_id: cab,
    element_id: risque.id,
    type: "risque",
    version: 1,
    auteur_id: B,
    etape_id: etape.id,
    signal_id: signal.id,
    ...colonnesVersion("risque"),
  });
  const hypothese = await inserer("dd_elements", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    type: "hypothese",
    cree_par: B,
  });
  await inserer("dd_element_versions", {
    cabinet_id: cab,
    element_id: hypothese.id,
    type: "hypothese",
    version: 1,
    auteur_id: B,
    ...colonnesVersion("hypothese"),
  });
  const action = await inserer("dd_elements", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    type: "action_100j",
    cree_par: A,
  });
  await inserer("dd_element_versions", {
    cabinet_id: cab,
    element_id: action.id,
    type: "action_100j",
    version: 1,
    auteur_id: A,
    responsable_id: A,
    ...colonnesVersion("action_100j"),
  });
  const constat = await inserer("dd_signal_constats", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    signal_id: signal.id,
    signal_version: 1,
    etat: "constate",
    risque_element_id: risque.id,
    cree_par: A,
  });

  const lien = await inserer("dd_hypothese_liens", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    hypothese_id: hypothese.id,
    assertion_id: a3,
    action: "lier",
    sens: "soutient",
    cree_par: A,
  });
  const verdict = await inserer("dd_verdicts", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    hypothese_id: hypothese.id,
    hypothese_version: 1,
    verdict: "confirmee",
    indication_moteur: "confirmee",
    motif: "Les sources soutiennent l'hypothèse.",
    assertions_citees: json([
      {
        assertion_id: a3,
        version: 1,
        sens: "soutient",
        indice_num: 1,
        indice_den: 1,
        lecture: "solide",
      },
    ]),
    proposee_par: A,
  });
  const validation = await inserer("dd_verdict_validations", {
    cabinet_id: cab,
    verdict_id: verdict.id,
    decision: "valide",
    valide_par: E,
  });

  const preuveId = (await creerPreuve(s.a.chef, missionId)).id as string;
  const dim = await inserer("dd_dimensionnements", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    methode: "ascendant",
    cree_par: A,
  });
  const dimVersion = await inserer("dd_dimensionnement_versions", {
    cabinet_id: cab,
    dimensionnement_id: dim.id,
    version: 1,
    libelle: "Marché atteignable",
    parametres: json([
      {
        code: "clients_cibles",
        unite: "nombre",
        bas: 1,
        base: 2,
        haut: 3,
        source: { type: "preuve", preuve_id: preuveId },
      },
      {
        code: "taux_conquete",
        unite: "pourcentage_bp",
        bas: 1,
        base: 2,
        haut: 3,
        source: { type: "avis_expert", motif: "Estimation de l'expert du secteur." },
      },
    ]),
    resultat: json({ resultat: { bas: 0, base: 0, haut: 0 } }),
    auteur_id: A,
  });

  const liste = await inserer("dd_exclusion_listes", {
    cabinet_id: cab,
    nom: `Liste générale ${dossier.numero}`,
    cree_par: E,
  });
  const listeVersion = await inserer("dd_exclusion_liste_versions", {
    cabinet_id: cab,
    liste_id: liste.id,
    version: 1,
    regles: json([
      {
        code: "r1",
        libelle: "Jeux d'argent",
        mots_cles: ["casino"],
        secteur_codes: [],
        pays_codes: [],
      },
    ]),
    cree_par: E,
  });
  const filtrage = await inserer("dd_filtrages", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    liste_version_id: listeVersion.id,
    declarations: json({ activites: ["Casino"], secteur_codes: [], pays_codes: [] }),
    themes: json([]),
    resultat: json({
      touches: [{ regle: "r1", criteres: ["mot_cle"], mots_trouves: ["casino"] }],
      non_touchees: 0,
    }),
    auteur_id: A,
  });
  const decision = await inserer("dd_filtrage_decisions", {
    cabinet_id: cab,
    filtrage_id: filtrage.id,
    regle_code: "r1",
    decision: "ecartee",
    motif: "Faux positif : activité de loisirs sans mise.",
    decideur_id: E,
  });
  const ajustement = await inserer("dd_ajustements", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    cible_type: "verdict",
    cible_id: verdict.id,
    champ: "verdict",
    valeur_avant: "non_concluante",
    valeur_apres: "confirmee",
    motif: "Avis de l'expert : sources concordantes.",
    auteur_id: A,
  });

  const note = await inserer("dd_notes", {
    cabinet_id: cab,
    dossier_id: dossier.id,
    titre: "Note au comité d'investissement",
    cree_par: A,
  });
  const brouillon = await inserer("dd_note_versions", {
    cabinet_id: cab,
    note_id: note.id,
    version: 1,
    etat: "brouillon",
    recommandation: "reservee",
    synthese: "Synthèse provisoire.",
    cree_par: A,
  });
  const soumise = await inserer("dd_note_versions", {
    cabinet_id: cab,
    note_id: note.id,
    version: 2,
    etat: "soumise",
    recommandation: "favorable_sous_conditions",
    synthese: "Synthèse soumise au comité.",
    conditions: ["Obtenir la licence d'exploitation."],
    base_figee: json(BASE_FIGEE_OK),
    soumise_le: new Date().toISOString(),
    motif: "Soumission au comité.",
    cree_par: A,
  });
  const noteValidation = await inserer("dd_note_validations", {
    cabinet_id: cab,
    note_version_id: soumise.id,
    decision: "valide",
    valide_par: E,
  });

  return {
    dossierId: dossier.id,
    clientId: s.a.clientId,
    cadrageId: cadrage.id,
    signalId: signal.id,
    signalVersionId: signalVersion.id,
    pointId: point.id,
    pointAssertionId: a1,
    etapeId: etape.id,
    risqueId: risque.id,
    risqueAssertionId: a2,
    hypotheseId: hypothese.id,
    hypotheseAssertionId: a3,
    actionId: action.id,
    constatId: constat.id,
    lienId: lien.id,
    verdictId: verdict.id,
    validationId: validation.id,
    dimId: dim.id,
    dimVersionId: dimVersion.id,
    preuveId,
    listeId: liste.id,
    listeVersionId: listeVersion.id,
    filtrageId: filtrage.id,
    decisionId: decision.id,
    ajustementId: ajustement.id,
    noteId: note.id,
    noteBrouillonId: brouillon.id,
    noteSoumiseId: soumise.id,
    noteValidationId: noteValidation.id,
  };
}

/* ----- Appels d'API ----- */

export const CADRAGE = {
  titre: "Entrée sur le marché ivoirien du cacao",
  secteur_code: "citi_a",
  filiere_code: "cacao",
  pays_code: "ci",
  cible_nom: null,
  type_operation: "entree_marche",
  devise: "XOF",
  date_operation: "2026-03-01",
  question_investissement: "Faut-il entrer sur le marché ivoirien ?",
  perimetre: "Transformation et export du cacao.",
} as const;

export const AFFIRMATION = {
  enonce: "La stabilité politique soutient l'investissement.",
  classe_risque: "R2",
} as const;

export async function creerDossierDd(
  par: Api,
  missionId: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  return attendu(
    201,
    await par.post(`/api/missions/${missionId}/dd/dossiers`, { ...CADRAGE, ...extra }),
  );
}

export async function creerPointDd(
  par: Api,
  dossierId: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; assertion_id: string; version: number }> {
  return attendu(
    201,
    await par.post(`/api/dd/dossiers/${dossierId}/points`, {
      analyse: "pestel",
      categorie: "politique",
      ...AFFIRMATION,
      ...extra,
    }),
  );
}

export async function creerEtapeDd(
  par: Api,
  dossierId: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  return attendu(
    201,
    await par.post(`/api/dd/dossiers/${dossierId}/chaine/etapes`, {
      libelle: "Production",
      ordre: 1,
      part_cout_bp: 3000,
      part_marge_bp: 500,
      acteurs: ["Planteurs"],
      ...extra,
    }),
  );
}

export async function creerRisqueDd(
  par: Api,
  dossierId: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; assertion_id: string; version: number }> {
  return attendu(
    201,
    await par.post(`/api/dd/dossiers/${dossierId}/risques`, {
      famille: "change",
      niveau: "eleve",
      libelle: "Risque de change",
      ...AFFIRMATION,
      enonce: "Le franc CFA est arrimé à l'euro mais les flux en dollars restent exposés.",
      ...extra,
    }),
  );
}

export async function creerHypotheseDd(
  par: Api,
  dossierId: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  return attendu(
    201,
    await par.post(`/api/dd/dossiers/${dossierId}/hypotheses`, {
      libelle: "Le marché croît de 8 % par an",
      critere: "Croissance observée sur trois ans",
      ...extra,
    }),
  );
}

/** Assertion rattachée à une hypothèse (route R20), sens « soutient » par défaut. */
export async function assertionHypotheseDd(
  par: Api,
  hypotheseId: string,
  extra: Record<string, unknown> = {},
): Promise<{ assertion_id: string; version: number }> {
  return attendu(
    201,
    await par.post(`/api/dd/hypotheses/${hypotheseId}/assertions`, {
      sens: "soutient",
      ...AFFIRMATION,
      enonce: "Les volumes exportés ont progressé de 8 % par an.",
      ...extra,
    }),
  );
}

const PREUVE_A = {
  type_source: "document",
  source_precise: "Rapport annuel de la filière, page 14",
  date_preuve: "2026-09-30",
  fiabilite: "A",
  extrait: "Les volumes exportés progressent chaque année.",
} as const;
const PREUVE_B = {
  type_source: "entretien",
  source_precise: "Entretien avec un exportateur, 12 octobre",
  date_preuve: "2026-10-12",
  fiabilite: "B",
  extrait: "Le marché est porteur depuis trois ans.",
} as const;

/** Source une assertion : « solide » = document A + entretien B ; « etayee » = document A seul. */
export async function sourcer(
  par: Api,
  missionId: string,
  assertionId: string,
  niveau: "solide" | "etayee",
  sens: "pour" | "contre" = "pour",
): Promise<void> {
  const document = await creerPreuve(par, missionId, PREUVE_A);
  attendu(
    201,
    await par.post(`/api/assertions/${assertionId}/liens`, { preuve_id: document.id, sens }),
  );
  if (niveau === "solide") {
    const entretien = await creerPreuve(par, missionId, PREUVE_B);
    attendu(
      201,
      await par.post(`/api/assertions/${assertionId}/liens`, { preuve_id: entretien.id, sens }),
    );
  }
}

/** Dimensionnement ascendant de la spécification (cas A1 du §5.2). */
export const PARAMETRES_A1 = (preuveId: string) => [
  {
    code: "clients_cibles",
    bas: 1500,
    base: 2000,
    haut: 2500,
    source: { type: "preuve", preuve_id: preuveId },
  },
  {
    code: "taux_conquete",
    bas: 1500,
    base: 2000,
    haut: 2500,
    source: { type: "avis_expert", motif: "Estimation de l'expert du secteur." },
  },
  {
    code: "volume_par_client",
    bas: 10,
    base: 12,
    haut: 14,
    source: { type: "avis_expert", motif: "Estimation de l'expert du secteur." },
  },
  {
    code: "prix_unitaire",
    bas: 200000,
    base: 250000,
    haut: 300000,
    source: { type: "avis_expert", motif: "Estimation de l'expert du secteur." },
  },
];

/** Dimensionnement descendant de la spécification (cas D1 du §5.2). */
export const PARAMETRES_D1 = (preuveId: string) => [
  {
    code: "marche_total",
    bas: 80_000_000_000,
    base: 100_000_000_000,
    haut: 120_000_000_000,
    source: { type: "preuve", preuve_id: preuveId },
  },
  {
    code: "part_segment",
    bas: 3000,
    base: 4000,
    haut: 5000,
    source: { type: "avis_expert", motif: "Estimation de l'expert du secteur." },
  },
  {
    code: "part_adressable",
    bas: 4000,
    base: 5000,
    haut: 6000,
    source: { type: "avis_expert", motif: "Estimation de l'expert du secteur." },
  },
  {
    code: "part_capturable",
    bas: 800,
    base: 1000,
    haut: 1200,
    source: { type: "avis_expert", motif: "Estimation de l'expert du secteur." },
  },
];

/** Passe une mission à « clôturée » (le propriétaire de la base : la clôture elle-même est un autre lot). */
export async function cloturerMission(s: ScenarioDd, missionId: string): Promise<void> {
  await proprietaire((c) =>
    c.query(
      `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), cloturee_par = $2 WHERE id = $1`,
      [missionId, s.a.associeId],
    ),
  );
}

/** Mission neuve du cabinet A dont l'équipe compte les trois utilisateurs du scénario (dossiers à volonté). */
export async function missionDd(s: ScenarioDd): Promise<string> {
  const m = (await creerMission(s.a)).id;
  for (const u of [s.consultantEquipe, s.consultant2, s.expertMetier]) {
    await s.a.chef.post(`/api/missions/${m}/equipe`, { utilisateur_id: u.utilisateurId });
  }
  return m;
}

/**
 * Dossier soumissible : une hypothèse à deux assertions solides, verdict « confirmée » proposé par
 * consultantEquipe et validé par l'expert métier.
 */
export async function dossierPret(
  s: ScenarioDd,
): Promise<{ missionId: string; dossierId: string; hypotheseId: string }> {
  const missionId = await missionDd(s);
  const dossierId = (await creerDossierDd(s.consultantEquipe, missionId)).id;
  const h = await creerHypotheseDd(s.consultantEquipe, dossierId);
  const assertions: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const a = await assertionHypotheseDd(s.consultantEquipe, h.id, {
      enonce: `Source ${i} de l'hypothèse.`,
    });
    await sourcer(s.consultantEquipe, missionId, a.assertion_id, "solide");
    assertions.push(a.assertion_id);
  }
  const v = attendu(
    201,
    await s.consultantEquipe.post(`/api/dd/hypotheses/${h.id}/verdicts`, {
      hypothese_version: 1,
      verdict: "confirmee",
      motif: "Sources solides et concordantes.",
      assertions_citees: assertions,
    }),
  );
  attendu(
    201,
    await s.expertMetier.post(`/api/dd/verdicts/${v.id}/validation`, { decision: "valide" }),
  );
  return { missionId, dossierId, hypotheseId: h.id };
}
