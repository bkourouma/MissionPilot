import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  ErreurCanaux,
  estNumeroDeTest,
  masquerNumero,
  normaliserNumero,
} from "@missionpilot/engines";
import {
  PLAFONDS_CANAUX,
  type CanalMessagerie,
  type ConsentementCourantCanal,
  type SourceConsentement,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Trousseau } from "../auth/chiffrement.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import {
  consentementsCourants,
  retirerConsentement,
  verrouillerDestinataire,
  type ConsentementEtat,
} from "./consentements.js";
import {
  canalNonActif,
  codeExpire,
  codeInvalide,
  numeroInvalide,
  numeroReelRefuse,
  tropDeTentativesCode,
} from "./erreurs.js";
import { mettreEnFileEnvoi } from "./envois.js";
import { aadNumero, chiffrerNumero, empreinteCode, empreintesToutesVersions } from "./numeros.js";
import type { Canaux } from "./ports.js";

/*
 * Destinataires : un numéro PAR UTILISATEUR ET PAR CANAL (SPEC-3c §6.2, §7.2). Seuls ce fichier et
 * `envois.ts` lisent `numero_chiffre` et `numero_empreinte` : le numéro n'est dans aucune réponse
 * (masque seulement), aucun journal, aucune erreur. Le numéro est refusé hors de la plage de test
 * tant qu'un fournisseur simulé est actif (aucune donnée réelle de personne n'entre).
 */

/** Codes de vérification par utilisateur et par 24 h, tous canaux confondus (à valider). */
export const CODES_PAR_JOUR_ET_UTILISATEUR = 10;

export interface DependancesDestinataires {
  trousseau: Trousseau;
  canaux: Canaux;
}

export interface ActeurCanal {
  cabinetId: string;
  utilisateurId: string;
}

const portDuCanal = (canaux: Canaux, canal: CanalMessagerie) =>
  canal === "whatsapp" ? canaux.whatsapp : canaux.sms;

export interface DestinataireVue {
  id: string;
  utilisateur_id: string;
  canal: CanalMessagerie;
  numero_masque: string;
  verifie: boolean;
}

interface LigneDestinataire {
  id: string;
  utilisateur_id: string;
  canal: CanalMessagerie;
  numero_masque: string;
  numero_empreinte: string;
  empreinte_cle_version: number;
  verifie_le: Date | null;
  code_empreinte: string | null;
  code_expire_le: Date | null;
  code_essais: number;
}

const COLONNES = `id, utilisateur_id, canal, numero_masque, numero_empreinte,
  empreinte_cle_version::int AS empreinte_cle_version, verifie_le, code_empreinte, code_expire_le,
  code_essais::int AS code_essais`;

const vue = (l: LigneDestinataire): DestinataireVue => ({
  id: l.id,
  utilisateur_id: l.utilisateur_id,
  canal: l.canal,
  numero_masque: l.numero_masque,
  verifie: l.verifie_le !== null,
});

/**
 * Normalise le numéro saisi et refuse un numéro réel tant que le fournisseur du canal est simulé.
 * Le numéro n'est jamais cité dans l'erreur.
 */
export function numeroAcceptable(canaux: Canaux, canal: CanalMessagerie, saisi: string): string {
  const port = portDuCanal(canaux, canal);
  if (!port) throw canalNonActif();
  let numero: string;
  try {
    numero = normaliserNumero(saisi);
  } catch (error) {
    if (error instanceof ErreurCanaux) throw numeroInvalide();
    throw error;
  }
  if (port.mode === "simule" && !estNumeroDeTest(numero)) throw numeroReelRefuse();
  return numero;
}

/**
 * Utilisateur du portail dont le cabinet gère le numéro : dirigeant ou contributeur ACTIF, rattaché
 * à un client ACTIF ; sinon 404 (comme un utilisateur d'un autre cabinet).
 */
