import {
  ajouterJours,
  appliquerPourcentage,
  montant as montantMoteur,
  soustraire,
} from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import type { Auth } from "../../../auth/contexte.js";
import { pdfDemo } from "../../seed-demo-portail.js";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import type { Alea } from "../horloge.js";
import {
  CLES_MISSIONS,
  cleDeCompte,
  type Casting,
  type CleMission,
  type MissionLue,
} from "./casting.js";
import { libelleMontant, ok } from "./outils.js";

/*
 * Outils communs du module FACTURATION : environnement, événements datés, jours ouvrés, datation
 * du journal d'audit, sessions par rôle, montants (toujours par les moteurs), téléversement du
 * justificatif d'un débours.
 *
 * Datation : les routes écrivent à l'heure réelle. Seul le journal d'audit est remonté, ligne à
 * ligne, à la date fictive de chaque étape (`etape`). `factures`, `echeances_facturation`,
 * `debours` ne peuvent PAS être antidatées (déclencheurs d'identité figée) et `encaissements`,
 * `imputations`, `relances_factures`, `contre_passations` sont en ajout seul : leurs dates
 * métier (émission, encaissement, relance) sont fictives, leurs horodatages de saisie restent
 * réels.
 */

export interface Compteurs {
  echeances: number;
  debours: number;
  factures: number;
  avoirs: number;
  encaissements: number;
  relances: number;
  contrePassations: number;
}

export interface Env {
  ctx: ContexteTenantDemo;
  casting: Casting;
  rng: Alea;
  compteurs: Compteurs;
}

/** Un événement de l'histoire de facturation, joué dans l'ordre chronologique global. */
export interface Evenement {
  date: string;
  /** Départage deux événements du même jour (échéancier < débours < facture < avoir < paiement). */
  rang: number;
  cle: string;
  jouer: () => Promise<void>;
}

export type Reponse = Awaited<ReturnType<SessionDemo["get"]>>;

/* ----- Dates ----- */

/** Ramène un samedi ou un dimanche au jour ouvré voisin, sans jamais dépasser « aujourd'hui ». */
export function ouvre(env: Env, date: string): string {
  const j = new Date(`${date}T00:00:00Z`).getUTCDay();
  const avant = j === 6 ? -1 : j === 0 ? -2 : 0;
  const apres = j === 6 ? 2 : j === 0 ? 1 : 0;
  const d = ajouterJours(date, apres);
  return d <= env.ctx.aujourdhui ? d : ajouterJours(date, avant);
}

export const plus = (env: Env, date: string, jours: number): string =>
  ouvre(env, ajouterJours(date, jours));

/* ----- Journal d'audit ----- */

/** Dernier identifiant du journal d'audit du cabinet (borne basse d'une étape). */
export async function curseurJournal(env: Env): Promise<number> {
  const r = await env.ctx.proprietaire.query(
    "SELECT coalesce(max(id), 0)::float8 AS n FROM journal_audit WHERE cabinet_id = $1",
    [env.ctx.cabinetId],
  );
  return Number(r.rows[0].n);
}

/** Remonte à `date` (à partir de `heure` h) les lignes du journal écrites depuis `depuis`. */
export async function dater(env: Env, depuis: number, date: string, heure = 9): Promise<void> {
  const hh = String(heure).padStart(2, "0");
  await env.ctx.proprietaire.query(
    `UPDATE journal_audit j
        SET cree_le = $3::timestamptz + r.rang * interval '47 seconds'
       FROM (SELECT id, (row_number() OVER (ORDER BY id) - 1) AS rang
               FROM journal_audit
              WHERE cabinet_id = $1 AND id > $2 AND action NOT LIKE 'semis_tenant_demo%') r
      WHERE j.id = r.id`,
    [env.ctx.cabinetId, depuis, `${date}T${hh}:00:00Z`],
  );
}

/** Exécute une étape et date à `date` tout ce qu'elle a écrit dans le journal d'audit. */
export async function etape<T>(
  env: Env,
  date: string,
  fn: () => Promise<T>,
  heure = 9,
): Promise<T> {
  const depuis = await curseurJournal(env);
  const resultat = await fn();
  await dater(env, depuis, date, heure);
  return resultat;
}

/* ----- Comptes ----- */

const GESTIONNAIRES: readonly CleCompte[] = ["gestionnaire", "gestionnaire.2"];
const ASSOCIES: readonly CleCompte[] = ["associe", "associe.2"];

/** Gestionnaire qui prépare les écritures d'une mission (alternance stable par mission). */
export const cleGestionnaire = (cle: CleMission): CleCompte =>
  GESTIONNAIRES[CLES_MISSIONS.indexOf(cle) % 2] as CleCompte;

/** L'autre gestionnaire (contre-passation validée par un autre que le demandeur). */
export const autreGestionnaire = (cle: CleCompte): CleCompte =>
  cle === "gestionnaire" ? "gestionnaire.2" : "gestionnaire";

