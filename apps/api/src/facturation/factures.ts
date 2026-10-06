import {
  ajouterJours,
  calculerFacture,
  creerAvoir,
  montant as montantMoteur,
  type Devise,
  type FactureCalculee,
  type LigneFacture,
  type Remise,
  type RoleApprobateur,
} from "@missionpilot/engines";
import type { NatureFacture, StatutFacture } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import { aujourdhui, nombre } from "../missions/outils.js";
import { lireParametresFacturation, raisonSocialeEmetteur } from "./parametres.js";
import { missionVisibleOuNull, plusExigeant, roleSelonSeuils } from "./outils.js";

/*
 * RÈGLES DE FACTURATION (FIN-07, FIN-15), testées dans test/factures.test.ts
 *
 * - Montants : calculés EXCLUSIVEMENT par le moteur (calculerFacture,
 *   creerAvoir) depuis les lignes enregistrées, puis stockés ; l'API ne fait
 *   aucune arithmétique sur un montant.
 * - Un brouillon naît d'échéances « à facturer » et de débours refacturables
 *   validés de la mission ; chacun n'est rattaché qu'à une facture en cours
 *   (index unique sur facturation_liens).
 * - Circuit : brouillon → a_approuver (rôle exigé calculé par les seuils du
 *   moteur sur le HT et sur les remises) → approuvee (associé, ou directeur
 *   désigné de la mission si le palier le permet ; jamais l'auteur ni le
 *   soumetteur, sauf associé) → emise (numéro continu, mentions figées).
 * - Une facture émise ne change plus (déclencheur SQL) ; un avoir total
 *   (creerAvoir) l'annule à son émission et libère ses échéances et débours.
 */

export interface FactureDb {
  id: string;
  nature: NatureFacture;
  facture_origine_id: string | null;
  mission_id: string;
  client_id: string;
  devise: Devise;
  statut: StatutFacture;
  objet: string | null;
  motif: string | null;
  numero: string | null;
  date_emission: string | null;
  date_echeance: string | null;
  delai_paiement_jours: number;
  remise_globale_type: "pourcentage" | "montant" | null;
  remise_globale_valeur: number | null;
  retenue_active: boolean;
  retenue_taux: number;
  retenue_base: "HT" | "TTC";
  retenue_libelle: string;
  role_approbateur: RoleApprobateur | null;
  cree_par: string;
  soumise_par: string | null;
  mentions: Record<string, unknown> | null;
  envoyee_le: string | null;
  [cle: string]: unknown;
}

export interface LigneDb {
  id: string;
  ordre: number;
  origine: "echeance" | "debours";
  echeance_id: string | null;
  debours_id: string | null;
  libelle: string;
  quantite: number;
  prix_unitaire: number;
  taux_tva: number;
  remise_type: "pourcentage" | "montant" | null;
  remise_valeur: number | null;
  montant_brut: number;
  remise_ligne: number;
  part_remise_globale: number;
  montant_ht: number;
}

const MONTANTS = [
  "total_brut",
  "total_remises",
  "total_ht",
  "total_tva",
  "total_ttc",
  "total_retenues",
  "net_a_payer",
] as const;

export const COLONNES_FACTURE = `f.id, f.nature, f.facture_origine_id, f.mission_id,
  m.intitule AS mission_intitule, f.client_id, cl.raison_sociale AS client_raison_sociale, f.devise,
  f.statut, f.objet, f.motif, f.numero, f.exercice, f.sequence, f.date_emission::text AS date_emission,
  f.date_echeance::text AS date_echeance, f.delai_paiement_jours, f.remise_globale_type,
  f.remise_globale_valeur::float8 AS remise_globale_valeur, f.retenue_active,
  f.retenue_taux::float8 AS retenue_taux, f.retenue_base, f.retenue_libelle, f.total_brut,
  f.total_remises, f.total_ht, f.total_tva, f.total_ttc, f.total_retenues, f.net_a_payer, f.tva,
  f.retenues, f.role_approbateur, f.motif_rejet, f.soumise_par, f.soumise_le, f.approuvee_par,
  f.approuvee_le, f.emise_par, f.emise_le, f.mentions, f.envoyee_le, f.annulee_le,
  f.annulee_par_avoir_id, f.cree_par, f.cree_le, f.modifie_le`;