export async function exigerUtilisateurClient(
  db: Db,
  utilisateurId: string,
): Promise<{ id: string; nom: string; client_id: string }> {
  const r = await db.query(
    `SELECT u.id, u.nom, up.client_id FROM utilisateurs u
     JOIN utilisateurs_portail up ON up.utilisateur_id = u.id AND up.statut = 'actif'
     JOIN clients c ON c.id = up.client_id AND c.actif
     WHERE u.id = $1 AND u.actif AND u.roles && ARRAY['client_dirigeant', 'client_contributeur']`,
    [utilisateurId],
  );
  if (!r.rows[0]) throw introuvable("Utilisateur");
  return r.rows[0] as { id: string; nom: string; client_id: string };
}

/** Compte actif du canal du cabinet ; 409 `CANAL_NON_ACTIF` sinon. */
async function exigerCompteActif(db: Db, canal: CanalMessagerie): Promise<void> {
  const r = await db.query("SELECT actif FROM canaux_comptes WHERE canal = $1", [canal]);
  if (r.rows[0]?.actif !== true) throw canalNonActif();
}

/**
 * Au plus 3 codes de vérification par heure et par destinataire (429 `TROP_DE_TENTATIVES`), comptés
 * sur `canaux_envois` sous le verrou `canal_debit:<destinataire>`. Accès COMPLET requis (la table est
 * fermée au contexte du portail) : à appeler hors de ce contexte.
 */
async function verifierPlafondCodes(
  db: Db,
  destinataireId: string,
  maintenant: Date,
): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `canal_debit:${destinataireId}`,
  ]);
  const recents = await db.query(
    `SELECT count(*)::int AS n FROM canaux_envois
     WHERE destinataire_id = $1 AND categorie = 'verification'
       AND cree_le > $2::timestamptz - interval '1 hour'`,
    [destinataireId, maintenant],
  );
  if ((recents.rows[0].n as number) >= PLAFONDS_CANAUX.codesParHeure) throw tropDeTentativesCode();
  // Et au plus CODES_PAR_JOUR_ET_UTILISATEUR par utilisateur sur 24 h, tous canaux confondus (un
  // changement de numéro répété ne contourne pas le plafond horaire d'un destinataire). Verrou propre à
  // l'utilisateur : deux canaux simultanés ne dépassent pas le plafond.
  const proprietaire = await db.query(
    "SELECT utilisateur_id FROM canaux_destinataires WHERE id = $1",
    [destinataireId],
  );
  const utilisateurId = proprietaire.rows[0]?.utilisateur_id as string | undefined;
  if (!utilisateurId) return;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `canal_debit_code_jour:${utilisateurId}`,
  ]);
  const jour = await db.query(
    `SELECT count(*)::int AS n FROM canaux_envois e
     JOIN canaux_destinataires d ON d.id = e.destinataire_id
     WHERE d.utilisateur_id = $1 AND e.categorie = 'verification'
       AND e.cree_le > $2::timestamptz - interval '24 hours'`,
    [utilisateurId, maintenant],
  );
  if ((jour.rows[0].n as number) >= CODES_PAR_JOUR_ET_UTILISATEUR) throw tropDeTentativesCode();
}

/**
 * Contrôles AVANT d'écrire un numéro, avec accès complet (hors contexte du portail) : canal disponible,
 * numéro valide et de test (fournisseur simulé), compte activé, plafond de codes. Renvoie le numéro
 * normalisé (E.164, en mémoire seulement).
 */
export async function controlerAvantNumero(
  db: Db,
  deps: DependancesDestinataires,
  p: { utilisateurId: string; canal: CanalMessagerie; numeroSaisi: string; maintenant: Date },
): Promise<string> {
  const numero = numeroAcceptable(deps.canaux, p.canal, p.numeroSaisi);
  await exigerCompteActif(db, p.canal);
  const existant = await db.query(
    "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2",
    [p.utilisateurId, p.canal],
  );
  if (existant.rows[0]) await verifierPlafondCodes(db, existant.rows[0].id as string, p.maintenant);
  return numero;
}

