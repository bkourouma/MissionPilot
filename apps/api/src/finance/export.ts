import {
  comparer,
  DECIMALES_DEVISE,
  montant as montantMoteur,
  oppose,
  sommer,
  soustraire,
  zero,
  type Devise,
  type Montant,
} from "@missionpilot/engines";
import type { ExportComptableQuery } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit } from "../errors.js";
import { voitToutesLesMissions } from "../missions/acces.js";
import { nombre } from "../missions/outils.js";
import type { PlanComptable } from "./plan-comptable.js";

/*
 * EXPORT COMPTABLE (FIN-13) : écritures SYSCOHADA des factures et avoirs émis
 * et des encaissements de la période, au format CSV paramétrable.
 *
 * Écritures (montants issus des factures enregistrées, sommés par le moteur) :
 * - Facture (journal des ventes) : débit 411 net à payer, débit 4492 retenues
 *   subies, crédit 706 HT des prestations, crédit 707 HT des débours
 *   refacturés, crédit 4431 TVA. Un avoir inverse les sens.
 * - Encaissement (journal de trésorerie selon le mode) : débit trésorerie
 *   (521 virement, 513 chèque, 571 espèces, 552 Mobile Money), crédit 411 des
 *   imputations saisies avec lui, crédit 4191 de l'avance (part non imputée).
 *   Une contre-passation inverse les sens.
 * - Imputation ultérieure d'une avance (opérations diverses) : débit 4191,
 *   crédit 411.
 * Chaque pièce est équilibrée (débit = crédit, contrôle par le moteur) ; une
 * pièce déséquilibrée bloque l'export plutôt que de produire un fichier faux.
 *
 * CSV : séparateur, décimale, format de date et BOM paramétrables ; tout
 * champ commençant par =, +, -, @, tabulation ou retour chariot reçoit un
 * préfixe « ' » (neutralisation des formules dans un tableur) ; champs
 * contenant le séparateur, un guillemet ou un saut de ligne entre guillemets.
 */

export interface Ecriture {
  journal: string;
  date: string;
  piece: string;
  compte: string;
  tiers: string;
  libelle: string;
  debit: Montant | null;
  credit: Montant | null;
}

type Sens = "debit" | "credit";

/** Ligne au sens normal si le montant est positif, au sens inverse (valeur opposée) sinon. */
function ligne(
  base: Omit<Ecriture, "compte" | "debit" | "credit">,
  compte: string,
  m: Montant,
  sens: Sens,
): Ecriture | null {
  const signe = comparer(m, zero(m.devise));
  if (signe === 0) return null;
  const positif = signe > 0 ? m : oppose(m);
  const effectif: Sens = signe > 0 ? sens : sens === "debit" ? "credit" : "debit";
  return {
    ...base,
    compte,
    debit: effectif === "debit" ? positif : null,
    credit: effectif === "credit" ? positif : null,
  };
}

/** Vérifie (moteur) que chaque pièce est équilibrée, devise par devise. */
export function verifierEquilibre(ecritures: readonly Ecriture[]): void {
  const pieces = new Map<string, Ecriture[]>();
  for (const e of ecritures) {
    const cle = `${e.journal}|${e.piece}`;
    const liste = pieces.get(cle);
    if (liste) liste.push(e);
    else pieces.set(cle, [e]);
  }
  for (const lignes of pieces.values()) {
    const devises = new Set(lignes.map((l) => (l.debit ?? l.credit)?.devise as Devise));
    for (const devise of devises) {
      const deLaDevise = lignes.filter((l) => (l.debit ?? l.credit)?.devise === devise);
      const debit = sommer(
        deLaDevise.flatMap((l) => (l.debit ? [l.debit] : [])),
        devise,
      );
      const credit = sommer(
        deLaDevise.flatMap((l) => (l.credit ? [l.credit] : [])),
        devise,
      );
      if (comparer(debit, credit) !== 0) {
        throw new AppError(
          409,
          "ECRITURES_DESEQUILIBREES",
          `Pièce ${lignes[0]?.piece ?? ""} déséquilibrée : export refusé.`,
        );
      }
    }
  }
}

const sansSautDeLigne = (t: string) =>
  // eslint-disable-next-line no-control-regex
  t.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();

/** Regroupe des lignes par une clé, en un seul passage. */
function grouperPar<T extends Record<string, unknown>>(lignes: readonly T[], cle: keyof T) {
  const groupes = new Map<unknown, T[]>();
  for (const l of lignes) {
    const liste = groupes.get(l[cle]);
    if (liste) liste.push(l);
    else groupes.set(l[cle], [l]);
  }
  return groupes;
}