export const DEPUIS_FACTURE = `factures f JOIN missions m ON m.id = f.mission_id
  JOIN clients cl ON cl.id = f.client_id`;

const COLONNES_LIGNE = `id, ordre, origine, echeance_id, debours_id, libelle, quantite::float8 AS quantite,
  prix_unitaire, taux_tva::float8 AS taux_tva, remise_type, remise_valeur::float8 AS remise_valeur,
  montant_brut, remise_ligne, part_remise_globale, montant_ht`;

function versFacture(r: Record<string, unknown>): FactureDb {
  const f = { ...r } as Record<string, unknown>;
  for (const c of MONTANTS) f[c] = nombre(r[c]);
  return f as FactureDb;
}

export async function lireFacture(db: Db, id: string, verrouiller = false): Promise<FactureDb> {
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE} FROM ${DEPUIS_FACTURE} WHERE f.id = $1
     ${verrouiller ? "FOR UPDATE OF f" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Facture");
  return versFacture(r.rows[0]);
}

export async function lireLignes(db: Db, factureId: string): Promise<LigneDb[]> {
  const r = await db.query(
    `SELECT ${COLONNES_LIGNE} FROM facture_lignes WHERE facture_id = $1 ORDER BY ordre, id`,
    [factureId],
  );
  return r.rows.map((l) => ({
    ...l,
    prix_unitaire: nombre(l.prix_unitaire),
    montant_brut: nombre(l.montant_brut),
    remise_ligne: nombre(l.remise_ligne),
    part_remise_globale: nombre(l.part_remise_globale),
    montant_ht: nombre(l.montant_ht),
  })) as LigneDb[];
}

/**
 * Facture visible : sa mission est visible (missions/acces.ts), sinon 404.
 * `verrouiller` verrouille la mission puis la facture (ordre constant).
 */
export async function exigerFactureVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<{ facture: FactureDb; mission: MissionAcces }> {
  const lue = await lireFacture(db, id);
  const mission = await missionVisibleOuNull(db, auth, lue.mission_id);
  if (!mission) throw introuvable("Facture");
  return { facture: verrouiller ? await lireFacture(db, id, true) : lue, mission };
}

/* ----- Calcul par le moteur ----- */

function remiseMoteur(
  type: "pourcentage" | "montant" | null,
  valeur: number | null,
  devise: Devise,
): Remise | undefined {
  if (type === null || valeur === null) return undefined;
  return type === "pourcentage"
    ? { type: "pourcentage", pourcentage: valeur }
    : { type: "montant", montant: montantMoteur(valeur, devise) };
}

/** Facture calculée par le moteur depuis ses lignes et ses paramètres. */
export function calculer(f: FactureDb, lignes: readonly LigneDb[]): FactureCalculee {
  const remiseGlobale = remiseMoteur(f.remise_globale_type, f.remise_globale_valeur, f.devise);
  return calculerFacture({
    devise: f.devise,
    lignes: lignes.map((l): LigneFacture => {
      const remise = remiseMoteur(l.remise_type, l.remise_valeur, f.devise);
      return {
        libelle: l.libelle,
        quantite: l.quantite,
        prixUnitaire: montantMoteur(l.prix_unitaire, f.devise),
        tauxTva: l.taux_tva,
        ...(remise ? { remise } : {}),
      };
    }),
    ...(remiseGlobale ? { remiseGlobale } : {}),
    retenues:
      f.retenue_active && f.retenue_taux > 0
        ? [{ libelle: f.retenue_libelle, taux: f.retenue_taux, base: f.retenue_base }]
        : [],
  });
}