/**
 * Écrit le numéro d'un utilisateur pour un canal (création ou changement) et prépare le code de
 * vérification (empreinte HMAC en base). Un changement de numéro retire le consentement
 * (`changement_numero`), remet `verifie_le` à nul (MPH12) et efface le code ; le même numéro déjà
 * vérifié ne change rien et n'émet aucun code. N'utilise que des tables écrites par le portail
 * (destinataires, consentements, journal) : utilisable dans le contexte du portail, pour SA ligne.
 * Renvoie le code EN CLAIR (mémoire seulement) à mettre en file par `planifierCode`.
 */
export async function ecrireNumero(
  db: Db,
  deps: DependancesDestinataires,
  p: {
    acteur: ActeurCanal;
    utilisateurId: string;
    canal: CanalMessagerie;
    numero: string;
    maintenant: Date;
  },
): Promise<{ destinataire: DestinataireVue; code: string | null; numero_change: boolean }> {
  const { trousseau } = deps;
  const { numero } = p;
  const cabinetId = p.acteur.cabinetId;
  const empreintes = empreintesToutesVersions(trousseau, cabinetId, p.canal, numero);
  const courante = empreintes.find((e) => e.version === trousseau.versionActuelle);
  if (!courante) throw new Error("Version de clé actuelle absente du trousseau.");
  const aad = aadNumero(cabinetId, p.utilisateurId, p.canal);

  const existant = await db.query(
    `SELECT ${COLONNES} FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2 FOR UPDATE`,
    [p.utilisateurId, p.canal],
  );
  const ligne = existant.rows[0] as LigneDestinataire | undefined;
  // Aucun contrôle de doublon ici (audit de sécurité, M5) : enregistrer un numéro déjà VÉRIFIÉ par une
  // autre personne réussit comme tout enregistrement et ne révèle rien. L'unicité (index partiel sur
  // les numéros vérifiés, `0541`) se tranche à la vérification du code, qui échoue sans détail.

  let id: string;
  let numeroChange = false;
  let codeNecessaire = true;
  if (!ligne) {
    const chiffre = chiffrerNumero(trousseau, numero, aad);
    const r = await db.query(
      `INSERT INTO canaux_destinataires
         (cabinet_id, utilisateur_id, canal, numero_chiffre, numero_cle_version, numero_empreinte,
          empreinte_cle_version, numero_masque)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLONNES}`,
      [
        cabinetId,
        p.utilisateurId,
        p.canal,
        chiffre.donnees,
        chiffre.version,
        courante.empreinte,
        courante.version,
        masquerNumero(numero),
      ],
    );
    id = (r.rows[0] as LigneDestinataire).id;
    numeroChange = true;
  } else {
    id = ligne.id;
    const meme = empreintes.some(
      (e) => e.empreinte === ligne.numero_empreinte && e.version === ligne.empreinte_cle_version,
    );
    if (meme) {
      codeNecessaire = ligne.verifie_le === null;
      if (ligne.empreinte_cle_version !== courante.version) {
        // Rotation de clé : numéro et empreinte réécrits avec la clé courante (vérification intacte).
        const chiffre = chiffrerNumero(trousseau, numero, aad);
        await db.query(
          `UPDATE canaux_destinataires SET numero_chiffre = $2, numero_cle_version = $3,
             numero_empreinte = $4, empreinte_cle_version = $5 WHERE id = $1`,
          [id, chiffre.donnees, chiffre.version, courante.empreinte, courante.version],
        );
      }
    } else {
      numeroChange = true;
      const chiffre = chiffrerNumero(trousseau, numero, aad);
      await retirerConsentement(db, {
        cabinetId,
        destinataireId: id,
        canal: p.canal,
        source: "changement_numero",
        acteurId: p.acteur.utilisateurId,
      });
      await db.query(
        `UPDATE canaux_destinataires SET numero_chiffre = $2, numero_cle_version = $3,
           numero_empreinte = $4, empreinte_cle_version = $5, numero_masque = $6 WHERE id = $1`,
        [
          id,
          chiffre.donnees,
          chiffre.version,
          courante.empreinte,
          courante.version,
          masquerNumero(numero),
        ],
      );
    }
  }
  await journaliser(db, {
    cabinetId,
    utilisateurId: p.acteur.utilisateurId,
    action: "canal.destinataire.enregistrer",
    entite: "canal_destinataire",
    entiteId: id,
    details: { canal: p.canal, masque: masquerNumero(numero), utilisateur_id: p.utilisateurId },
  });
  let code: string | null = null;
  if (codeNecessaire) {
    // Code à six chiffres (10 minutes, 5 essais) : conservé en empreinte HMAC seulement.
    code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.query(
      `UPDATE canaux_destinataires SET code_empreinte = $2, code_expire_le = $3, code_essais = 0
       WHERE id = $1`,
      [
        id,
        empreinteCode(trousseau, trousseau.versionActuelle, id, code),
        new Date(p.maintenant.getTime() + PLAFONDS_CANAUX.codeValiditeMinutes * 60_000),
      ],
    );
  }
  const finale = await db.query(`SELECT ${COLONNES} FROM canaux_destinataires WHERE id = $1`, [id]);
  return {
    destinataire: vue(finale.rows[0] as LigneDestinataire),
    code,
    numero_change: numeroChange,
  };
}