/** Associé qui approuve une facture (alternance stable par clé de facture). */
export function cleApprobateur(cleFacture: string): CleCompte {
  const somme = [...cleFacture].reduce((s, c) => s + c.charCodeAt(0), 0);
  return ASSOCIES[somme % 2] as CleCompte;
}

export const session = (env: Env, cle: CleCompte): SessionDemo => env.ctx.session(cle);

/** Acteur pour les fonctions de domaine appelées directement (émission à date fictive, relance). */
export function acteur(env: Env, cle: CleCompte, role: Role): Auth {
  const id = env.ctx.utilisateurs[cle];
  if (!id) throw new Error(`Utilisateur « ${cle} » introuvable dans le contexte.`);
  return { cabinetId: env.ctx.cabinetId, utilisateurId: id, email: "", nom: "", roles: [role] };
}

/** Clé de compte d'un utilisateur de la mission (chef, directeur), ou un associé à défaut. */
export function cleDe(env: Env, utilisateurId: string | null): CleCompte {
  const cle = utilisateurId ? cleDeCompte(env.ctx, utilisateurId) : undefined;
  return (cle ?? "associe") as CleCompte;
}

/* ----- Montants (moteurs) ----- */

/** Part (en points) d'un montant XOF, arrondie par le moteur. */
export const part = (valeur: number, points: number): number =>
  appliquerPourcentage(montantMoteur(valeur, "XOF"), points).valeur;

export const moins = (a: number, b: number): number =>
  soustraire(montantMoteur(a, "XOF"), montantMoteur(b, "XOF")).valeur;

/** Répartit `total` selon des pourcentages : le dernier élément reçoit le reste exact. */
export function repartir(total: number, pourcentages: readonly number[]): number[] {
  const montants: number[] = [];
  let reste = total;
  pourcentages.forEach((p, i) => {
    const m = i === pourcentages.length - 1 ? reste : part(total, p);
    montants.push(m);
    reste = moins(reste, m);
  });
  return montants;
}

/* ----- Lecture en base (client propriétaire, filtre cabinet explicite) ----- */

export const lire = (env: Env, sql: string, parametres: unknown[]) =>
  env.ctx.proprietaire.query(sql, parametres).then((r) => r.rows);

export interface Json {
  [cle: string]: unknown;
}

export const corps = (r: Reponse): Json => r.json() as Json;

/** Appel qui doit réussir avec `statut` ; renvoie le corps JSON. */
export async function appel(attendu: number, quoi: string, r: Promise<Reponse>): Promise<Json> {
  const rep = await r;
  ok(attendu, rep, quoi);
  return corps(rep);
}

/* ----- Justificatif d'un débours ----- */

function multipart(nom: string, contenu: Buffer, graine: string) {
  const frontiere = `----mpfact${graine}`;
  const entete =
    `--${frontiere}\r\nContent-Disposition: form-data; name="fichier"; filename="${nom}"\r\n` +
    "Content-Type: application/pdf\r\n\r\n";
  return {
    payload: Buffer.concat([
      Buffer.from(entete, "utf8"),
      contenu,
      Buffer.from(`\r\n--${frontiere}--\r\n`, "utf8"),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${frontiere}` },
  };
}

/** Téléverse un justificatif PDF minuscule sur un débours en brouillon (route réelle). */
export async function televerserJustificatif(
  env: Env,
  s: SessionDemo,
  deboursId: string,
  libelle: string,
  montant: number,
  jour: string,
  devise = "XOF",
): Promise<void> {
  const pdf = pdfDemo("Justificatif de debours (demonstration)", [
    `Depense du ${jour}`,
    libelle,
    `Montant : ${libelleMontant(montant, devise)}`,
    "Document fictif genere pour la demonstration.",
  ]);
  const m = multipart(`justificatif-${deboursId.slice(0, 8)}.pdf`, pdf, deboursId.slice(0, 12));
  const r = await env.ctx.app.inject({
    method: "POST",
    url: `/api/debours/${deboursId}/justificatif`,
    headers: { cookie: s.cookie, ...m.headers },
    payload: m.payload,
  });
  ok(200, r, `justificatif du débours ${libelle}`);
}

/** Mission du casting, ou erreur claire. */
export function missionDe(env: Env, cle: CleMission): MissionLue {
  const m = env.casting.missions[cle];
  if (!m) throw new Error(`Mission « ${cle} » absente du casting.`);
  return m;
}

export interface FactureLue {
  id: string;
  statut: string;
}

/** Facture d'une mission retrouvée par son objet (clé naturelle du seed). */
export async function trouverFacture(
  env: Env,
  m: MissionLue,
  objet: string,
): Promise<FactureLue | undefined> {
  const r = await lire(
    env,
    "SELECT id, statut FROM factures WHERE mission_id = $1 AND nature = 'facture' AND objet = $2",
    [m.id, objet],
  );
  return r[0] ? { id: r[0].id as string, statut: r[0].statut as string } : undefined;
}
