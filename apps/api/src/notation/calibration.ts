import { mesurerCalibration, type MesureCalibration } from "@missionpilot/engines";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable } from "../errors.js";
import { paginer } from "../http/outils.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { exigerExpertMetier } from "../questionnaires/acces.js";
import { exigerNotationVisible } from "./notations.js";

/*
 * Calibration entre évaluateurs (NOT-13, migration 0402). RÈGLES (testées dans
 * test/notation-augmentee.test.ts) :
 *
 * 1. Une session (titre, cas figés, échelle, tolérance) est ouverte par qui rédige les notations
 *    (notation.gerer ou notation.publier). Si elle cite une notation, celle-ci doit être visible,
 *    et la session n'est lue que par qui voit sa mission (sinon 404).
 * 2. Double cotation à l'aveugle : tant que la session est ouverte, chacun ne voit que SES
 *    cotations et l'avancement (nombre d'évaluateurs par cas). Un expert métier ne voit les
 *    cotations des autres et la mesure des écarts (moteur `mesurerCalibration`) que pour les cas
 *    qu'il a LUI-MÊME cotés (il ne peut donc rien apprendre d'un cas avant de l'avoir coté) ; un
 *    expert qui n'a rien coté n'en voit aucun. Tout le monde voit tout une fois la session close.
 * 3. Cotation : une par cas et par évaluateur, en ajout seul, refusée sur une session close
 *    (MPN11). Clôture une fois, avec une conclusion, par un expert métier (MPN11).
 */

interface Session {
  id: string;
  titre: string;
  cas: { code: string; libelle: string }[];
  niveaux: number;
  tolerance: number;
  notation_id: string | null;
  cree_par: string;
  cree_le: Date;
  cloturee_par: string | null;
  cloturee_le: Date | null;
  conclusion: string | null;
}

/** Fragment : session sans notation, ou notation d'une mission visible ($2 voit tout, $3 utilisateur). */
const VISIBLE = `(c.notation_id IS NULL OR EXISTS (
  SELECT 1 FROM notations n JOIN missions m ON m.id = n.mission_id
  WHERE n.id = c.notation_id AND ${filtreVisibilite(2, 3)}))`;