/**
 * Met en file le message de vérification (catégorie `verification` : aucun consentement exigé),
 * avec accès COMPLET (table des jobs fermée au portail : hors de son contexte). Le code ne figure ni
 * en clair en base (variables chiffrées dans la charge du job) ni dans une réponse ou un journal.
 */
export async function planifierCode(
  db: Db,
  deps: DependancesDestinataires,
  p: {
    cabinetId: string;
    destinataireId: string;
    canal: CanalMessagerie;
    code: string;
    maintenant: Date;
  },
): Promise<void> {
  await verifierPlafondCodes(db, p.destinataireId, p.maintenant);
  await mettreEnFileEnvoi(db, deps.trousseau, {
    cabinetId: p.cabinetId,
    canal: p.canal,
    destinataireId: p.destinataireId,
    gabarit: "verification_numero",
    variables: [p.code],
    objetType: "verification",
    objetId: p.destinataireId,
    cle: `verif:${p.destinataireId}:${randomUUID()}`,
    maintenant: p.maintenant,
  });
}

export type ResultatVerification =
  { statut: "verifie" } | { statut: "invalide"; essaisRestants: number } | { statut: "expire" };

/**
 * Vérifie le code saisi (temps constant). Trois états ; au 5e échec le code est invalidé. Renvoie un
 * état (jamais d'exception) pour que la transaction qui compte l'échec soit VALIDÉE ; la route lève
 * l'erreur d'API ensuite (`erreurDeVerification`).
 */