/** Enregistre les totaux et les montants de ligne calculés par le moteur. */
async function enregistrerCalcul(
  db: Db,
  factureId: string,
  lignes: readonly LigneDb[],
  c: FactureCalculee,
): Promise<void> {
  await db.query(
    `UPDATE factures SET total_brut = $2, total_remises = $3, total_ht = $4, total_tva = $5,
       total_ttc = $6, total_retenues = $7, net_a_payer = $8, tva = $9, retenues = $10,
       modifie_le = now()
     WHERE id = $1`,
    [
      factureId,
      c.totalBrut.valeur,
      c.totalRemises.valeur,
      c.totalHT.valeur,
      c.totalTva.valeur,
      c.totalTTC.valeur,
      c.totalRetenues.valeur,
      c.netAPayer.valeur,
      JSON.stringify(
        c.tva.map((t) => ({ taux: t.taux, base: t.base.valeur, montant: t.montant.valeur })),
      ),
      JSON.stringify(
        c.retenues.map((r) => ({
          libelle: r.libelle,
          taux: r.taux,
          base: r.base,
          assiette: r.assiette.valeur,
          montant: r.montant.valeur,
        })),
      ),
    ],
  );
  for (const [i, l] of lignes.entries()) {
    const calc = c.lignes[i];
    if (!calc) continue;
    await db.query(
      `UPDATE facture_lignes SET montant_brut = $2, remise_ligne = $3, part_remise_globale = $4,
         montant_ht = $5 WHERE id = $1`,
      [
        l.id,
        calc.montantBrut.valeur,
        calc.remiseLigne.valeur,
        calc.partRemiseGlobale.valeur,
        calc.montantHT.valeur,
      ],
    );
  }
}

/** Recalcule (moteur) et enregistre une facture en brouillon. */
export async function recalculer(db: Db, factureId: string): Promise<void> {
  const f = await lireFacture(db, factureId);
  if (f.nature !== "facture") return;
  const lignes = await lireLignes(db, factureId);
  await enregistrerCalcul(db, factureId, lignes, calculer(f, lignes));
}

/* ----- Création d'un brouillon ----- */

export interface DemandeBrouillon {
  echeance_ids: string[];
  debours_ids: string[];
  objet?: string | null;
}

const MESSAGE_DEJA = "Un élément est déjà rattaché à une facture en cours.";

/**
 * Brouillon depuis des échéances « à facturer » et des débours refacturables
 * validés de la mission (verrouillée par l'appelant). Taux de TVA par défaut
 * du cabinet (débours : taux des débours), retenue selon les paramètres.
 */