async function session(db: Db, auth: Auth, id: string, verrouiller = false): Promise<Session> {
  const r = await db.query(
    `SELECT c.* FROM notation_calibrations c WHERE c.id = $1 AND ${VISIBLE}
     ${verrouiller ? "FOR UPDATE OF c" : ""}`,
    [id, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  if (!r.rows[0]) throw introuvable("Session de calibrage");
  return r.rows[0] as Session;
}

export async function listerCalibrations(
  db: Db,
  auth: Auth,
  apres: [string, string] | null,
  limite: number,
) {
  const r = await db.query(
    `SELECT c.id, c.titre, jsonb_array_length(c.cas) AS nombre_cas, c.niveaux, c.tolerance,
       c.notation_id, c.cree_le, c.cloturee_le, (c.cloturee_le IS NOT NULL) AS close,
       (SELECT count(DISTINCT x.evaluateur_id) FROM notation_calibration_cotations x
        WHERE x.calibration_id = c.id) AS evaluateurs,
       c.cree_le::text AS cle_tri
     FROM notation_calibrations c
     WHERE ${VISIBLE} AND ($1::text IS NULL OR (c.cree_le, c.id) < ($1::timestamptz, $4::uuid))
     ORDER BY c.cree_le DESC, c.id DESC LIMIT $5`,
    [
      apres?.[0] ?? null,
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      apres?.[1] ?? null,
      limite + 1,
    ],
  );
  return paginer(
    r.rows.map((l) => ({ ...l, evaluateurs: Number(l.evaluateurs) })) as {
      cle_tri: string;
      id: string;
    }[],
    limite,
  );
}

export async function creerCalibration(
  db: Db,
  auth: Auth,
  corps: {
    titre: string;
    cas: { code: string; libelle: string }[];
    niveaux: number;
    tolerance: number;
    notation_id: string | null;
  },
) {
  if (corps.notation_id) await exigerNotationVisible(db, auth, corps.notation_id);
  const r = await db.query(
    `INSERT INTO notation_calibrations (cabinet_id, titre, cas, niveaux, tolerance, notation_id, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      corps.titre,
      JSON.stringify(corps.cas),
      corps.niveaux,
      corps.tolerance,
      corps.notation_id,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "notation_calibration",
    entiteId: id,
    details: { cas: corps.cas.length, notation_id: corps.notation_id },
  });
  return lireCalibration(db, auth, id);
}

function vueMesure(m: MesureCalibration, noms: Map<string, string>) {
  return {
    tolerance: m.tolerance,
    cas_doublement_cotes: m.casDoublementCotes,
    cas_en_accord: m.casEnAccord,
    taux_accord: m.tauxAccord,
    ecart_moyen: m.ecartMoyen,
    a_discuter: m.aDiscuter,
    cas: m.cas,
    evaluateurs: m.evaluateurs.map((e) => ({
      evaluateur: { id: e.evaluateur, nom: noms.get(e.evaluateur) ?? null },
      cotations: e.cotations,
      cas_compares: e.casCompares,
      biais: e.biais,
      ecart_absolu_moyen: e.ecartAbsoluMoyen,
    })),
  };
}

/**
 * Session, mes cotations, avancement ; cotations de tous et mesure : tous les cas une fois la
 * session close ; avant, un expert métier ne les voit que pour les cas qu'il a cotés (NOT-13,
 * double cotation à l'aveugle), les autres rôles ne les voient pas.
 */
export async function lireCalibration(db: Db, auth: Auth, id: string) {
  const s = await session(db, auth, id);
  const r = await db.query(
    `SELECT x.cas, x.evaluateur_id, u.nom, x.niveau, x.motif, x.cree_le
     FROM notation_calibration_cotations x JOIN utilisateurs u ON u.id = x.evaluateur_id
     WHERE x.calibration_id = $1 ORDER BY x.cas, x.cree_le, x.id`,
    [id],
  );
  const cotations = r.rows as {
    cas: string;
    evaluateur_id: string;
    nom: string;
    niveau: number;
    motif: string | null;
    cree_le: Date;
  }[];
  const close = s.cloturee_le !== null;
  const mesCas = new Set(
    cotations.filter((c) => c.evaluateur_id === auth.utilisateurId).map((c) => c.cas),
  );
  // Visibles : tout si close ; sinon, pour un expert métier, les seuls cas qu'il a cotés.
  const visibles = close
    ? cotations
    : auth.roles.includes("expert_metier")
      ? cotations.filter((c) => mesCas.has(c.cas))
      : null;
  const noms = new Map(cotations.map((c) => [c.evaluateur_id, c.nom]));
  const avancement = s.cas.map((c) => ({
    code: c.code,
    libelle: c.libelle,
    evaluateurs: cotations.filter((x) => x.cas === c.code).length,
  }));
  return {
    ...s,
    close,
    avancement,
    mes_cotations: cotations
      .filter((c) => c.evaluateur_id === auth.utilisateurId)
      .map(({ cas, niveau, motif, cree_le }) => ({ cas, niveau, motif, cree_le })),
    cotations: visibles
      ? visibles.map((c) => ({
          cas: c.cas,
          evaluateur: { id: c.evaluateur_id, nom: c.nom },
          niveau: c.niveau,
          motif: c.motif,
        }))
      : null,
    mesure:
      visibles && (close || visibles.length > 0)
        ? vueMesure(
            mesurerCalibration(
              visibles.map((c) => ({ cas: c.cas, evaluateur: c.evaluateur_id, niveau: c.niveau })),
              { niveaux: s.niveaux, tolerance: s.tolerance },
            ),
            noms,
          )
        : null,
  };
}

/** Cotations de l'utilisateur (une par cas, ajout seul) sur une session ouverte. */
export async function coter(
  db: Db,
  auth: Auth,
  id: string,
  cotations: { cas: string; niveau: number; motif?: string | null }[],
) {
  const s = await session(db, auth, id, true);
  if (s.cloturee_le !== null) throw conflit("La session de calibrage est close.");
  const codes = new Set(s.cas.map((c) => c.code));
  for (const c of cotations) {
    if (!codes.has(c.cas) || c.niveau > s.niveaux) {
      throw conflit(`Cas « ${c.cas} » inconnu de la session ou niveau hors échelle.`);
    }
    await db.query(
      `INSERT INTO notation_calibration_cotations (cabinet_id, calibration_id, cas, evaluateur_id,
         niveau, motif)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.cabinetId, id, c.cas, auth.utilisateurId, c.niveau, c.motif ?? null],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "cotation",
    entite: "notation_calibration",
    entiteId: id,
    details: { cotations: cotations.length },
  });
  return lireCalibration(db, auth, id);
}

/** Clôture (expert métier), conclusion obligatoire ; la session est ensuite figée. */
export async function cloturer(db: Db, auth: Auth, id: string, conclusion: string) {
  exigerExpertMetier(auth, "clôt une session de calibrage");
  const s = await session(db, auth, id, true);
  if (s.cloturee_le !== null) throw conflit("La session de calibrage est déjà close.");
  await db.query(
    `UPDATE notation_calibrations SET cloturee_par = $2, cloturee_le = now(), conclusion = $3
     WHERE id = $1`,
    [id, auth.utilisateurId, conclusion],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "cloture",
    entite: "notation_calibration",
    entiteId: id,
  });
  return lireCalibration(db, auth, id);
}
