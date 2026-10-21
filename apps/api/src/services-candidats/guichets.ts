import {
  rapprocherGuichets,
  type GuichetFinancement,
  type ProfilFinancement,
  type ResultatRapprochement,
} from "@missionpilot/engines";
import {
  aPermission,
  type GuichetCreation,
  type GuichetModification,
  type GuichetsRapprochement,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { clauseSet } from "../db/outils.js";
import { aujourdhui, exigerDossierVisible } from "../dossier/acces.js";
import { lireContexteClient } from "../dossier/lecture.js";
import { interdit, introuvable, requeteInvalide } from "../errors.js";
import { PLAFOND_GUICHETS } from "./erreurs.js";

/*
 * Guichets de financement du cabinet : liste VIDE par défaut (aucun guichet inventé, aucune source
 * externe). On désactive (`actif = false`), on ne supprime pas. Rapprochement INDICATIF d'un client
 * (dossier) ou d'un profil saisi avec ces guichets, par le moteur `rapprocherGuichets`.
 */

const COLONNES = `id, nom, type, pays, secteurs, filieres, tailles, objets, devises,
  montant_min::float8 AS montant_min, montant_max::float8 AS montant_max, devise_montant,
  to_char(date_limite, 'YYYY-MM-DD') AS date_limite, description, url, actif, a_valider,
  cree_par, cree_le, modifie_le`;
const CHAMPS_AUDIT = [
  "nom",
  "type",
  "pays",
  "secteurs",
  "filieres",
  "tailles",
  "objets",
  "devises",
  "montant_min",
  "montant_max",
  "devise_montant",
  "date_limite",
  "description",
  "url",
  "actif",
] as const;
/** Un cabinet ne dépasse pas PLAFOND_GUICHETS guichets (doublé en base) : le rapprochement les lit tous. */
const PLAFOND_RAPPROCHEMENT = PLAFOND_GUICHETS;

export const AVERTISSEMENT_RAPPROCHEMENT =
  "Rapprochement indicatif sur les guichets saisis par le cabinet ; aucune source externe ; à valider par un expert.";

export interface Guichet {
  id: string;
  nom: string;
  type: string;
  pays: string[];
  secteurs: string[];
  filieres: string[];
  tailles: string[];
  objets: string[];
  devises: string[];
  montant_min: number | null;
  montant_max: number | null;
  devise_montant: string | null;
  date_limite: string | null;
  description: string | null;
  url: string | null;
  actif: boolean;
  a_valider: boolean;
  cree_par: string;
  cree_le: string;
  modifie_le: string;
}

const choisir = (o: object) =>
  Object.fromEntries(CHAMPS_AUDIT.map((c) => [c, (o as Record<string, unknown>)[c]]));

/** Liste triée par nom ; `tronque` vrai si d'autres guichets existent au-delà de `limite`. */
export async function listerGuichets(
  db: Db,
  filtre: { actif?: boolean | undefined; limite: number },
): Promise<{ elements: Guichet[]; tronque: boolean }> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM guichets_financement
     WHERE $1::boolean IS NULL OR actif = $1
     ORDER BY lower(nom), id LIMIT $2`,
    [filtre.actif ?? null, filtre.limite + 1],
  );
  const lignes = r.rows as Guichet[];
  return { elements: lignes.slice(0, filtre.limite), tronque: lignes.length > filtre.limite };
}

export async function lireGuichet(db: Db, id: string): Promise<Guichet> {
  const r = await db.query(`SELECT ${COLONNES} FROM guichets_financement WHERE id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Guichet de financement");
  return r.rows[0] as Guichet;
}

export async function creerGuichet(db: Db, auth: Auth, g: GuichetCreation): Promise<Guichet> {
  const r = await db.query(
    `INSERT INTO guichets_financement (cabinet_id, nom, type, pays, secteurs, filieres, tailles,
       objets, devises, montant_min, montant_max, devise_montant, date_limite, description, url,
       actif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING ${COLONNES}`,
    [
      auth.cabinetId,
      g.nom,
      g.type,
      g.pays,
      g.secteurs,
      g.filieres,
      g.tailles,
      g.objets,
      g.devises,
      g.montant_min,
      g.montant_max,
      g.devise_montant,
      g.date_limite,
      g.description ?? null,
      g.url ?? null,
      g.actif,
      auth.utilisateurId,
    ],
  );
  const cree = r.rows[0] as Guichet;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "guichet_financement",
    entiteId: cree.id,
    details: { apres: choisir(cree) },
  });
  return cree;
}