export async function creerBrouillon(
  db: Db,
  auth: Pick<Auth, "cabinetId" | "utilisateurId">,
  mission: MissionAcces,
  demande: DemandeBrouillon,
): Promise<string> {
  const client = await db.query("SELECT actif FROM clients WHERE id = $1", [mission.client_id]);
  if (!client.rows[0]?.actif) throw conflit("Le client de la mission est archivé.");
  const p = await lireParametresFacturation(db, auth.cabinetId);
  const echeances = await db.query(
    `SELECT e.id, e.libelle, e.montant, e.statut,
       EXISTS (SELECT 1 FROM facturation_liens l WHERE l.echeance_id = e.id AND l.libere_le IS NULL) AS liee
     FROM echeances_facturation e
     WHERE e.id = ANY ($1::uuid[]) AND e.mission_id = $2
     ORDER BY e.date_prevue, e.ordre, e.id FOR UPDATE OF e`,
    [demande.echeance_ids, mission.id],
  );
  if (echeances.rowCount !== demande.echeance_ids.length) {
    throw requeteInvalide("Échéance inconnue dans cette mission.");
  }
  for (const e of echeances.rows) {
    if (e.statut !== "a_facturer") {
      throw conflit(`L'échéance « ${e.libelle as string} » n'est pas à facturer.`);
    }
    if (e.liee) throw conflit(MESSAGE_DEJA);
  }
  const debours = await db.query(
    `SELECT d.id, d.libelle, d.montant, d.statut, d.refacturable, d.devise,
       EXISTS (SELECT 1 FROM facturation_liens l WHERE l.debours_id = d.id AND l.libere_le IS NULL) AS lie
     FROM debours d WHERE d.id = ANY ($1::uuid[]) AND d.mission_id = $2
     ORDER BY d.date, d.id FOR UPDATE OF d`,
    [demande.debours_ids, mission.id],
  );
  if (debours.rowCount !== demande.debours_ids.length) {
    throw requeteInvalide("Débours inconnu dans cette mission.");
  }
  for (const d of debours.rows) {
    if (d.statut !== "valide" || !d.refacturable) {
      throw conflit(
        `Le débours « ${d.libelle as string} » n'est pas un débours refacturable validé.`,
      );
    }
    if (d.devise !== mission.devise) throw conflit("Débours dans une autre devise que la mission.");
    if (d.lie) throw conflit(MESSAGE_DEJA);
  }
  const f = await db.query(
    `INSERT INTO factures (cabinet_id, nature, mission_id, client_id, devise, objet,
       delai_paiement_jours, retenue_active, retenue_taux, retenue_base, retenue_libelle, cree_par)
     VALUES ($1, 'facture', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      auth.cabinetId,
      mission.id,
      mission.client_id,
      mission.devise,
      demande.objet ?? null,
      p.delai_paiement_jours,
      p.retenue_active,
      p.retenue_taux,
      p.retenue_base,
      p.retenue_libelle,
      auth.utilisateurId,
    ],
  );
  const factureId = f.rows[0].id as string;
  let ordre = 0;
  const elements = [
    ...echeances.rows.map((e) => ({
      origine: "echeance",
      echeance_id: e.id as string,
      debours_id: null,
      libelle: e.libelle as string,
      prix: nombre(e.montant),
      tva: p.taux_tva_defaut,
    })),
    ...debours.rows.map((d) => ({
      origine: "debours",
      echeance_id: null,
      debours_id: d.id as string,
      libelle: `Débours — ${d.libelle as string}`.slice(0, 300),
      prix: nombre(d.montant),
      tva: p.taux_tva_debours,
    })),
  ];
  for (const e of elements) {
    ordre += 1;
    await db.query(
      `INSERT INTO facture_lignes (cabinet_id, facture_id, mission_id, ordre, origine, echeance_id,
         debours_id, libelle, quantite, prix_unitaire, taux_tva)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10)`,
      [
        auth.cabinetId,
        factureId,
        mission.id,
        ordre,
        e.origine,
        e.echeance_id,
        e.debours_id,
        e.libelle,
        e.prix,
        e.tva,
      ],
    );
    await traduireErreursPg(
      db.query(
        `INSERT INTO facturation_liens (cabinet_id, facture_id, mission_id, echeance_id, debours_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [auth.cabinetId, factureId, mission.id, e.echeance_id, e.debours_id],
      ),
      { "*": MESSAGE_DEJA },
    );
  }
  await recalculer(db, factureId);
  return factureId;
}

/* ----- Avoir ----- */

/**
 * Avoir total d'une facture émise (moteur : creerAvoir sur la facture
 * recalculée), en brouillon, lié à la facture d'origine. Jamais d'avoir
 * d'avoir (moteur et API), un seul avoir par facture (index unique).
 */
export async function creerAvoirBrouillon(
  db: Db,
  auth: Pick<Auth, "cabinetId" | "utilisateurId">,
  origine: FactureDb,
  motif: string,
): Promise<string> {
  if (origine.nature !== "facture") {
    throw new AppError(
      400,
      "AVOIR_INVALIDE",
      "Un avoir ne peut pas lui-même être annulé par avoir.",
    );
  }
  if (origine.statut !== "emise") throw conflit("Seule une facture émise s'annule par avoir.");
  const lignes = await lireLignes(db, origine.id);
  const avoir = creerAvoir(calculer(origine, lignes));
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO factures (cabinet_id, nature, facture_origine_id, mission_id, client_id, devise,
         objet, motif, delai_paiement_jours, retenue_active, retenue_taux, retenue_base,
         retenue_libelle, cree_par)
       VALUES ($1, 'avoir', $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12) RETURNING id`,
      [
        auth.cabinetId,
        origine.id,
        origine.mission_id,
        origine.client_id,
        origine.devise,
        `Avoir sur la facture ${origine.numero ?? ""}`.slice(0, 300),
        motif,
        origine.retenue_active,
        origine.retenue_taux,
        origine.retenue_base,
        origine.retenue_libelle,
        auth.utilisateurId,
      ],
    ),
    { "*": "Cette facture a déjà un avoir." },
  );
  const avoirId = r.rows[0].id as string;
  for (const [i, l] of lignes.entries()) {
    const c = avoir.lignes[i];
    if (!c) continue;
    await db.query(
      `INSERT INTO facture_lignes (cabinet_id, facture_id, mission_id, ordre, origine, echeance_id,
         debours_id, libelle, quantite, prix_unitaire, taux_tva, remise_type, remise_valeur,
         montant_brut, remise_ligne, part_remise_globale, montant_ht)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        auth.cabinetId,
        avoirId,
        origine.mission_id,
        l.ordre,
        l.origine,
        l.echeance_id,
        l.debours_id,
        l.libelle,
        c.quantite,
        c.prixUnitaire.valeur,
        c.tauxTva,
        l.remise_type,
        l.remise_valeur,
        c.montantBrut.valeur,
        c.remiseLigne.valeur,
        c.partRemiseGlobale.valeur,
        c.montantHT.valeur,
      ],
    );
  }
  await enregistrerCalcul(db, avoirId, [], avoir);
  return avoirId;
}

