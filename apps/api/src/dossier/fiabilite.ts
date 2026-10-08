import {
  CERTIFICATIONS_COMPTES,
  indiceFiabiliteDossier,
  NIVEAUX_INFORMEL,
  type CertificationComptes,
  type IndiceFiabiliteDossier,
  type NiveauInformel,
} from "@missionpilot/engines";
import { FACTEUR_FIABILITE_COMPTES, FACTEUR_PART_INFORMEL } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { aujourdhui } from "./acces.js";
import { contexteFacteurs, listerFacteurs } from "./facteurs.js";

/*
 * Indice de fiabilité des données du client (DOS-04) : calculé par le moteur
 * `indiceFiabiliteDossier` à partir des facteurs `fiabilite_comptes` et `part_informel`,
 * des états financiers COURANTS (ni remplacés ni rejetés) et de la fiabilité des faits
 * confirmés courants. Un instantané est inscrit (0223) quand une écriture en change le
 * résultat ; la lecture recalcule toujours (jamais un chiffre périmé).
 */

/** Plafond des instantanés renvoyés avec l'indice (les plus récents). */
const HISTORIQUE_FIABILITE_MAX = 50;

function parmi<T extends string>(valeurs: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (valeurs as readonly string[]).includes(v) ? (v as T) : null;
}

/** Indice calculé à la date du jour. */
export async function calculerFiabilite(db: Db, clientId: string): Promise<IndiceFiabiliteDossier> {
  const date = aujourdhui();
  const contexte = contexteFacteurs(await listerFacteurs(db, clientId), date);
  const etats = await db.query(
    `SELECT e.date_cloture::text AS date_cloture, e.controles_ok FROM dossier_etats_financiers e
     WHERE e.client_id = $1
       AND NOT EXISTS (SELECT 1 FROM dossier_etats_financiers r WHERE r.remplace_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM dossier_etats_decisions d WHERE d.etat_id = e.id AND d.decision = 'rejete')`,
    [clientId],
  );
  const faits = await db.query(
    `SELECT f.fiabilite FROM dossier_faits f
     JOIN dossier_faits_decisions d ON d.fait_id = f.id AND d.decision = 'confirme'
     WHERE f.client_id = $1 AND NOT EXISTS (SELECT 1 FROM dossier_faits r WHERE r.remplace_id = f.id)`,
    [clientId],
  );
  return indiceFiabiliteDossier({
    certification: parmi<CertificationComptes>(
      CERTIFICATIONS_COMPTES,
      contexte[FACTEUR_FIABILITE_COMPTES],
    ),
    partInformel: parmi<NiveauInformel>(NIVEAUX_INFORMEL, contexte[FACTEUR_PART_INFORMEL]),
    etats: etats.rows.map((e) => ({
      dateCloture: e.date_cloture as string,
      controlesOk: e.controles_ok as boolean,
    })),
    fiabilitesFaits: faits.rows.map((f) => f.fiabilite as "A" | "B" | "C" | "D"),
    dateReference: date,
  });
}

/** Détail conservé dans un instantané (composantes, recommandations, ancienneté). */
function detailInstantane(i: IndiceFiabiliteDossier) {
  return {
    detail: i.detail,
    recommandations: i.recommandations.map((r) => r.code),
    mois_depuis_derniere_cloture: i.moisDepuisDerniereCloture,
  };
}

/** JSON aux clés triées : jsonb réordonne les clés, la comparaison doit l'ignorer. */
function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const cles = Object.keys(v).sort();
    return `{${cles.map((k) => `${JSON.stringify(k)}:${canonique((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Recalcule l'indice et inscrit un instantané s'il diffère du dernier (même transaction que
 * l'écriture qui l'a changé ; dossier déjà verrouillé par l'appelant).
 */
export async function inscrireFiabilite(db: Db, auth: Auth, clientId: string): Promise<void> {
  const indice = await calculerFiabilite(db, clientId);
  const detail = detailInstantane(indice);
  const dernier = await db.query(
    `SELECT points, classe, analyses_indicatives, detail FROM dossier_indices_fiabilite
     WHERE client_id = $1 ORDER BY cree_le DESC, id DESC LIMIT 1`,
    [clientId],
  );
  const d = dernier.rows[0];
  if (
    d &&
    d.points === indice.points &&
    d.classe === indice.classe &&
    d.analyses_indicatives === indice.analysesIndicatives &&
    canonique(d.detail) === canonique(detail)
  ) {
    return;
  }
  await db.query(
    `INSERT INTO dossier_indices_fiabilite (cabinet_id, client_id, points, classe, analyses_indicatives,
       detail, calcule_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      auth.cabinetId,
      clientId,
      indice.points,
      indice.classe,
      indice.analysesIndicatives,
      JSON.stringify(detail),
      auth.utilisateurId,
    ],
  );
}

/** Indice courant et derniers instantanés (les plus récents d'abord). */
export async function lireFiabilite(db: Db, clientId: string) {
  const indice = await calculerFiabilite(db, clientId);
  const historique = await db.query(
    `SELECT id, points, classe, analyses_indicatives, detail, cree_le FROM dossier_indices_fiabilite
     WHERE client_id = $1 ORDER BY cree_le DESC, id DESC LIMIT $2`,
    [clientId, HISTORIQUE_FIABILITE_MAX],
  );
  return {
    points: indice.points,
    classe: indice.classe,
    detail: indice.detail,
    analyses_indicatives: indice.analysesIndicatives,
    mois_depuis_derniere_cloture: indice.moisDepuisDerniereCloture,
    recommandations: indice.recommandations,
    historique: historique.rows.map((h) => ({
      id: h.id,
      points: h.points,
      classe: h.classe,
      analyses_indicatives: h.analyses_indicatives,
      detail: h.detail,
      cree_le: h.cree_le instanceof Date ? h.cree_le.toISOString() : h.cree_le,
    })),
  };
}

/** Indice sans ses instantanés (vue d'ensemble, export). */
export const indiceSansHistorique = ({
  historique: _h,
  ...indice
}: Awaited<ReturnType<typeof lireFiabilite>>) => indice;
