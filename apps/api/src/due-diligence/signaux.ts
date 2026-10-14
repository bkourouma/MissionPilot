import {
  signauxApplicables,
  type FamilleRisqueDd,
  type NiveauRisqueDd,
  type SignalBibliotheque,
} from "@missionpilot/engines";
import {
  PLAFONDS_DD,
  type signalConstatSchema,
  type signalCreationSchema,
  type signalVersionSchema,
  type signauxQuerySchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { motifContient } from "../http/outils.js";
import {
  exigerPlafondDd,
  exigerVersionCourante,
  exigerVersionsRestantes,
  verrouillerCabinet,
  type DossierLu,
} from "./acces.js";
import { cadrageCourant } from "./dossiers.js";
import { contexteSignaux, verifierCodesSignal } from "./taxonomie.js";

/*
 * Bibliothèque de signaux d'alerte (DD-11, migration 0501, SPEC-3b §8.4, R24 à R29). Propre au
 * cabinet, VIDE au départ (aucun signal inventé), maintenue par `dd.referentiel.gerer` ; versions
 * en ajout seul. Les signaux applicables à un dossier sont retenus par le moteur
 * (`signauxApplicables`) d'après le contexte de taxonomie du cadrage (filière puis secteur, pays
 * puis zone) ; l'expert constate, écarte (avec commentaire) ou marque à vérifier.
 */

export type CorpsSignalCreation = z.infer<typeof signalCreationSchema>;
export type CorpsSignalVersion = z.infer<typeof signalVersionSchema>;
/** Contenu d'une version de signal (hors identité, version lue et motif). */
type ContenuSignal = Omit<CorpsSignalVersion, "version_courante" | "motif">;
export type CorpsConstat = z.infer<typeof signalConstatSchema>;
export type FiltresSignaux = z.infer<typeof signauxQuerySchema>;

export interface SignalCourant {
  id: string;
  code: string;
  cle_tri: string;
  cree_le: Date;
  version: number;
  libelle: string;
  description: string | null;
  famille: FamilleRisqueDd;
  secteur_code: string | null;
  pays_code: string | null;
  gravite_indicative: NiveauRisqueDd;
  question: string | null;
  reference_publique: string | null;
  actif: boolean;
}

const COLONNES = `s.id, s.code, s.numero::text AS cle_tri, s.cree_le, v.version, v.libelle,
  v.description, v.famille, v.secteur_code, v.pays_code, v.gravite_indicative, v.question,
  v.reference_publique, v.actif`;
const DEPUIS = `FROM dd_signaux s
  JOIN LATERAL (SELECT * FROM dd_signal_versions sv WHERE sv.signal_id = s.id
                ORDER BY sv.version DESC LIMIT 1) v ON true`;

/** R24 : page de signaux courants, du plus récent au plus ancien (curseur sur le numéro). */
export async function listerSignaux(
  db: Db,
  q: FiltresSignaux,
  apres: string | null,
): Promise<SignalCourant[]> {
  const r = await db.query(
    `SELECT ${COLONNES} ${DEPUIS}
     WHERE ($1::bigint IS NULL OR s.numero < $1::bigint)
       AND ($2::text IS NULL OR v.famille = $2)
       AND ($3::text IS NULL OR v.secteur_code = $3)
       AND ($4::text IS NULL OR v.pays_code = $4)
       AND ($5::boolean IS NULL OR v.actif = $5)
       AND ($6::text IS NULL OR v.libelle ILIKE $6 OR s.code ILIKE $6 OR v.description ILIKE $6)
     ORDER BY s.numero DESC LIMIT $7`,
    [
      apres,
      q.famille ?? null,
      q.secteur_code ?? null,
      q.pays_code ?? null,
      q.actif ?? null,
      motifContient(q.q),
      q.limite + 1,
    ],
  );
  return r.rows as SignalCourant[];
}

export async function lireSignal(db: Db, id: string): Promise<SignalCourant> {
  const r = await db.query(`SELECT ${COLONNES} ${DEPUIS} WHERE s.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Signal");
  return r.rows[0] as SignalCourant;
}

export function vueSignal(s: Omit<SignalCourant, "cle_tri" | "cree_le">) {
  return {
    id: s.id,
    code: s.code,
    version: s.version,
    libelle: s.libelle,
    description: s.description,
    famille: s.famille,
    secteur_code: s.secteur_code,
    pays_code: s.pays_code,
    gravite_indicative: s.gravite_indicative,
    question: s.question,
    reference_publique: s.reference_publique,
    actif: s.actif,
  };
}

async function insererVersion(
  db: Db,
  auth: Auth,
  signalId: string,
  version: number,
  c: ContenuSignal,
  motif: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO dd_signal_versions (cabinet_id, signal_id, version, libelle, description, famille,
       secteur_code, pays_code, gravite_indicative, question, reference_publique, actif, motif,
       cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      auth.cabinetId,
      signalId,
      version,
      c.libelle,
      c.description,
      c.famille,
      c.secteur_code,
      c.pays_code,
      c.gravite_indicative,
      c.question,
      c.reference_publique,
      c.actif,
      motif,
      auth.utilisateurId,
    ],
  );
}

/** R25 : crée un signal (code unique par cabinet, plafond de 2 000 sous le verrou du cabinet). */
export async function creerSignal(
  db: Db,
  auth: Auth,
  c: CorpsSignalCreation,
): Promise<{ id: string; version: 1 }> {
  await verrouillerCabinet(db, auth.cabinetId, "signaux");
  const n = await db.query("SELECT count(*)::int AS n FROM dd_signaux");
  if ((n.rows[0].n as number) >= PLAFONDS_DD.signaux_par_cabinet) {
    throw new AppError(409, "PLAFOND_ATTEINT", "Trop de signaux dans la bibliothèque du cabinet.");
  }
  await verifierCodesSignal(db, c);
  const r = await db.query(
    `INSERT INTO dd_signaux (cabinet_id, code, cree_par) VALUES ($1, $2, $3) RETURNING id`,
    [auth.cabinetId, c.code, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersion(db, auth, id, 1, c, null);
  return { id, version: 1 };
}

/** R26 : nouvelle version d'un signal (la version lue est exigée). */
export async function corrigerSignal(
  db: Db,
  auth: Auth,
  id: string,
  c: CorpsSignalVersion,
): Promise<number> {
  await verrouillerCabinet(db, auth.cabinetId, "signaux");
  const courant = await lireSignal(db, id);
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  await verifierCodesSignal(db, c);
  const { motif } = c;
  await insererVersion(db, auth, id, courant.version + 1, c, motif);
  return courant.version + 1;
}

/** R27 : versions d'un signal, plus récente d'abord (au plus 200). */
export async function versionsDuSignal(db: Db, id: string) {
  await lireSignal(db, id);
  const r = await db.query(
    `SELECT v.version, v.libelle, v.description, v.famille, v.secteur_code, v.pays_code,
       v.gravite_indicative, v.question, v.reference_publique, v.actif, v.motif, v.cree_par,
       u.nom AS cree_par_nom, v.cree_le
     FROM dd_signal_versions v LEFT JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.signal_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return r.rows;
}

interface ConstatCourant {
  signal_id: string;
  etat: string;
  risque_element_id: string | null;
}

async function constatsCourants(db: Db, dossierId: string): Promise<Map<string, ConstatCourant>> {
  const r = await db.query(
    `SELECT DISTINCT ON (c.signal_id) c.signal_id, c.etat, c.risque_element_id
     FROM dd_signal_constats c WHERE c.dossier_id = $1 ORDER BY c.signal_id, c.numero DESC`,
    [dossierId],
  );
  return new Map((r.rows as ConstatCourant[]).map((c) => [c.signal_id, c]));
}

/** Signaux actifs de la bibliothèque retenus par le moteur pour le cadrage d'un dossier. */
export async function signauxDuDossier(db: Db, dossierId: string) {
  const cadrage = await cadrageCourant(db, dossierId);
  const contexte = await contexteSignaux(db, cadrage);
  const tous = await db.query(
    `SELECT ${COLONNES} ${DEPUIS} WHERE v.actif ORDER BY s.numero ASC LIMIT $1`,
    [PLAFONDS_DD.signaux_par_cabinet + 1],
  );
  const signaux = tous.rows as SignalCourant[];
  const entrees: SignalBibliotheque[] = signaux.map((s) => ({
    id: s.id,
    secteurCode: s.secteur_code,
    paysCode: s.pays_code,
    famille: s.famille,
    gravite: s.gravite_indicative,
    actif: s.actif,
  }));
  const applicables = signauxApplicables(contexte, entrees);
  const parId = new Map(signaux.map((s) => [s.id, s]));
  const constats = await constatsCourants(db, dossierId);
  return applicables.flatMap((a) => {
    const s = parId.get(a.id);
    if (!s) return [];
    const constat = constats.get(a.id);
    return [
      {
        signal_id: s.id,
        version: s.version,
        libelle: s.libelle,
        famille: s.famille,
        gravite_indicative: s.gravite_indicative,
        question: s.question,
        reference_publique: s.reference_publique,
        specificite: a.specificite,
        etat_constat: constat?.etat ?? null,
        risque_id: constat?.risque_element_id ?? null,
      },
    ];
  });
}

/** R29 : constat d'un signal APPLICABLE à ce dossier (404 sinon). */
export async function constaterSignal(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  signalId: string,
  c: CorpsConstat,
): Promise<void> {
  const applicables = await signauxDuDossier(db, dossier.id);
  const signal = applicables.find((s) => s.signal_id === signalId);
  if (!signal) throw introuvable("Signal");
  if (c.risque_id !== null) {
    const r = await db.query(
      `SELECT 1 FROM dd_elements WHERE id = $1 AND dossier_id = $2 AND type = 'risque'`,
      [c.risque_id, dossier.id],
    );
    if (!r.rows[0]) {
      throw new AppError(
        400,
        "LIEN_INCOHERENT",
        "Le risque désigné n'appartient pas à ce dossier.",
      );
    }
  }
  await exigerPlafondDd(db, {
    table: "dd_signal_constats",
    colonne: "dossier_id",
    valeur: dossier.id,
    max: PLAFONDS_DD.constats_par_dossier,
    quoi: "constats de signaux par dossier",
  });
  await db.query(
    `INSERT INTO dd_signal_constats (cabinet_id, dossier_id, signal_id, signal_version, etat,
       commentaire, risque_element_id, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      dossier.id,
      signalId,
      signal.version,
      c.etat,
      c.commentaire,
      c.risque_id,
      auth.utilisateurId,
    ],
  );
}
