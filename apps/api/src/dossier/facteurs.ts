import { contexteDepuisFacteurs, valeursCourantesDatees } from "@missionpilot/engines";
import {
  FACTEURS_PAR_CLIENT_MAX,
  VALEURS_FACTEURS_FIABILITE,
  type FacteurValeurCreation,
  type ValeurFacteurContexte,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { exigerFichierLisible } from "../stockage/fichiers.js";
import { verrouillerDossier } from "./acces.js";
import { inscrireFiabilite } from "./fiabilite.js";

/*
 * Facteurs de contexte du client (STD-04) : valeurs typées, datées et sourcées, en ajout
 * seul (0221). La valeur courante d'un facteur est celle de date d'effet la plus récente,
 * non future (moteur `valeursCourantesDatees`). Le contexte qui en résulte a la forme du
 * `contexteModulationSchema` lu par le moteur de modulation (lot STD).
 */

const horodatage = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string));

export function vueFacteur(f: Record<string, unknown>) {
  return {
    id: f.id as string,
    code: f.code as string,
    type: f.type as string,
    valeur: f.valeur as ValeurFacteurContexte,
    date_effet: f.date_effet as string,
    source: {
      type: f.source_type,
      libelle: f.source_libelle,
      document_id: f.source_document_id ?? null,
      page: f.source_page ?? null,
      reference: f.source_reference ?? null,
    },
    fiabilite: f.fiabilite as string,
    auteur: { id: f.auteur_id, nom: f.auteur_nom },
    cree_le: horodatage(f.cree_le),
  };
}
export type VueFacteur = ReturnType<typeof vueFacteur>;

/** Toutes les valeurs des facteurs d'un client, historique compris (plafonnées). */
export async function listerFacteurs(db: Db, clientId: string): Promise<VueFacteur[]> {
  const r = await db.query(
    `SELECT f.id, f.code, f.type, f.valeur, f.date_effet::text AS date_effet, f.source_type,
       f.source_libelle, f.source_document_id, f.source_page, f.source_reference, f.fiabilite,
       f.auteur_id, u.nom AS auteur_nom, f.cree_le
     FROM dossier_facteurs f JOIN utilisateurs u ON u.id = f.auteur_id
     WHERE f.client_id = $1
     ORDER BY f.code, f.date_effet DESC, f.cree_le DESC, f.id
     LIMIT $2`,
    [clientId, FACTEURS_PAR_CLIENT_MAX],
  );
  return r.rows.map(vueFacteur);
}

/** Entrées datées du moteur : rang = ordre d'enregistrement. */
function datees(valeurs: readonly VueFacteur[]) {
  return valeurs.map((v) => ({
    facteur: v,
    cle: v.code,
    dateEffet: v.date_effet,
    rang: Date.parse(v.cree_le) || 0,
    valeur: v.valeur,
  }));
}

/** Valeur courante de chaque facteur à la date donnée. */
export function facteursCourants(valeurs: readonly VueFacteur[], aLaDate: string): VueFacteur[] {
  return valeursCourantesDatees(datees(valeurs), aLaDate).map((v) => v.facteur);
}

/** Contexte (code → valeur courante) à la date donnée. */
export function contexteFacteurs(
  valeurs: readonly VueFacteur[],
  aLaDate: string,
): Record<string, ValeurFacteurContexte> {
  return contexteDepuisFacteurs(datees(valeurs), aLaDate);
}

/** Ajoute une valeur de facteur au dossier (visible, vérifié par l'appelant). */
export async function ajouterFacteur(
  db: Db,
  auth: Auth,
  clientId: string,
  f: FacteurValeurCreation,
): Promise<VueFacteur> {
  await verrouillerDossier(db, clientId);
  const n = await db.query("SELECT count(*)::int AS n FROM dossier_facteurs WHERE client_id = $1", [
    clientId,
  ]);
  if ((n.rows[0].n as number) >= FACTEURS_PAR_CLIENT_MAX) {
    throw new AppError(
      409,
      "DOSSIER_PLEIN",
      `Au plus ${FACTEURS_PAR_CLIENT_MAX} valeurs de facteurs par dossier.`,
    );
  }
  if (f.source.document_id) await exigerFichierLisible(db, auth, f.source.document_id);
  const r = await db.query(
    `INSERT INTO dossier_facteurs (cabinet_id, client_id, code, type, valeur, date_effet, source_type,
       source_libelle, source_document_id, source_page, source_reference, fiabilite, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, code, type, valeur, date_effet::text AS date_effet, source_type, source_libelle,
       source_document_id, source_page, source_reference, fiabilite, auteur_id, cree_le`,
    [
      auth.cabinetId,
      clientId,
      f.code,
      f.type,
      JSON.stringify(f.valeur),
      f.date_effet,
      f.source.type,
      f.source.libelle,
      f.source.document_id ?? null,
      f.source.page ?? null,
      f.source.reference ?? null,
      f.fiabilite,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "dossier_facteur",
    entiteId: r.rows[0].id,
    details: { client_id: clientId, code: f.code, date_effet: f.date_effet },
  });
  if (Object.hasOwn(VALEURS_FACTEURS_FIABILITE, f.code))
    await inscrireFiabilite(db, auth, clientId);
  return vueFacteur({ ...r.rows[0], auteur_nom: auth.nom });
}