/* ----- Approbation (FIN-15) ----- */

/**
 * Rôle exigé : le plus exigeant des paliers « facture » (sur le HT) et
 * « remise » (sur le total des remises), par le moteur, après conversion au
 * taux figé (voir conversionSeuils : associé si aucun taux n'est connu).
 */
export function roleApprobationFacture(c: FactureCalculee, mission: MissionAcces): RoleApprobateur {
  const roles: RoleApprobateur[] = [roleSelonSeuils("facture", c.totalHT, mission)];
  if (c.totalRemises.valeur !== 0) roles.push(roleSelonSeuils("remise", c.totalRemises, mission));
  return plusExigeant(roles);
}

/** Calcul de la facture tel qu'enregistré (avoir : opposé de la facture d'origine). */
export async function calculEnregistre(db: Db, f: FactureDb): Promise<FactureCalculee> {
  if (f.nature === "facture") return calculer(f, await lireLignes(db, f.id));
  const origine = await lireFacture(db, f.facture_origine_id as string);
  return creerAvoir(calculer(origine, await lireLignes(db, origine.id)));
}

/* ----- Émission : numéro continu et mentions figées ----- */

export async function mentionsAFiger(
  db: Db,
  cabinetId: string,
  f: FactureDb,
): Promise<Record<string, unknown>> {
  const p = await lireParametresFacturation(db, cabinetId);
  const raisonSociale = await raisonSocialeEmetteur(db, cabinetId, p);
  const client = await db.query(
    `SELECT raison_sociale, forme_juridique, rccm, compte_contribuable, adresse, pays
     FROM clients WHERE id = $1`,
    [f.client_id],
  );
  const mission = await db.query("SELECT intitule FROM missions WHERE id = $1", [f.mission_id]);
  const origine = f.facture_origine_id
    ? await db.query(
        "SELECT numero, date_emission::text AS date_emission FROM factures WHERE id = $1",
        [f.facture_origine_id],
      )
    : null;
  return {
    emetteur: {
      raison_sociale: raisonSociale,
      forme_juridique: p.forme_juridique,
      rccm: p.rccm,
      compte_contribuable: p.compte_contribuable,
      regime_fiscal: p.regime_fiscal,
      adresse: p.adresse,
      telephone: p.telephone,
      email: p.email,
      banque: p.banque,
      iban: p.iban,
      autres_coordonnees: p.autres_coordonnees,
      mentions_complementaires: p.mentions_complementaires,
    },
    client: client.rows[0] ?? null,
    mission: { intitule: mission.rows[0]?.intitule ?? null },
    ...(origine ? { facture_origine: origine.rows[0] ?? null } : {}),
  };
}

/**
 * Émet une facture ou un avoir approuvé (verrouillé par l'appelant) :
 * mentions légales obligatoires, numéro continu par nature et exercice (ligne
 * de séquence verrouillée FOR UPDATE, incrément de un, consommé seulement si
 * la transaction aboutit), date d'échéance, snapshot des mentions. Un avoir
 * annule sa facture d'origine et libère ses échéances et débours.
 */
