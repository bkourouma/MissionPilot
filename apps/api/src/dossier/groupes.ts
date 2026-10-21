import {
  BASE_POINTS_DETENTION,
  consoliderGroupe,
  controlerNouvelleDetention,
  DEVISES_GROUPE,
  ErreurDossier,
  participationsEnVigueur,
  PROFONDEUR_GROUPE_MAX,
  SEUIL_CONTROLE_POINTS,
  structureDepuisTete,
  structureGroupe,
  type ConsolidationGroupe,
  type EntiteGroupe,
  type LienDetention,
  type MontantsEntiteGroupe,
  type NoeudGroupe,
} from "@missionpilot/engines";
import {
  INDICATEUR_GROUPE_LIBELLES,
  MOTIF_EXCLUSION_GROUPE_LIBELLES,
  PARTICIPATIONS_PAR_CABINET_MAX,
  type GroupeQuery,
  type MotifExclusionGroupe,
  type ParticipationCreation,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { aujourdhui, filtreDossierVisible, voitTousLesDossiers } from "./acces.js";

/*
 * Groupes et filiales (DOS-05, PRD complémentaire §5) : structure de détention et
 * consolidation SIMPLE des indicateurs. L'API ne calcule RIEN : elle charge l'historique
 * (table en ajout seul `dossier_participations`, migration 0225), appelle le moteur pur
 * `packages/engines/src/dossier/groupe.ts` et met en forme.
 *
 * Confidentialité : un client dont le dossier n'est pas visible de l'appelant
 * (`dossier/acces.ts`) n'apparaît que comme noeud ANONYME (niveau et part cumulée, sans
 * identifiant ni nom) et est exclu de la consolidation (NON_VISIBLE) : aucune de ses
 * données n'est même lue. Aucune donnée FIN-02 du cabinet (honoraires, coûts, taux, marges
 * de missions) n'entre dans la réponse : seules les données du client (états financiers
 * acceptés, indice de fiabilité) y figurent, avec ou sans `finance.lire`.
 *
 * Périmètre de la consolidation : la racine de la vue (le client demandé en vue « client », la
 * société de tête en vue « tete ») et ses filiales, parts cumulées depuis cette racine.
 * Exercice par défaut : le plus récent exercice ayant un état accepté chez le client demandé
 * (à défaut, chez la racine) ; sans état accepté, consolidation vide et partielle.
 */

export const AVERTISSEMENT_GROUPE = "Lecture indicative, pas une consolidation comptable légale";

export const REGLES_GROUPE = {
  seuil_controle_points: SEUIL_CONTROLE_POINTS,
  base_points: BASE_POINTS_DETENTION,
  profondeur_max: PROFONDEUR_GROUPE_MAX,
  ponderation_fiabilite: "part_cumulee",
  conversion_devise: true,
  textes: [
    "Consolidation intégrale : somme à 100 % des entités dont la part cumulée dépasse 50 % (la racine compte pour 100 %).",
    "Consolidation proportionnelle : somme des montants pondérés par la part cumulée de chaque entité.",
    "Fiabilité : moyenne des indices pondérée par la part cumulée.",
    "Devises : la devise du groupe est celle de la racine ; une entité en XOF, XAF ou EUR est convertie à la parité fixe (1 EUR = 655,957 XOF = 655,957 XAF ; XOF = XAF). Une entité en USD, sans taux validé, est exclue.",
    "Seuls les états financiers acceptés (courants) de l'exercice sont retenus.",
  ],
} as const;

const horodatage = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/** Historique de détention du cabinet (RLS), du plus ancien au plus récent ; borné. */
export async function lireHistorique(db: Db): Promise<LienDetention[]> {
  const r = await db.query(
    `SELECT detenteur_id, filiale_id, points_base, date_effet::text AS date_effet, cree_le
     FROM dossier_participations ORDER BY cree_le, ordre LIMIT $1`,
    [PARTICIPATIONS_PAR_CABINET_MAX],
  );
  return r.rows.map((p) => ({
    detenteur: p.detenteur_id as string,
    filiale: p.filiale_id as string,
    pointsBase: p.points_base as number,
    dateEffet: p.date_effet as string,
    creeLe: horodatage(p.cree_le),
  }));
}

/** Verrou consultatif du cabinet : même clé que le déclencheur de la migration 0225. */
async function verrouillerGroupes(db: Db, cabinetId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`groupes:${cabinetId}`]);
}