/** Écritures des factures et avoirs émis dans la période (tout le cabinet). */
async function ecrituresFactures(
  db: Db,
  du: string,
  au: string,
  plan: PlanComptable,
): Promise<Ecriture[]> {
  const r = await db.query(
    `SELECT f.id, f.nature, f.numero, f.devise, f.date_emission::text AS date_emission, f.total_tva,
       f.total_retenues, f.net_a_payer, cl.raison_sociale AS client
     FROM factures f JOIN clients cl ON cl.id = f.client_id
     WHERE f.numero IS NOT NULL AND f.date_emission BETWEEN $1 AND $2
     ORDER BY f.date_emission, f.numero`,
    [du, au],
  );
  const ids = r.rows.map((f) => f.id as string);
  const l =
    ids.length === 0
      ? { rows: [] as Record<string, unknown>[] }
      : await db.query(
          "SELECT facture_id, origine, montant_ht FROM facture_lignes WHERE facture_id = ANY ($1::uuid[])",
          [ids],
        );
  const lignesParFacture = grouperPar(l.rows, "facture_id");
  const ecritures: Ecriture[] = [];
  for (const f of r.rows) {
    const devise = f.devise as Devise;
    const m = (v: unknown) => montantMoteur(nombre(v), devise);
    const lignesF = lignesParFacture.get(f.id) ?? [];
    const ht = (origine: string) =>
      sommer(
        lignesF.filter((x) => x.origine === origine).map((x) => m(x.montant_ht)),
        devise,
      );
    const base = {
      journal: plan.journaux.ventes,
      date: f.date_emission as string,
      piece: f.numero as string,
      tiers: sansSautDeLigne(f.client as string),
      libelle: sansSautDeLigne(
        `${f.nature === "avoir" ? "Avoir" : "Facture"} ${f.numero as string} ${f.client as string}`,
      ),
    };
    ecritures.push(
      ...[
        ligne(base, plan.comptes.clients, m(f.net_a_payer), "debit"),
        ligne(base, plan.comptes.retenues_subies, m(f.total_retenues), "debit"),
        ligne(base, plan.comptes.produits_prestations, ht("echeance"), "credit"),
        ligne(base, plan.comptes.produits_debours, ht("debours"), "credit"),
        ligne(base, plan.comptes.tva_collectee, m(f.total_tva), "credit"),
      ].filter((e): e is Ecriture => e !== null),
    );
  }
  return ecritures;
}

const JOURNAL_MODE = {
  virement: ["banque", "banque"],
  cheque: ["banque", "cheques"],
  especes: ["caisse", "caisse"],
  mobile_money: ["mobile_money", "mobile_money"],
} as const;

const LIBELLE_MODE: Record<string, string> = {
  virement: "Virement",
  cheque: "Chèque",
  especes: "Espèces",
  mobile_money: "Mobile Money",
};

/** Écritures des encaissements de la période et des imputations d'avances. */
async function ecrituresEncaissements(
  db: Db,
  du: string,
  au: string,
  plan: PlanComptable,
): Promise<Ecriture[]> {
  const r = await db.query(
    `SELECT e.id, e.date_encaissement::text AS date, e.montant, e.devise, e.mode, e.reference,
       e.contre_passation_de, cl.raison_sociale AS client
     FROM encaissements e JOIN clients cl ON cl.id = e.client_id
     WHERE e.date_encaissement BETWEEN $1 AND $2
     ORDER BY e.date_encaissement, e.saisi_le, e.id`,
    [du, au],
  );
  const ids = r.rows.map((e) => e.id as string);
  const imp =
    ids.length === 0
      ? { rows: [] as Record<string, unknown>[] }
      : await db.query(
          `SELECT encaissement_id, montant FROM imputations
           WHERE encaissement_id = ANY ($1::uuid[]) AND origine IN ('saisie', 'contre_passation')`,
          [ids],
        );
  const imputationsParEncaissement = grouperPar(imp.rows, "encaissement_id");
  const ecritures: Ecriture[] = [];
  for (const e of r.rows) {
    const devise = e.devise as Devise;
    const total = montantMoteur(nombre(e.montant), devise);
    const imputees = sommer(
      (imputationsParEncaissement.get(e.id) ?? []).map((i) =>
        montantMoteur(nombre(i.montant), devise),
      ),
      devise,
    );
    const [journal, compte] = JOURNAL_MODE[e.mode as keyof typeof JOURNAL_MODE];
    const contre = e.contre_passation_de !== null;
    const base = {
      journal: plan.journaux[journal],
      date: e.date as string,
      piece: `ENC-${(e.id as string).slice(0, 8).toUpperCase()}`,
      tiers: sansSautDeLigne(e.client as string),
      libelle: sansSautDeLigne(
        `${contre ? "Contre-passation " : ""}${LIBELLE_MODE[e.mode as string] ?? ""} ${(e.reference as string | null) ?? ""} ${e.client as string}`,
      ),
    };
    ecritures.push(
      ...[
        ligne(base, plan.comptes[compte], total, "debit"),
        ligne(base, plan.comptes.clients, imputees, "credit"),
        ligne(base, plan.comptes.avances_clients, soustraire(total, imputees), "credit"),
      ].filter((x): x is Ecriture => x !== null),
    );
  }
  const avances = await db.query(
    `SELECT i.id, i.encaissement_id, i.montant, i.devise, i.date_imputation::text AS date,
       f.numero, cl.raison_sociale AS client
     FROM imputations i JOIN factures f ON f.id = i.facture_id JOIN clients cl ON cl.id = f.client_id
     WHERE i.origine = 'avance' AND i.date_imputation BETWEEN $1 AND $2
     ORDER BY i.date_imputation, i.cree_le, i.id`,
    [du, au],
  );
  for (const i of avances.rows) {
    const m = montantMoteur(nombre(i.montant), i.devise as Devise);
    const base = {
      journal: plan.journaux.operations_diverses,
      date: i.date as string,
      piece: `IMP-${(i.id as string).slice(0, 8).toUpperCase()}`,
      tiers: sansSautDeLigne(i.client as string),
      libelle: sansSautDeLigne(
        `Imputation d'avance sur ${i.numero as string} ${i.client as string}`,
      ),
    };
    ecritures.push(
      ...[
        ligne(base, plan.comptes.avances_clients, m, "debit"),
        ligne(base, plan.comptes.clients, m, "credit"),
      ].filter((x): x is Ecriture => x !== null),
    );
  }
  return ecritures;
}