export async function emettre(
  db: Db,
  auth: Pick<Auth, "cabinetId" | "utilisateurId">,
  f: FactureDb,
): Promise<void> {
  if (f.statut !== "approuvee") throw conflit("Seule une facture approuvée s'émet.");
  const p = await lireParametresFacturation(db, auth.cabinetId);
  const manquantes = (["rccm", "compte_contribuable", "adresse"] as const).filter((c) => !p[c]);
  if (manquantes.length > 0) {
    throw new AppError(
      409,
      "MENTIONS_INCOMPLETES",
      `Mentions légales du cabinet à compléter avant émission : ${manquantes.join(", ")}.`,
    );
  }
  let origine: FactureDb | null = null;
  if (f.nature === "avoir") {
    origine = await lireFacture(db, f.facture_origine_id as string, true);
    if (origine.statut !== "emise") throw conflit("La facture d'origine n'est plus émise.");
  }
  const date = aujourdhui();
  const exercice = Number(date.slice(0, 4));
  await db.query(
    `INSERT INTO sequences_facturation (cabinet_id, nature, exercice) VALUES ($1, $2, $3)
     ON CONFLICT (cabinet_id, nature, exercice) DO NOTHING`,
    [auth.cabinetId, f.nature, exercice],
  );
  const s = await db.query(
    `SELECT dernier FROM sequences_facturation WHERE cabinet_id = $1 AND nature = $2 AND exercice = $3
     FOR UPDATE`,
    [auth.cabinetId, f.nature, exercice],
  );
  const sequence = Number(s.rows[0].dernier) + 1;
  await db.query(
    `UPDATE sequences_facturation SET dernier = $4
     WHERE cabinet_id = $1 AND nature = $2 AND exercice = $3`,
    [auth.cabinetId, f.nature, exercice, sequence],
  );
  const prefixe = f.nature === "avoir" ? p.prefixe_avoir : p.prefixe_facture;
  const numero = `${prefixe}-${exercice}-${String(sequence).padStart(p.chiffres_numero, "0")}`;
  const mentions = await mentionsAFiger(db, auth.cabinetId, f);
  await traduireErreursPg(
    db.query(
      `UPDATE factures SET statut = 'emise', numero = $2, exercice = $3, sequence = $4,
         date_emission = $5, date_echeance = $6, mentions = $7, emise_par = $8, emise_le = now(),
         modifie_le = now()
       WHERE id = $1`,
      [
        f.id,
        numero,
        exercice,
        sequence,
        date,
        ajouterJours(date, f.delai_paiement_jours),
        JSON.stringify(mentions),
        auth.utilisateurId,
      ],
    ),
    { "*": "Numéro de facture déjà attribué : changer le préfixe de numérotation." },
  );
  if (f.nature === "facture") {
    await db.query(
      `UPDATE echeances_facturation SET statut = 'facturee', modifie_le = now()
       WHERE id IN (SELECT echeance_id FROM facturation_liens
                    WHERE facture_id = $1 AND libere_le IS NULL AND echeance_id IS NOT NULL)`,
      [f.id],
    );
    return;
  }
  const o = origine as FactureDb;
  await db.query(
    `UPDATE factures SET statut = 'annulee', annulee_le = now(), annulee_par_avoir_id = $2
     WHERE id = $1`,
    [o.id, f.id],
  );
  const liberes = await db.query(
    `UPDATE facturation_liens SET libere_le = now() WHERE facture_id = $1 AND libere_le IS NULL
     RETURNING echeance_id`,
    [o.id],
  );
  const echeances = liberes.rows.map((l) => l.echeance_id).filter((x) => x !== null);
  if (echeances.length > 0) {
    await db.query(
      `UPDATE echeances_facturation SET statut = 'a_facturer', modifie_le = now()
       WHERE id = ANY ($1::uuid[])`,
      [echeances],
    );
  }
}

/* ----- Vue ----- */

export function vueFacture(f: FactureDb, lignes?: readonly LigneDb[]): Record<string, unknown> {
  return { ...f, ...(lignes ? { lignes } : {}) };
}