/**
 * Ajoute une participation (les deux dossiers sont déjà reconnus visibles par l'appelant).
 * Le moteur contrôle AVANT l'insertion ; la base double les règles (MQF01 à MQF04).
 */
export async function ajouterParticipation(
  db: Db,
  auth: Auth,
  p: ParticipationCreation,
): Promise<string> {
  await verrouillerGroupes(db, auth.cabinetId);
  const n = await db.query("SELECT count(*)::int AS n FROM dossier_participations");
  if ((n.rows[0].n as number) >= PARTICIPATIONS_PAR_CABINET_MAX) {
    throw new AppError(
      409,
      "GROUPES_PLEIN",
      `Au plus ${PARTICIPATIONS_PAR_CABINET_MAX} enregistrements de détention par cabinet.`,
    );
  }
  const liens = await lireHistorique(db);
  try {
    controlerNouvelleDetention(liens, {
      detenteur: p.detenteur_id,
      filiale: p.filiale_id,
      pointsBase: p.points_base,
      dateEffet: p.date_effet,
    });
  } catch (e) {
    // Le message du moteur cite le chemin du cycle : il pourrait nommer un dossier invisible.
    if (e instanceof ErreurDossier && e.code === "DETENTION_CYCLE") {
      throw new ErreurDossier(e.code, "Cette détention créerait un cycle de détention.");
    }
    throw e;
  }
  const r = await db.query(
    `INSERT INTO dossier_participations (cabinet_id, detenteur_id, filiale_id, points_base,
       date_effet, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      p.detenteur_id,
      p.filiale_id,
      p.points_base,
      p.date_effet,
      p.motif ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "dossier_participation",
    entiteId: id,
    details: {
      detenteur_id: p.detenteur_id,
      filiale_id: p.filiale_id,
      points_base: p.points_base,
      date_effet: p.date_effet,
      fin_de_detention: p.points_base === 0,
    },
  });
  return id;
}

/** Noms des seuls clients dont le dossier est visible de l'appelant. */
async function clientsVisibles(
  db: Db,
  auth: Auth,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    `SELECT c.id, c.raison_sociale FROM clients c
     WHERE c.id = ANY($1::uuid[]) AND ${filtreDossierVisible(2, 3)}`,
    [[...ids], voitTousLesDossiers(auth), auth.utilisateurId],
  );
  return new Map(r.rows.map((c) => [c.id as string, c.raison_sociale as string]));
}

type Partie = { visible: true; id: string; nom: string } | { visible: false };

/** Historique complet (ajout seul) des enregistrements où le client est détenteur ou filiale. */
export async function historiqueParticipations(db: Db, auth: Auth, clientId: string) {
  const r = await db.query(
    `SELECT p.id, p.detenteur_id, p.filiale_id, p.points_base, p.date_effet::text AS date_effet,
       p.motif, p.cree_le, p.cree_par, u.nom AS cree_par_nom
     FROM dossier_participations p JOIN utilisateurs u ON u.id = p.cree_par
     WHERE p.detenteur_id = $1 OR p.filiale_id = $1
     ORDER BY p.cree_le DESC, p.ordre DESC LIMIT $2`,
    [clientId, PARTICIPATIONS_PAR_CABINET_MAX],
  );
  const ids = new Set<string>();
  for (const p of r.rows) {
    ids.add(p.detenteur_id as string);
    ids.add(p.filiale_id as string);
  }
  const noms = await clientsVisibles(db, auth, [...ids]);
  const partie = (id: string): Partie => {
    const nom = noms.get(id);
    return nom === undefined ? { visible: false } : { visible: true, id, nom };
  };
  return r.rows.map((p) => ({
    id: p.id as string,
    detenteur: partie(p.detenteur_id as string),
    filiale: partie(p.filiale_id as string),
    points_base: p.points_base as number,
    date_effet: p.date_effet as string,
    fin_de_detention: p.points_base === 0,
    motif: (p.motif as string | null) ?? null,
    cree_par: { id: p.cree_par as string, nom: p.cree_par_nom as string },
    cree_le: horodatage(p.cree_le),
  }));
}

const nombreOuNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : null;

interface EtatGroupe {
  exercice: number;
  devise: string;
  montants: MontantsEntiteGroupe;
}

/**
 * État COURANT ACCEPTÉ de chaque client : ni remplacé ni rejeté, décision `accepte`. Celui de
 * l'exercice demandé s'il existe, sinon le plus récent (le moteur le signale alors
 * EXERCICE_DIFFERENT).
 */
async function etatsAcceptes(
  db: Db,
  ids: readonly string[],
  exercice: number | null,
): Promise<Map<string, EtatGroupe>> {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    `SELECT DISTINCT ON (e.client_id) e.client_id, e.exercice, e.devise, e.totaux
     FROM dossier_etats_financiers e
     JOIN dossier_etats_decisions d ON d.etat_id = e.id AND d.decision = 'accepte'
     WHERE e.client_id = ANY($1::uuid[])
       AND NOT EXISTS (SELECT 1 FROM dossier_etats_financiers r WHERE r.remplace_id = e.id)
     ORDER BY e.client_id, (e.exercice = $2::int) DESC, e.exercice DESC, e.cree_le DESC`,
    [[...ids], exercice],
  );
  return new Map(
    r.rows.map((e) => {
      const t = (e.totaux ?? {}) as Record<string, unknown>;
      return [
        e.client_id as string,
        {
          exercice: e.exercice as number,
          devise: e.devise as string,
          montants: {
            actif: nombreOuNull(t.actif),
            passif: nombreOuNull(t.passif),
            charges: nombreOuNull(t.charges),
            produits: nombreOuNull(t.produits),
            resultat: nombreOuNull(t.resultat),
          },
        },
      ];
    }),
  );
}

/** Dernier indice de fiabilité (points) de chaque client. */
async function fiabilites(db: Db, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    `SELECT DISTINCT ON (client_id) client_id, points FROM dossier_indices_fiabilite
     WHERE client_id = ANY($1::uuid[]) ORDER BY client_id, cree_le DESC, id DESC`,
    [[...ids]],
  );
  return new Map(r.rows.map((f) => [f.client_id as string, f.points as number]));
}

interface NoeudVu {
  visible: boolean;
  id?: string;
  nom?: string;
  niveau: number;
  part_directe_bps?: number | null;
  part_cumulee_bps: number;
}

/** Noeud visible (identifiant, nom) ou anonyme (niveau et part cumulée seulement). */
function noeudVu(n: NoeudGroupe, noms: ReadonlyMap<string, string>, avecDirecte = true): NoeudVu {
  const nom = noms.get(n.client);
  if (nom === undefined) {
    return { visible: false, niveau: n.niveau, part_cumulee_bps: n.partCumuleeBps };
  }
  return {
    visible: true,
    id: n.client,
    nom,
    niveau: n.niveau,
    ...(avecDirecte ? { part_directe_bps: n.partDirecteBps } : {}),
    part_cumulee_bps: n.partCumuleeBps,
  };
}

const indicateurs = (i: ConsolidationGroupe["integrale"]) => ({
  actif: i.actif,
  passif: i.passif,
  charges: i.charges,
  produits: i.produits,
  resultat: i.resultat,
  marge_nette_bps: i.margeNetteBps,
});

interface ExclusVue {
  id?: string;
  nom?: string;
  motif: MotifExclusionGroupe;
  motif_libelle: string;
}

/** Exclusion : un client non visible reste anonyme (ni identifiant ni nom). */
function exclusVue(
  client: string,
  motif: MotifExclusionGroupe,
  noms: ReadonlyMap<string, string>,
): ExclusVue {
  const nom = noms.get(client);
  return {
    ...(nom === undefined ? {} : { id: client, nom }),
    motif,
    motif_libelle: MOTIF_EXCLUSION_GROUPE_LIBELLES[motif],
  };
}

interface ConsolidationVue {
  devise: string | null;
  exercice: number | null;
  partielle: boolean;
  conversions: { id: string; nom: string; de: string; vers: string }[];
  perimetre: {
    inclus: { id: string; nom: string; part_cumulee_bps: number; controlee: boolean }[];
    exclus: ExclusVue[];
  };
  integrale: ReturnType<typeof indicateurs>;
  proportionnelle: ReturnType<typeof indicateurs>;
  fiabilite: { moyenne_ponderee: number | null; ponderation: "part_cumulee" };
}

function consolidationVue(
  c: ConsolidationGroupe,
  noms: ReadonlyMap<string, string>,
): ConsolidationVue {
  return {
    devise: c.devise,
    exercice: c.exercice,
    partielle: c.partielle,
    conversions: c.conversions.map((v) => ({
      id: v.client,
      nom: noms.get(v.client) ?? "",
      de: v.de,
      vers: v.vers,
    })),
    perimetre: {
      inclus: c.perimetre.inclus.map((e) => ({
        id: e.client,
        nom: noms.get(e.client) ?? "",
        part_cumulee_bps: e.partCumuleeBps,
        controlee: e.controlee,
      })),
      exclus: c.perimetre.exclus.map((e) => exclusVue(e.client, e.motif, noms)),
    },
    integrale: indicateurs(c.integrale),
    proportionnelle: indicateurs(c.proportionnelle),
    fiabilite: { moyenne_ponderee: c.fiabilite.moyennePonderee, ponderation: c.fiabilite.poids },
  };
}

/** Consolidation vide : aucun état accepté de référence, tout le périmètre est signalé exclu. */
function consolidationVide(
  exercice: number | null,
  clients: readonly string[],
  noms: ReadonlyMap<string, string>,
): ConsolidationVue {
  const vide = {
    actif: null,
    passif: null,
    charges: null,
    produits: null,
    resultat: null,
    marge_nette_bps: null,
  };
  return {
    devise: null,
    exercice,
    partielle: true,
    conversions: [],
    perimetre: {
      inclus: [],
      exclus: clients.map((c) => exclusVue(c, noms.has(c) ? "ETAT_ABSENT" : "NON_VISIBLE", noms)),
    },
    integrale: vide,
    proportionnelle: vide,
    fiabilite: { moyenne_ponderee: null, ponderation: "part_cumulee" },
  };
}

/** Structure et consolidation du groupe d'un client (dossier déjà reconnu visible). */
export async function lireGroupe(db: Db, auth: Auth, clientId: string, q: GroupeQuery) {
  const date = q.date ?? aujourdhui();
  const liens = await lireHistorique(db);
  const structure = structureGroupe(liens, clientId, date);
  const arbre = q.vue === "tete" ? structureDepuisTete(liens, structure.tete, date) : null;
  const racine = arbre ? structure.tete : clientId;
  const filialesConsolidees = (arbre ?? structure).filiales;

  const ids = new Set<string>([clientId, structure.tete, racine]);
  for (const n of [...structure.detenteurs, ...structure.filiales, ...(arbre?.filiales ?? [])]) {
    ids.add(n.client);
  }
  const noms = await clientsVisibles(db, auth, [...ids]);

  // Exercice du groupe : état accepté du client demandé, sinon de la racine. Devise du groupe :
  // celle de l'état de la RACINE à cet exercice (les autres sont converties par le moteur),
  // à défaut celle de l'état de référence.
  let exercice = q.exercice ?? null;
  let devise: string | null = null;
  for (const reference of new Set([clientId, racine])) {
    if (!noms.has(reference)) continue;
    const etat = (await etatsAcceptes(db, [reference], exercice)).get(reference);
    if (!etat || (exercice !== null && etat.exercice !== exercice)) continue;
    exercice = etat.exercice;
    devise = etat.devise;
    break;
  }
  if (exercice !== null && noms.has(racine)) {
    const etatRacine = (await etatsAcceptes(db, [racine], exercice)).get(racine);
    if (etatRacine && etatRacine.exercice === exercice) devise = etatRacine.devise;
  }

  const noeuds = [
    { client: racine, partCumuleeBps: BASE_POINTS_DETENTION },
    ...filialesConsolidees.map((n) => ({ client: n.client, partCumuleeBps: n.partCumuleeBps })),
  ];
  let consolidation: ConsolidationVue;
  if (
    devise !== null &&
    exercice !== null &&
    (DEVISES_GROUPE as readonly string[]).includes(devise)
  ) {
    const gardeDevise = devise;
    const gardeExercice = exercice;
    const aCharger = noeuds.map((n) => n.client).filter((i) => noms.has(i));
    const etats = await etatsAcceptes(db, aCharger, gardeExercice);
    const fiab = await fiabilites(db, aCharger);
    const entites: EntiteGroupe[] = noeuds.flatMap((n): EntiteGroupe[] => {
      if (!noms.has(n.client)) {
        // Non visible : aucune donnée n'est lue, le moteur l'exclut (NON_VISIBLE).
        return [
          {
            client: n.client,
            devise: gardeDevise,
            exercice: gardeExercice,
            montants: { actif: null, passif: null, charges: null, produits: null, resultat: null },
            fiabilitePoints: null,
            visible: false,
          },
        ];
      }
      const e = etats.get(n.client);
      if (!e) return [];
      return [
        {
          client: n.client,
          devise: e.devise,
          exercice: e.exercice,
          montants: e.montants,
          fiabilitePoints: fiab.get(n.client) ?? null,
          visible: true,
        },
      ];
    });
    consolidation = consolidationVue(
      consoliderGroupe({ devise: gardeDevise, exercice: gardeExercice, noeuds, entites }),
      noms,
    );
  } else {
    consolidation = consolidationVide(
      exercice,
      noeuds.map((n) => n.client),
      noms,
    );
  }

  const racineNoeud = (client: string): NoeudGroupe => ({
    client,
    niveau: 0,
    partDirecteBps: null,
    partCumuleeBps: BASE_POINTS_DETENTION,
  });
  const detenteurTete = structure.detenteurs.find((n) => n.client === structure.tete);
  const liensVisibles = participationsEnVigueur(liens, date).filter(
    (l) =>
      ids.has(l.detenteur) && ids.has(l.filiale) && noms.has(l.detenteur) && noms.has(l.filiale),
  );
  return {
    date,
    vue: q.vue,
    exercice,
    client: { id: clientId, nom: noms.get(clientId) ?? "" },
    avertissement: AVERTISSEMENT_GROUPE,
    regles: REGLES_GROUPE,
    indicateurs: INDICATEUR_GROUPE_LIBELLES,
    structure: {
      racine: noeudVu(racineNoeud(clientId), noms, false),
      tete: detenteurTete
        ? noeudVu(detenteurTete, noms)
        : noeudVu(racineNoeud(structure.tete), noms, false),
      detenteurs: structure.detenteurs.map((n) => noeudVu(n, noms)),
      filiales: structure.filiales.map((n) => noeudVu(n, noms)),
      arbre_tete: arbre ? arbre.filiales.map((n) => noeudVu(n, noms)) : null,
      liens: liensVisibles.map((l) => ({
        detenteur_id: l.detenteur,
        filiale_id: l.filiale,
        points_base: l.pointsBase,
        date_effet: l.dateEffet,
      })),
    },
    consolidation,
  };
}