/**
 * Écritures de la période. CLOISONNEMENT (décision documentée) : l'export
 * porte sur TOUT le cabinet (factures, encaissements, imputations), de façon
 * uniforme ; il est donc réservé à qui voit toutes les missions
 * (« mission.lire_toutes », exigé par la route ET ici). Un filtre partiel
 * (factures seulement) produirait une balance incohérente et laisserait voir
 * les encaissements de clients invisibles : il n'y en a aucun.
 */
export async function ecrituresComptables(
  db: Db,
  auth: Auth,
  du: string,
  au: string,
  plan: PlanComptable,
): Promise<Ecriture[]> {
  if (!voitToutesLesMissions(auth)) throw interdit();
  const ecritures = [
    ...(await ecrituresFactures(db, du, au, plan)),
    ...(await ecrituresEncaissements(db, du, au, plan)),
  ].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  verifierEquilibre(ecritures);
  return ecritures;
}

/* ----- Format CSV ----- */

const SEPARATEUR = { point_virgule: ";", virgule: ",", tabulation: "\t" } as const;

/** Neutralise une formule de tableur et met entre guillemets si nécessaire. */
export function champCsv(valeur: string, separateur: string): string {
  let v = valeur;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (v.includes(separateur) || /["\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Montant en unités majeures (écriture décimale, sans calcul flottant). */
export function montantExport(m: Montant | null, decimale: "virgule" | "point"): string {
  if (m === null) return "";
  const decimales = DECIMALES_DEVISE[m.devise];
  const chiffres = String(Math.abs(m.valeur)).padStart(decimales + 1, "0");
  const signe = m.valeur < 0 ? "-" : "";
  if (decimales === 0) return `${signe}${chiffres}`;
  const sep = decimale === "virgule" ? "," : ".";
  return `${signe}${chiffres.slice(0, -decimales)}${sep}${chiffres.slice(-decimales)}`;
}

export function dateExport(date: string, format: ExportComptableQuery["format_date"]): string {
  const [a, m, j] = date.split("-") as [string, string, string];
  if (format === "aaaa-mm-jj") return date;
  if (format === "jjmmaaaa") return `${j}${m}${a}`;
  return `${j}/${m}/${a}`;
}

export const ENTETES_CSV = [
  "journal",
  "date",
  "piece",
  "compte",
  "tiers",
  "libelle",
  "debit",
  "credit",
  "devise",
] as const;

export function versCsv(ecritures: readonly Ecriture[], q: ExportComptableQuery): string {
  const sep = SEPARATEUR[q.separateur];
  const lignes = [
    ENTETES_CSV.join(sep),
    ...ecritures.map((e) =>
      [
        e.journal,
        dateExport(e.date, q.format_date),
        e.piece,
        e.compte,
        e.tiers,
        e.libelle,
        montantExport(e.debit, q.decimale),
        montantExport(e.credit, q.decimale),
        (e.debit ?? e.credit)?.devise ?? "",
      ]
        .map((v) => champCsv(v, sep))
        .join(sep),
    ),
  ];
  return `${q.bom === "oui" ? "\uFEFF" : ""}${lignes.join("\r\n")}\r\n`;
}