export async function modifierGuichet(
  db: Db,
  auth: Auth,
  id: string,
  m: GuichetModification,
): Promise<Guichet> {
  const avant = await lireGuichet(db, id);
  // Cohérence finale des bornes (le schéma ne voit que le corps).
  const final = {
    ...avant,
    ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)),
  } as Guichet;
  if (
    typeof final.montant_min === "number" &&
    typeof final.montant_max === "number" &&
    final.montant_min > final.montant_max
  )
    throw requeteInvalide("Le montant minimum ne peut pas dépasser le maximum.");
  if ((final.montant_min !== null || final.montant_max !== null) && final.devise_montant === null)
    throw requeteInvalide("La devise du montant est obligatoire quand une borne est donnée.");
  const set = clauseSet(m as Record<string, unknown>, 2);
  const r = await db.query(
    `UPDATE guichets_financement SET ${set.sql}, modifie_le = now() WHERE id = $1
     RETURNING ${COLONNES}`,
    [id, ...set.valeurs],
  );
  const apres = r.rows[0] as Guichet;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification",
    entite: "guichet_financement",
    entiteId: id,
    details: { avant: choisir(avant), apres: choisir(apres) },
  });
  return apres;
}

export interface ReponseRapprochement {
  profil_utilise: ProfilFinancement;
  /** Données du dossier ayant servi au profil (aucune n'est inventée) ; null sans client. */
  dossier: { client_id: string; chiffre_affaires_millions: number | null } | null;
  resultats: {
    guichet: Pick<Guichet, "id" | "nom" | "type" | "description" | "url" | "date_limite">;
    statut: ResultatRapprochement["statut"];
    score: number;
    criteres: ResultatRapprochement["criteres"];
    raisons_exclusion: string[];
  }[];
  /** Vrai si le plafond de lecture est atteint : des guichets du cabinet n'ont pas été rapprochés. */
  tronque: boolean;
  avertissement: string;
}

const listeTextes = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

/**
 * Profil de départ tiré du dossier du client (pays, secteur, taille de la fiche ; filières du
 * contexte du dossier), puis surcharges de `corps.profil`. Le chiffre d'affaires du dossier est
 * rapporté à part : ce n'est pas le montant recherché, que seul l'utilisateur fixe.
 */
export async function rapprocher(
  db: Db,
  auth: Auth,
  corps: GuichetsRapprochement,
): Promise<ReponseRapprochement> {
  const date = aujourdhui();
  let profil: ProfilFinancement = {
    pays: null,
    secteur: null,
    filieres: [],
    taille: null,
    objet: null,
    montant: null,
    devise: null,
  };
  let dossier: ReponseRapprochement["dossier"] = null;
  if (corps.client_id) {
    // Le dossier est plus sensible que l'annuaire : `dossier.lire` EN PLUS (et visibilité, sinon 404).
    if (!aPermission(auth.roles, "dossier.lire")) throw interdit();
    const client = await exigerDossierVisible(db, auth, corps.client_id);
    const contexte = await lireContexteClient(db, client.id, date);
    const ca = contexte["chiffre_affaires"];
    profil = {
      ...profil,
      pays: client.pays?.trim() || null,
      secteur: client.secteur,
      taille: client.taille,
      filieres: listeTextes(contexte["filieres"]),
    };
    dossier = {
      client_id: client.id,
      chiffre_affaires_millions: typeof ca === "number" ? ca : null,
    };
  }
  for (const [cle, valeur] of Object.entries(corps.profil ?? {})) {
    if (valeur !== undefined) (profil as unknown as Record<string, unknown>)[cle] = valeur;
  }
  const r = await db.query(
    `SELECT ${COLONNES} FROM guichets_financement ORDER BY lower(nom), id LIMIT $1`,
    [PLAFOND_RAPPROCHEMENT + 1],
  );
  const tronque = r.rows.length > PLAFOND_RAPPROCHEMENT;
  const guichets = (r.rows as Guichet[]).slice(0, PLAFOND_RAPPROCHEMENT);
  const moteur: GuichetFinancement[] = guichets.map((g) => ({
    id: g.id,
    nom: g.nom,
    type: g.type as GuichetFinancement["type"],
    pays: g.pays,
    secteurs: g.secteurs,
    filieres: g.filieres,
    tailles: g.tailles,
    objets: g.objets as GuichetFinancement["objets"],
    devises: g.devises as GuichetFinancement["devises"],
    montant_min: g.montant_min,
    montant_max: g.montant_max,
    devise_montant: g.devise_montant as GuichetFinancement["devise_montant"],
    date_limite: g.date_limite,
    actif: g.actif,
  }));
  const parId = new Map(guichets.map((g) => [g.id, g]));
  const resultats = rapprocherGuichets(moteur, profil, date).map((x) => {
    const g = parId.get(x.guichet_id) as Guichet;
    return {
      guichet: {
        id: g.id,
        nom: g.nom,
        type: g.type,
        description: g.description,
        url: g.url,
        date_limite: g.date_limite,
      },
      statut: x.statut,
      score: x.score,
      criteres: x.criteres,
      raisons_exclusion: x.raisons_exclusion,
    };
  });
  return {
    profil_utilise: profil,
    dossier,
    resultats,
    tronque,
    avertissement: AVERTISSEMENT_RAPPROCHEMENT,
  };
}