export async function verifierCodeNumero(
  db: Db,
  deps: DependancesDestinataires,
  p: {
    cabinetId: string;
    destinataireId: string;
    canal: CanalMessagerie;
    code: string;
    maintenant: Date;
    acteurId: string;
  },
): Promise<ResultatVerification> {
  const verrou = await verrouillerDestinataire(db, p.destinataireId, "UPDATE");
  if (!verrou) throw introuvable("Destinataire");
  const r = await db.query(`SELECT ${COLONNES} FROM canaux_destinataires WHERE id = $1`, [
    p.destinataireId,
  ]);
  const l = r.rows[0] as LigneDestinataire;
  if (l.verifie_le !== null) return { statut: "verifie" };
  if (
    !l.code_empreinte ||
    !l.code_expire_le ||
    l.code_expire_le.getTime() < p.maintenant.getTime()
  ) {
    if (l.code_empreinte) {
      await db.query(
        "UPDATE canaux_destinataires SET code_empreinte = NULL, code_expire_le = NULL, code_essais = 0 WHERE id = $1",
        [l.id],
      );
    }
    return { statut: "expire" };
  }
  const attendu = Buffer.from(l.code_empreinte, "hex");
  let bon = false;
  for (const version of deps.trousseau.versions()) {
    const calcule = Buffer.from(empreinteCode(deps.trousseau, version, l.id, p.code), "hex");
    if (calcule.length === attendu.length && timingSafeEqual(calcule, attendu)) bon = true;
  }
  if (bon) {
    // Un numéro déjà VÉRIFIÉ par une autre personne du cabinet ne se vérifie pas deux fois (index partiel
    // `0541`) : le conflit est absorbé par un point de sauvegarde, le code est effacé et la réponse est
    // celle d'un code épuisé (aucun détail sur l'autre titulaire, constat M5).
    await db.query("SAVEPOINT verification_numero");
    try {
      await db.query(
        `UPDATE canaux_destinataires SET verifie_le = $2, code_empreinte = NULL, code_expire_le = NULL,
           code_essais = 0 WHERE id = $1`,
        [l.id, p.maintenant],
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      await db.query("ROLLBACK TO SAVEPOINT verification_numero");
      await db.query(
        "UPDATE canaux_destinataires SET code_empreinte = NULL, code_expire_le = NULL, code_essais = 0 WHERE id = $1",
        [l.id],
      );
      return { statut: "invalide", essaisRestants: 0 };
    }
    await db.query("RELEASE SAVEPOINT verification_numero");
    await journaliser(db, {
      cabinetId: p.cabinetId,
      utilisateurId: p.acteurId,
      action: "canal.numero.verifie",
      entite: "canal_destinataire",
      entiteId: l.id,
      details: { canal: p.canal, masque: l.numero_masque },
    });
    return { statut: "verifie" };
  }
  const essais = l.code_essais + 1;
  if (essais >= PLAFONDS_CANAUX.codeEssaisMax) {
    await db.query(
      "UPDATE canaux_destinataires SET code_empreinte = NULL, code_expire_le = NULL, code_essais = 0 WHERE id = $1",
      [l.id],
    );
    return { statut: "invalide", essaisRestants: 0 };
  }
  await db.query("UPDATE canaux_destinataires SET code_essais = $2 WHERE id = $1", [l.id, essais]);
  return { statut: "invalide", essaisRestants: PLAFONDS_CANAUX.codeEssaisMax - essais };
}

/** Erreur d'API correspondant à un état de vérification non réussi (à lever APRÈS la transaction). */
export function erreurDeVerification(r: ResultatVerification): AppError | null {
  if (r.statut === "verifie") return null;
  if (r.statut === "expire") return codeExpire();
  return r.essaisRestants === 0
    ? new AppError(
        409,
        "CODE_INVALIDE",
        "Code incorrect : trop d'essais, demandez un nouveau code.",
      )
    : codeInvalide(r.essaisRestants);
}

/**
 * Prédicat SQL (alias `u` = utilisateurs) : la personne est ENCORE habilitée à écrire à son cabinet par
 * ce canal. Utilisateur actif ; si c'est une personne du portail (rôle client), rattachement
 * `utilisateurs_portail` ACTIF à un client ACTIF (un client archivé ou un compte désactivé ne saisit
 * plus rien). Source unique de la règle (constat I1 de l'audit de sécurité) : message entrant, saisie
 * de KPI, confirmation et job vocal l'appliquent tous.
 */
export const EXPEDITEUR_ACTIF_SQL = `(u.actif AND (
    NOT (u.roles && ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur'])
    OR EXISTS (SELECT 1 FROM utilisateurs_portail up JOIN clients c ON c.id = up.client_id
               WHERE up.utilisateur_id = u.id AND up.statut = 'actif' AND c.actif)))`;

/** État d'un expéditeur : habilité, personne inactive (compte, portail, client) ou numéro non vérifié. */
export type EtatExpediteur = "ok" | "expediteur_inactif" | "numero_non_verifie";

export function etatDeLigne(actif: boolean, verifie: boolean): EtatExpediteur {
  if (!actif) return "expediteur_inactif";
  return verifie ? "ok" : "numero_non_verifie";
}

/**
 * Expéditeur d'un message entrant : retrouvé par l'empreinte du numéro (TOUTES les versions de clé du
 * trousseau). L'empreinte trouvée sous une ancienne clé est réécrite avec la clé courante. Un numéro
 * vérifié prime sur un numéro non vérifié de même empreinte (l'unicité ne porte que sur les numéros
 * vérifiés). `etat` dit si l'expéditeur peut agir ; seul « STOP » s'exécute quel que soit l'état.
 */
export async function retrouverExpediteur(
  db: Db,
  trousseau: Trousseau,
  cabinetId: string,
  canal: CanalMessagerie,
  numero: string,
): Promise<{ id: string; utilisateur_id: string; verifie: boolean; etat: EtatExpediteur } | null> {
  const empreintes = empreintesToutesVersions(trousseau, cabinetId, canal, numero);
  const r = await db.query(
    `SELECT d.id, d.utilisateur_id, d.verifie_le, d.numero_empreinte,
            d.empreinte_cle_version::int AS version, ${EXPEDITEUR_ACTIF_SQL} AS actif
     FROM canaux_destinataires d JOIN utilisateurs u ON u.id = d.utilisateur_id
     WHERE d.canal = $1 AND d.numero_empreinte = ANY($2::text[])
     ORDER BY (d.verifie_le IS NULL), d.id LIMIT 1`,
    [canal, empreintes.map((e) => e.empreinte)],
  );
  const l = r.rows[0] as
    | {
        id: string;
        utilisateur_id: string;
        verifie_le: Date | null;
        numero_empreinte: string;
        version: number;
        actif: boolean;
      }
    | undefined;
  if (!l) return null;
  const courante = empreintes.find((e) => e.version === trousseau.versionActuelle);
  if (courante && courante.empreinte !== l.numero_empreinte) {
    await db.query(
      "UPDATE canaux_destinataires SET numero_empreinte = $2, empreinte_cle_version = $3 WHERE id = $1",
      [l.id, courante.empreinte, courante.version],
    );
  }
  const verifie = l.verifie_le !== null;
  return {
    id: l.id,
    utilisateur_id: l.utilisateur_id,
    verifie,
    etat: etatDeLigne(l.actif, verifie),
  };
}

/**
 * Habilitation ACTUELLE d'un destinataire (relue au moment d'agir : saisie, confirmation, job vocal
 * dont l'utilisateur a été figé à la mise en file). `null` si le destinataire n'existe pas.
 */
export async function etatDestinataire(
  db: Db,
  destinataireId: string,
): Promise<EtatExpediteur | null> {
  const r = await db.query(
    `SELECT d.verifie_le, ${EXPEDITEUR_ACTIF_SQL} AS actif
     FROM canaux_destinataires d JOIN utilisateurs u ON u.id = d.utilisateur_id WHERE d.id = $1`,
    [destinataireId],
  );
  const l = r.rows[0] as { verifie_le: Date | null; actif: boolean } | undefined;
  return l ? etatDeLigne(l.actif, l.verifie_le !== null) : null;
}

/* ----- Lectures (masque seulement) ----- */

export interface LigneDestinataireClient {
  id: string | null;
  utilisateur_id: string;
  utilisateur_nom: string;
  role: string;
  canal: CanalMessagerie;
  numero_masque: string | null;
  verifie: boolean;
  consentement: ConsentementCourantCanal;
  consentement_source: SourceConsentement | null;
  consentement_le: Date | null;
}

const ROLES_DESTINATAIRES = ["client_dirigeant", "client_contributeur"] as const;

/**
 * Destinataires d'un client : les dirigeants et contributeurs ACTIFS de son portail, un élément par
 * personne et par canal (`id` nul tant qu'aucun numéro n'est enregistré). Page de `limite`
 * personnes (curseur sur le nom et l'identifiant). Aucun numéro : masque seulement.
 */
export async function listerDestinatairesClient(
  db: Db,
  clientId: string,
  apres: [string, string] | null,
  limite: number,
): Promise<{ lignes: LigneDestinataireClient[]; suivant: [string, string] | null }> {
  const personnes = await db.query(
    `SELECT u.id, u.nom, u.roles, lower(u.nom) AS cle_tri
     FROM utilisateurs_portail up JOIN utilisateurs u ON u.id = up.utilisateur_id
     WHERE up.client_id = $1 AND up.statut = 'actif' AND u.actif AND u.roles && $2::text[]
       AND ($3::text IS NULL OR (lower(u.nom), u.id) > ($3, $4::uuid))
     ORDER BY lower(u.nom), u.id LIMIT $5`,
    [clientId, ROLES_DESTINATAIRES, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  const page = personnes.rows.slice(0, limite) as {
    id: string;
    nom: string;
    roles: string[];
    cle_tri: string;
  }[];
  const dernier = page[page.length - 1];
  const suivant: [string, string] | null =
    personnes.rows.length > limite && dernier ? [dernier.cle_tri, dernier.id] : null;
  const dests = await db.query(
    `SELECT id, utilisateur_id, canal, numero_masque, verifie_le
     FROM canaux_destinataires WHERE utilisateur_id = ANY($1::uuid[])`,
    [page.map((p) => p.id)],
  );
  const parClef = new Map(
    (
      dests.rows as {
        id: string;
        utilisateur_id: string;
        canal: CanalMessagerie;
        numero_masque: string;
        verifie_le: Date | null;
      }[]
    ).map((d) => [`${d.utilisateur_id}|${d.canal}`, d]),
  );
  const etats = await consentementsCourants(
    db,
    dests.rows.map((d) => d.id as string),
  );
  const lignes: LigneDestinataireClient[] = [];
  for (const personne of page) {
    for (const canal of ["whatsapp", "sms"] as const) {
      const d = parClef.get(`${personne.id}|${canal}`);
      const etat: ConsentementEtat | undefined = d ? etats.get(d.id) : undefined;
      lignes.push({
        id: d?.id ?? null,
        utilisateur_id: personne.id,
        utilisateur_nom: personne.nom,
        role: personne.roles.includes("client_dirigeant")
          ? "client_dirigeant"
          : "client_contributeur",
        canal,
        numero_masque: d?.numero_masque ?? null,
        verifie: d?.verifie_le != null,
        consentement: etat?.statut ?? "absent",
        consentement_source: etat?.source ?? null,
        consentement_le: etat?.cree_le ?? null,
      });
    }
  }
  return { lignes, suivant };
}

export interface MesNumeros {
  canal: CanalMessagerie;
  numero_masque: string | null;
  verifie: boolean;
  consentement: ConsentementCourantCanal;
  destinataire_id: string | null;
}

/** Les numéros (masqués), vérifications et consentements de l'utilisateur, pour les deux canaux. */
export async function lireMesNumeros(db: Db, utilisateurId: string): Promise<MesNumeros[]> {
  const r = await db.query(
    `SELECT id, canal, numero_masque, verifie_le FROM canaux_destinataires WHERE utilisateur_id = $1`,
    [utilisateurId],
  );
  const lignes = r.rows as {
    id: string;
    canal: CanalMessagerie;
    numero_masque: string;
    verifie_le: Date | null;
  }[];
  const etats = await consentementsCourants(
    db,
    lignes.map((l) => l.id),
  );
  return (["whatsapp", "sms"] as const).map((canal) => {
    const l = lignes.find((x) => x.canal === canal);
    return {
      canal,
      numero_masque: l?.numero_masque ?? null,
      verifie: l?.verifie_le != null,
      consentement: (l ? etats.get(l.id)?.statut : undefined) ?? "absent",
      destinataire_id: l?.id ?? null,
    };
  });
}

/** Destinataire d'un utilisateur pour un canal (ligne du cabinet), ou 404. */
export async function exigerDestinataireDe(
  db: Db,
  utilisateurId: string,
  canal: CanalMessagerie,
): Promise<{ id: string }> {
  const r = await db.query(
    "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2",
    [utilisateurId, canal],
  );
  if (!r.rows[0]) throw introuvable("Numéro");
  return r.rows[0] as { id: string };
}

/** Destinataire par identifiant, ou 404. */
export async function exigerDestinataire(
  db: Db,
  id: string,
): Promise<{ id: string; utilisateur_id: string; canal: CanalMessagerie }> {
  const r = await db.query(
    "SELECT id, utilisateur_id, canal FROM canaux_destinataires WHERE id = $1",
    [id],
  );
  if (!r.rows[0]) throw introuvable("Destinataire");
  return r.rows[0] as { id: string; utilisateur_id: string; canal: CanalMessagerie };
}
