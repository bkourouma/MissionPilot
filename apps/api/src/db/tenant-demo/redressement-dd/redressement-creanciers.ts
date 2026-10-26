import type { ContexteTenantDemo } from "../contexte.js";
import type { Acteurs } from "./commun.js";
import {
  ECHELLE_IDENTITE,
  creer,
  dater,
  debutAppel,
  lire,
  urlD,
  type Echelle,
  type Json,
} from "./redressement-outils.js";

/*
 * Registre des créanciers, créances, négociations, accords et échéanciers (RED-12) : exécution,
 * par les routes, de définitions de créanciers et de leur fil d'événements. Le reste dû, l'échu et
 * l'avancement des accords sont recalculés par le moteur à chaque lecture. Les événements sont
 * joués dans l'ordre chronologique, chacun avec la session d'un compte de l'équipe, et antidatés à
 * leur jour ; un paiement reprend le montant de l'échéance visée (jamais un montant inventé).
 * Les montants des définitions sont en XOF ; `echelle` les convertit vers la devise du dossier.
 */

export type Equipier = keyof Acteurs;

export type TypeEvenementDef =
  | "ouverture"
  | "proposition"
  | "contre_proposition"
  | "note"
  | "accord"
  | "paiement"
  | "annulation_paiement"
  | "creance";

export interface EvenementDef {
  jour: string;
  par: Equipier;
  type: TypeEvenementDef;
  montant?: number;
  conditions?: string;
  /** Accord : échéancier régulier ou explicite (dates et montants). */
  echeancier?:
    | { mode: "regulier"; nombre: number; premiere: string; periodiciteMois: number }
    | { mode: "explicite"; lignes: readonly { date: string; montant: number }[] };
  /** Paiement : rang de l'échéance payée ; annulation : rang de l'échéance dont on annule le paiement. */
  rang?: number;
  /** Nouvelle version de la créance (type « creance »). */
  creance?: { principal: number; interets: number; arrete: string; commentaire: string };
}

export interface CreancierDef {
  nom: string;
  categorie: "fournisseur" | "banque" | "fiscal" | "social" | "bailleur" | "autre";
  garanti: boolean;
  reference?: string;
  principal: number;
  interets: number;
  arrete: string;
  echeanceInitiale?: string;
  nature: string;
  creeLe: string;
  par: Equipier;
  evenements: readonly EvenementDef[];
}

async function listeCreanciers(a: Acteurs, dossierId: string): Promise<Map<string, string>> {
  const r = await lire(a.chef, urlD(dossierId, "/creanciers?actifs=tous"), "créanciers");
  return new Map((r.elements as Json[]).map((c) => [c.nom as string, c.id as string]));
}

/** Crée les créanciers (et leur créance n° 1) qui n'existent pas encore. */
export async function creerCreanciers(
  ctx: ContexteTenantDemo,
  a: Acteurs,
  dossierId: string,
  defs: readonly CreancierDef[],
  echelle: Echelle = ECHELLE_IDENTITE,
): Promise<void> {
  const existants = await listeCreanciers(a, dossierId);
  for (const d of defs) {
    if (existants.has(d.nom)) continue;
    const debut = await debutAppel(ctx);
    await creer(
      a[d.par],
      urlD(dossierId, "/creanciers"),
      {
        nom: d.nom,
        categorie: d.categorie,
        garanti: d.garanti,
        ...(d.reference ? { reference: d.reference } : {}),
        principal: echelle(d.principal),
        interets: echelle(d.interets),
        date_arrete: d.arrete,
        ...(d.echeanceInitiale ? { echeance_initiale: d.echeanceInitiale } : {}),
        nature: d.nature,
      },
      `créancier ${d.nom}`,
    );
    await dater(ctx, dossierId, debut, d.creeLe, "red_creanciers", "red_creances");
  }
}

function corpsEvenement(e: EvenementDef, accord: Json | null, echelle: Echelle): Json {
  const base = { type: e.type, date_evenement: e.jour };
  switch (e.type) {
    case "accord": {
      const ech = e.echeancier;
      if (!ech || e.montant === undefined) throw new Error("Accord sans échéancier ni montant.");
      return {
        ...base,
        montant: echelle(e.montant),
        ...(e.conditions ? { conditions: e.conditions } : {}),
        echeancier:
          ech.mode === "regulier"
            ? {
                mode: "regulier",
                nombre_echeances: ech.nombre,
                date_premiere: ech.premiere,
                periodicite_mois: ech.periodiciteMois,
              }
            : {
                mode: "explicite",
                lignes: ech.lignes.map((x) => ({ date: x.date, montant: echelle(x.montant) })),
              },
      };
    }
    case "paiement": {
      const echeance = (accord?.echeances as Json[] | undefined)?.find((x) => x.rang === e.rang);
      if (!accord || !echeance) throw new Error(`Paiement sans échéance de rang ${e.rang}.`);
      return {
        ...base,
        montant: echeance.montant,
        accord_id: accord.id,
        echeance_rang: e.rang,
      };
    }
    case "annulation_paiement": {
      const paiement = (accord?.paiements as Json[] | undefined)?.find(
        (x) => x.echeance_rang === e.rang,
      );
      if (!paiement) throw new Error(`Aucun paiement à annuler pour le rang ${e.rang}.`);
      return { ...base, paiement_annule_id: paiement.id };
    }
    default:
      return {
        ...base,
        ...(e.montant !== undefined ? { montant: echelle(e.montant) } : {}),
        ...(e.conditions ? { conditions: e.conditions } : {}),
      };
  }
}

/**
 * Joue, dans l'ordre chronologique, les événements dont le jour est compris entre `apres`
 * (exclu) et `jusquau` (inclus) pour tous les créanciers définis.
 */
export async function jouerEvenements(
  ctx: ContexteTenantDemo,
  a: Acteurs,
  dossierId: string,
  defs: readonly CreancierDef[],
  apres: string,
  jusquau: string,
  echelle: Echelle = ECHELLE_IDENTITE,
): Promise<void> {
  const ids = await listeCreanciers(a, dossierId);
  const aJouer = defs.flatMap((d) =>
    d.evenements
      .filter((e) => e.jour > apres && e.jour <= jusquau)
      .map((e) => ({ d, e, id: ids.get(d.nom) })),
  );
  aJouer.sort((x, y) => (x.e.jour < y.e.jour ? -1 : x.e.jour > y.e.jour ? 1 : 0));
  for (const { d, e, id } of aJouer) {
    if (!id) throw new Error(`Créancier « ${d.nom} » introuvable.`);
    const debut = await debutAppel(ctx);
    if (e.type === "creance") {
      const c = e.creance;
      if (!c) throw new Error("Créance sans contenu.");
      await creer(
        a[e.par],
        `/api/redressement/creanciers/${id}/creances`,
        {
          principal: echelle(c.principal),
          interets: echelle(c.interets),
          date_arrete: c.arrete,
          nature: d.nature,
          commentaire: c.commentaire,
        },
        `créance ${d.nom}`,
      );
      await dater(ctx, dossierId, debut, e.jour, "red_creances");
      continue;
    }
    const detail =
      e.type === "paiement" || e.type === "annulation_paiement"
        ? ((await lire(a.chef, `/api/redressement/creanciers/${id}`, "créancier"))
            .accord_en_vigueur as Json | null)
        : null;
    await creer(
      a[e.par],
      `/api/redressement/creanciers/${id}/evenements`,
      corpsEvenement(e, detail, echelle),
      `événement ${e.type} ${d.nom}`,
    );
    await dater(ctx, dossierId, debut, e.jour, "red_negociation_evenements");
  }
}
