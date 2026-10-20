import {
  filtrerExclusions,
  syntheseSocioEnvironnementale,
  touchesBloquantes,
  type DecisionExclusion,
  type NiveauEs,
  type RegleExclusion,
  type ThemeEsEntree,
  type ToucheExclusion,
} from "@missionpilot/engines";
import {
  PLAFONDS_DD,
  THEMES_ES,
  type filtrageCreationSchema,
  type filtrageDecisionSchema,
  type listeExclusionCreationSchema,
  type listeExclusionVersionSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import {
  estAssocieDd,
  exigerPlafondDd,
  exigerVersionCourante,
  exigerVersionsRestantes,
  verrouillerCabinet,
  type DossierLu,
} from "./acces.js";
import { chargerRegistre, lectureDe, type RegistreDossier } from "./registre.js";
import { vueSyntheseEs } from "./vues.js";

/*
 * Filtrage environnemental et social (DD-14, migration 0505, SPEC-3b §8.6, R35 à R41) : listes
 * d'exclusion du cabinet (générales ou d'un investisseur client), revue d'un dossier (déclarations,
 * huit thèmes, règles touchées par `filtrerExclusions`) et décisions d'un tiers sur chaque
 * exclusion touchée (séparation des tâches API et base, MPZ28). La synthèse E&S est RECALCULÉE à
 * chaque lecture, depuis le dernier filtrage et ses décisions (moteur). Cadres publics cités en
 * référence seulement : aucun texte d'un cadre n'est reproduit.
 */

export type CorpsListeCreation = z.infer<typeof listeExclusionCreationSchema>;
export type CorpsListeVersion = z.infer<typeof listeExclusionVersionSchema>;
export type CorpsFiltrage = z.infer<typeof filtrageCreationSchema>;
export type CorpsDecision = z.infer<typeof filtrageDecisionSchema>;

interface RegleStockee {
  code: string;
  libelle: string;
  mots_cles: string[];
  secteur_codes: string[];
  pays_codes: string[];
}

export interface ListeCourante {
  id: string;
  nom: string;
  cle_tri: string;
  client_id: string | null;
  cree_le: Date;
  version: number;
  version_id: string;
  regles: RegleStockee[];
  reference_cadre: string | null;
}

const COLONNES_LISTE = `l.id, l.nom, l.numero::text AS cle_tri, l.client_id, l.cree_le, v.version,
  v.id AS version_id, v.regles, v.reference_cadre`;
/** Page de listes : le NOMBRE de règles seulement (jamais le jsonb des règles, jusqu'à 200 Ko). */
const COLONNES_RESUME = `l.id, l.nom, l.numero::text AS cle_tri, l.client_id, l.cree_le, v.version,
  v.id AS version_id, jsonb_array_length(v.regles) AS nb_regles, v.reference_cadre`;

export interface ListeResume {
  id: string;
  nom: string;
  cle_tri: string;
  client_id: string | null;
  cree_le: Date;
  version: number;
  version_id: string;
  nb_regles: number;
  reference_cadre: string | null;
}

const DEPUIS_LISTE = `FROM dd_exclusion_listes l
  JOIN LATERAL (SELECT * FROM dd_exclusion_liste_versions lv WHERE lv.liste_id = l.id
                ORDER BY lv.version DESC LIMIT 1) v ON true`;

/** R35 : page de listes courantes, plus récentes d'abord (curseur sur le numéro). */
export async function listerListes(
  db: Db,
  q: { limite: number; clientId: string | null },
  apres: string | null,
): Promise<ListeResume[]> {
  const r = await db.query(
    `SELECT ${COLONNES_RESUME} ${DEPUIS_LISTE}
     WHERE ($1::bigint IS NULL OR l.numero < $1::bigint)
       AND ($2::uuid IS NULL OR l.client_id = $2::uuid)
     ORDER BY l.numero DESC LIMIT $3`,
    [apres, q.clientId, q.limite + 1],
  );
  return r.rows as ListeResume[];
}

export async function lireListe(db: Db, id: string): Promise<ListeCourante> {
  const r = await db.query(`SELECT ${COLONNES_LISTE} ${DEPUIS_LISTE} WHERE l.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Liste d'exclusion");
  return r.rows[0] as ListeCourante;
}

export function vueListe(
  l: Pick<ListeResume, "id" | "nom" | "client_id" | "version" | "nb_regles" | "reference_cadre">,
) {
  return {
    id: l.id,
    nom: l.nom,
    client_id: l.client_id,
    version: l.version,
    nb_regles: l.nb_regles,
    reference_cadre: l.reference_cadre,
  };
}

async function exigerClientConnu(db: Db, clientId: string): Promise<void> {
  const r = await db.query("SELECT 1 FROM clients WHERE id = $1", [clientId]);
  if (!r.rows[0]) {
    throw new AppError(400, "LIEN_INCOHERENT", "Le client désigné est inconnu.");
  }
}

async function insererVersionListe(
  db: Db,
  auth: Auth,
  listeId: string,
  version: number,
  regles: CorpsListeCreation["regles"],
  referenceCadre: string | null,
  motif: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO dd_exclusion_liste_versions (cabinet_id, liste_id, version, regles,
       reference_cadre, motif, cree_par)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      auth.cabinetId,
      listeId,
      version,
      JSON.stringify(regles),
      referenceCadre,
      motif,
      auth.utilisateurId,
    ],
  );
}

/** R36 : crée une liste (nom unique par cabinet, plafond de 50 sous le verrou du cabinet). */
export async function creerListe(
  db: Db,
  auth: Auth,
  c: CorpsListeCreation,
): Promise<{ id: string; version: 1 }> {
  await verrouillerCabinet(db, auth.cabinetId, "listes");
  const n = await db.query("SELECT count(*)::int AS n FROM dd_exclusion_listes");
  if ((n.rows[0].n as number) >= PLAFONDS_DD.listes_exclusion_par_cabinet) {
    throw new AppError(409, "PLAFOND_ATTEINT", "Trop de listes d'exclusion pour ce cabinet.");
  }
  if (c.client_id !== null) await exigerClientConnu(db, c.client_id);
  const r = await db.query(
    `INSERT INTO dd_exclusion_listes (cabinet_id, nom, client_id, cree_par)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [auth.cabinetId, c.nom, c.client_id, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersionListe(db, auth, id, 1, c.regles, c.reference_cadre, null);
  return { id, version: 1 };
}

/** R37 : nouvelle version d'une liste (la version lue est exigée). */
export async function corrigerListe(
  db: Db,
  auth: Auth,
  id: string,
  c: CorpsListeVersion,
): Promise<number> {
  await verrouillerCabinet(db, auth.cabinetId, "listes");
  const courante = await lireListe(db, id);
  exigerVersionCourante(c.version_courante, courante.version);
  exigerVersionsRestantes(courante.version + 1, PLAFONDS_DD.versions_par_objet);
  await insererVersionListe(
    db,
    auth,
    id,
    courante.version + 1,
    c.regles,
    c.reference_cadre,
    c.motif,
  );
  return courante.version + 1;
}

/**
 * R38 : versions d'une liste (règles comprises), plus récente d'abord, PAGINÉES (une version pèse
 * jusqu'à 200 Ko) : `apres` est le numéro de la dernière ligne servie.
 */
export async function versionsDeLaListe(db: Db, id: string, limite: number, apres: string | null) {
  const existe = await db.query("SELECT 1 FROM dd_exclusion_listes WHERE id = $1", [id]);
  if (!existe.rows[0]) throw introuvable("Liste d'exclusion");
  const r = await db.query(
    `SELECT v.id, v.numero::text AS cle_tri, v.version, v.regles, v.reference_cadre, v.motif,
       v.cree_par, u.nom AS cree_par_nom, v.cree_le
     FROM dd_exclusion_liste_versions v LEFT JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.liste_id = $1 AND ($2::bigint IS NULL OR v.numero < $2::bigint)
     ORDER BY v.numero DESC LIMIT $3`,
    [id, apres, limite + 1],
  );
  return r.rows as {
    id: string;
    cle_tri: string;
    version: number;
    regles: RegleStockee[];
    reference_cadre: string | null;
    motif: string | null;
    cree_par: string;
    cree_par_nom: string | null;
    cree_le: Date;
  }[];
}

interface FiltrageLigne {
  id: string;
  numero: string;
  liste_version_id: string;
  liste_id: string;
  liste_nom: string;
  liste_version: number;
  declarations: { activites: string[]; secteur_codes: string[]; pays_codes: string[] };
  themes: {
    code: string;
    niveau: NiveauEs;
    justification: string | null;
    assertion_id: string | null;
  }[];
  resultat: {
    touches: {
      regle: string;
      /** Libellé de la règle figé avec le résultat (aucune jointure sur les règles à la lecture). */
      libelle?: string;
      criteres: ToucheExclusion["criteres"];
      mots_trouves: string[];
    }[];
    non_touchees: number;
  };
  auteur_id: string;
  cree_le: Date;
}

export async function lireFiltrage(
  db: Db,
  id: string,
): Promise<FiltrageLigne & { dossier_id: string }> {
  const r = await db.query(`${REQUETE_FILTRAGES} WHERE f.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Filtrage");
  return r.rows[0] as FiltrageLigne & { dossier_id: string };
}

const REQUETE_FILTRAGES = `SELECT f.id, f.numero::text AS numero, f.dossier_id, f.liste_version_id,
    lv.liste_id, l.nom AS liste_nom, lv.version AS liste_version, f.declarations,
    f.themes, f.resultat, f.auteur_id, f.cree_le
  FROM dd_filtrages f
    JOIN dd_exclusion_liste_versions lv ON lv.id = f.liste_version_id
    JOIN dd_exclusion_listes l ON l.id = lv.liste_id`;

/** Dernière décision de chaque règle touchée d'un filtrage. */
async function decisionsCourantes(db: Db, filtrageIds: readonly string[]) {
  if (filtrageIds.length === 0) return [];
  const r = await db.query(
    `SELECT DISTINCT ON (d.filtrage_id, d.regle_code) d.filtrage_id, d.regle_code, d.decision,
       d.numero::text AS numero, d.decideur_id, u.nom AS decideur_nom, d.cree_le
     FROM dd_filtrage_decisions d LEFT JOIN utilisateurs u ON u.id = d.decideur_id
     WHERE d.filtrage_id = ANY ($1::uuid[])
     ORDER BY d.filtrage_id, d.regle_code, d.numero DESC`,
    [filtrageIds],
  );
  return r.rows as {
    filtrage_id: string;
    regle_code: string;
    decision: "confirmee" | "ecartee";
    numero: string;
    decideur_id: string;
    decideur_nom: string | null;
    cree_le: Date;
  }[];
}

function touchesMoteur(f: FiltrageLigne): ToucheExclusion[] {
  return f.resultat.touches.map((t) => ({
    regle: t.regle,
    criteres: t.criteres,
    motsTrouves: t.mots_trouves,
  }));
}

export interface FiltrageEvalue {
  ligne: FiltrageLigne;
  decisions: Awaited<ReturnType<typeof decisionsCourantes>>;
  bloquantes: number;
  /**
   * DERNIER filtrage seulement : exclusions touchées dans un filtrage antérieur du dossier,
   * « confirmées » ou jamais décidées, et non levées dans le dernier (aucune décision « écartée »
   * d'un tiers sur la MÊME règle). Elles restent bloquantes (comptées dans `bloquantes`) : un seul
   * rédacteur ne lève pas un blocage en refaisant un filtrage dont les activités déclarées ne
   * touchent plus la règle.
   */
  anterieures: { regle: string; libelle: string }[];
}

/** Filtrages d'un dossier (au plus 50), plus récent d'abord, avec leurs décisions courantes. */
export async function filtragesDuDossier(db: Db, dossierId: string): Promise<FiltrageEvalue[]> {
  const r = await db.query(
    `${REQUETE_FILTRAGES} WHERE f.dossier_id = $1 ORDER BY f.numero DESC LIMIT $2`,
    [dossierId, PLAFONDS_DD.filtrages_par_dossier + 1],
  );
  const lignes = (r.rows as FiltrageLigne[]).slice(0, PLAFONDS_DD.filtrages_par_dossier);
  const decisions = await decisionsCourantes(
    db,
    lignes.map((l) => l.id),
  );
  const evalues: FiltrageEvalue[] = lignes.map((ligne) => {
    const siennes = decisions.filter((d) => d.filtrage_id === ligne.id);
    const pourMoteur: DecisionExclusion[] = siennes.map((d) => ({
      regle: d.regle_code,
      decision: d.decision,
      numero: Number(d.numero),
    }));
    return {
      ligne,
      decisions: siennes,
      bloquantes: touchesBloquantes(touchesMoteur(ligne), pourMoteur),
      anterieures: [],
    };
  });
  const dernier = evalues[0];
  if (dernier) {
    const touchees = new Set(dernier.ligne.resultat.touches.map((t) => t.regle));
    const levees = new Set(
      dernier.decisions.filter((d) => d.decision === "ecartee").map((d) => d.regle_code),
    );
    // Libellé de chaque règle touchée dans un filtrage antérieur (le plus récent d'abord).
    const libelles = new Map<string, string>();
    for (const f of evalues.slice(1)) {
      for (const t of f.ligne.resultat.touches) {
        if (!libelles.has(t.regle)) libelles.set(t.regle, t.libelle ?? t.regle);
      }
    }
    // Dernier état connu de chaque règle dans les filtrages antérieurs (du plus récent au plus
    // ancien) : sa dernière décision, ou « non décidée » (null) si le filtrage le plus récent qui
    // la mentionne la touche sans que personne n'en ait décidé. Dans un même filtrage, une décision
    // l'emporte sur la touche.
    const vues = new Map<string, "confirmee" | "ecartee" | null>();
    for (const f of evalues.slice(1)) {
      for (const d of f.decisions) {
        if (!vues.has(d.regle_code)) vues.set(d.regle_code, d.decision);
      }
      for (const t of f.ligne.resultat.touches) {
        if (!vues.has(t.regle)) vues.set(t.regle, null);
      }
    }
    // Reportée tant qu'aucun tiers ne l'a écartée : confirmée ou jamais décidée.
    for (const [regle, decision] of vues) {
      if (decision !== "ecartee" && !touchees.has(regle) && !levees.has(regle)) {
        dernier.anterieures.push({ regle, libelle: libelles.get(regle) ?? regle });
      }
    }
    dernier.bloquantes += dernier.anterieures.length;
  }
  return evalues;
}

/** Synthèse E&S d'un filtrage (moteur), thèmes lus avec la solidité de leur assertion. */
export async function syntheseDuFiltrage(
  db: Db,
  missionId: string,
  f: FiltrageEvalue,
  registreCharge: RegistreDossier | null = null,
) {
  const ids = f.ligne.themes.flatMap((t) => (t.assertion_id === null ? [] : [t.assertion_id]));
  const registre = registreCharge ?? (await chargerRegistre(db, missionId, ids));
  const themes: ThemeEsEntree[] = f.ligne.themes.map((t) => ({
    code: t.code,
    niveau: t.niveau,
    lecture: t.assertion_id === null ? null : lectureDe(registre, t.assertion_id),
  }));
  return syntheseSocioEnvironnementale(themes, f.bloquantes, THEMES_ES);
}

function vueTouches(f: FiltrageEvalue) {
  return f.ligne.resultat.touches.map((t) => {
    const d = f.decisions.find((x) => x.regle_code === t.regle);
    return {
      regle: t.regle,
      libelle: t.libelle ?? t.regle,
      criteres: t.criteres,
      mots_trouves: t.mots_trouves,
      decision: d?.decision ?? null,
      decideur: d ? { id: d.decideur_id, nom: d.decideur_nom } : null,
      decide_le: d?.cree_le ?? null,
    };
  });
}

/** R39 : filtrages (plus récent d'abord) et synthèse E&S du DERNIER, recalculée à chaque lecture. */
export async function lireFiltrages(db: Db, missionId: string, dossierId: string) {
  const filtrages = await filtragesDuDossier(db, dossierId);
  const dernier = filtrages[0];
  return {
    elements: filtrages.map((f) => ({
      id: f.ligne.id,
      numero: f.ligne.numero,
      liste_version: {
        id: f.ligne.liste_version_id,
        liste_id: f.ligne.liste_id,
        nom: f.ligne.liste_nom,
        version: f.ligne.liste_version,
      },
      declarations: f.ligne.declarations,
      themes: f.ligne.themes,
      touches: vueTouches(f),
      non_touchees: f.ligne.resultat.non_touchees,
      auteur_id: f.ligne.auteur_id,
      cree_le: f.ligne.cree_le,
    })),
    exclusions_anterieures_non_levees: dernier?.anterieures ?? [],
    synthese: dernier ? vueSyntheseEs(await syntheseDuFiltrage(db, missionId, dernier)) : null,
  };
}

/** R40 : exécute la version courante de la liste sur les déclarations et enregistre la revue. */
export async function creerFiltrage(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  c: CorpsFiltrage,
): Promise<{ id: string; touches: ReturnType<typeof vueTouchesBrutes>; non_touchees: number }> {
  await exigerPlafondDd(db, {
    table: "dd_filtrages",
    colonne: "dossier_id",
    valeur: dossier.id,
    max: PLAFONDS_DD.filtrages_par_dossier,
    quoi: "filtrages par dossier",
  });
  const liste = await lireListe(db, c.liste_id).catch((e: unknown) => {
    if (e instanceof AppError && e.statut === 404) {
      throw new AppError(400, "LIEN_INCOHERENT", "La liste d'exclusion désignée est inconnue.");
    }
    throw e;
  });
  // Une liste d'un investisseur (client) ne s'applique qu'à un dossier de CE client. Une liste
  // sans client est générale. La LECTURE d'une liste reste ouverte à tout détenteur de dd.lire du
  // cabinet : c'est un référentiel du cabinet, dont le client_id ne fait que désigner l'investisseur.
  if (liste.client_id !== null && liste.client_id !== dossier.client_id) {
    throw new AppError(
      400,
      "LIEN_INCOHERENT",
      "Cette liste d'exclusion est celle d'un autre investisseur que le client du dossier.",
    );
  }
  const assertions = c.themes.flatMap((t) => (t.assertion_id === null ? [] : [t.assertion_id]));
  if (assertions.length > 0) {
    const r = await db.query(
      "SELECT id FROM assertions WHERE mission_id = $1 AND id = ANY ($2::uuid[])",
      [dossier.mission_id, assertions],
    );
    if (r.rows.length !== new Set(assertions).size) {
      throw new AppError(
        400,
        "LIEN_INCOHERENT",
        "Une assertion de thème n'appartient pas à la mission du dossier.",
      );
    }
  }
  const regles: RegleExclusion[] = liste.regles.map((r) => ({
    code: r.code,
    motsCles: r.mots_cles,
    secteurCodes: r.secteur_codes,
    paysCodes: r.pays_codes,
  }));
  const resultat = filtrerExclusions(
    {
      activites: c.declarations.activites,
      secteurCodes: c.declarations.secteur_codes,
      paysCodes: c.declarations.pays_codes,
    },
    regles,
  );
  const fige = {
    touches: resultat.touches.map((t) => ({
      regle: t.regle,
      libelle: liste.regles.find((x) => x.code === t.regle)?.libelle ?? t.regle,
      criteres: [...t.criteres],
      mots_trouves: [...t.motsTrouves],
    })),
    non_touchees: resultat.nonTouchees,
  };
  const r = await db.query(
    `INSERT INTO dd_filtrages (cabinet_id, dossier_id, liste_version_id, declarations, themes,
       resultat, auteur_id)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      liste.version_id,
      JSON.stringify(c.declarations),
      JSON.stringify(c.themes),
      JSON.stringify(fige),
      auth.utilisateurId,
    ],
  );
  return {
    id: r.rows[0].id as string,
    touches: vueTouchesBrutes(fige.touches),
    non_touchees: fige.non_touchees,
  };
}

function vueTouchesBrutes(
  touches: { regle: string; libelle: string; criteres: string[]; mots_trouves: string[] }[],
) {
  return touches.map((t) => ({
    regle: t.regle,
    libelle: t.libelle,
    criteres: t.criteres,
    mots_trouves: t.mots_trouves,
  }));
}

/**
 * R41 : décision d'un tiers sur une exclusion touchée. Seul le DERNIER filtrage du dossier reçoit
 * une décision (409 FILTRAGE_PERIME) ; la règle est touchée par lui ou par un filtrage antérieur ;
 * l'auteur du filtrage visé ou d'un filtrage plus récent ne décide pas (sauf associé), sans quoi
 * l'auteur du dernier filtrage lèverait lui-même l'exclusion d'un filtrage antérieur (MPZ28, même
 * règle dans le déclencheur). Le journal des décisions d'un filtrage est plafonné, sous le verrou de
 * la mission pris par la route.
 */
export async function decider(
  db: Db,
  auth: Auth,
  filtrage: FiltrageLigne & { dossier_id: string },
  c: CorpsDecision,
): Promise<void> {
  const dossier = await filtragesDuDossier(db, filtrage.dossier_id);
  if (dossier[0]?.ligne.id !== filtrage.id) {
    throw new AppError(
      409,
      "FILTRAGE_PERIME",
      "Un filtrage plus récent existe : décidez sur le dernier filtrage du dossier.",
    );
  }
  // Règle touchée par ce filtrage OU par un filtrage antérieur du dossier (une exclusion confirmée
  // plus tôt se lève dans le dernier filtrage même si les activités déclarées ne la touchent plus).
  const connue = dossier.some((f) =>
    f.ligne.resultat.touches.some((t) => t.regle === c.regle_code),
  );
  if (!connue) {
    throw new AppError(
      400,
      "RATTACHEMENT_INCOHERENT",
      "Cette règle ne figure pas parmi les règles touchées du filtrage.",
    );
  }
  if (!estAssocieDd(auth)) {
    const r = await db.query(
      `SELECT 1 FROM dd_filtrages g
       WHERE g.dossier_id = $1 AND g.numero >= $2::bigint AND g.auteur_id = $3 LIMIT 1`,
      [filtrage.dossier_id, filtrage.numero, auth.utilisateurId],
    );
    if (r.rows.length > 0) {
      throw new AppError(
        403,
        "SEPARATION_DES_TACHES",
        "L'auteur du filtrage ne décide pas lui-même d'une exclusion : un autre membre ou un associé le fait.",
      );
    }
  }
  const n = await db.query(
    "SELECT count(*)::int AS n FROM dd_filtrage_decisions WHERE filtrage_id = $1",
    [filtrage.id],
  );
  if ((n.rows[0].n as number) >= PLAFONDS_DD.decisions_par_filtrage) {
    throw new AppError(
      409,
      "PLAFOND_ATTEINT",
      `Plafond atteint : ${PLAFONDS_DD.decisions_par_filtrage} décisions par filtrage au plus.`,
    );
  }
  await db.query(
    `INSERT INTO dd_filtrage_decisions (cabinet_id, filtrage_id, regle_code, decision, motif,
       decideur_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.cabinetId, filtrage.id, c.regle_code, c.decision, c.motif, auth.utilisateurId],
  );
}
