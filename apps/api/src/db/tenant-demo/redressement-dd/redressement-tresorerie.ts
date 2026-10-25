import type { Alea } from "../horloge.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import {
  ECHELLE_IDENTITE,
  creer,
  dater,
  debutAppel,
  M,
  plus,
  urlD,
  type Echelle,
  type Json,
} from "./redressement-outils.js";

/*
 * Trésorerie à 13 semaines : versions de prévision successives (fenêtre glissante) et réalisés
 * hebdomadaires, par les routes `tresorerie/versions` et `tresorerie/realises`.
 *
 * Une version est décrite par des SÉRIES de 13 valeurs en millions par catégorie de flux ; le
 * réalisé d'une semaine s'en déduit (encaissements un peu en dessous du prévu quand la situation
 * est tendue, décaissements un peu au-dessus), avec le hasard à graine du semis. Les soldes, les
 * écarts, les semaines de tension et le besoin de financement sont calculés par le MOTEUR à chaque
 * lecture : rien n'est écrit à la main. Chaque version et chaque réalisé est antidaté à son jour :
 * une version à son jour de création, un réalisé le lundi qui suit sa semaine. Les montants sont
 * écrits en XOF ; `echelle` les convertit vers la devise de la mission (identité par défaut).
 */

export const ENCAISSEMENTS = [
  "clients",
  "autres_encaissements",
  "financement",
  "cessions",
] as const;
export const DECAISSEMENTS = [
  "fournisseurs",
  "salaires",
  "fiscal_social",
  "loyers_charges",
  "service_dette",
  "investissements",
  "autres_decaissements",
] as const;
export type Categorie = (typeof ENCAISSEMENTS)[number] | (typeof DECAISSEMENTS)[number];

/** Séries de 13 valeurs (millions) par catégorie ; une valeur nulle ou absente n'écrit rien. */
export type Series = Partial<Record<Categorie, readonly number[]>>;

export interface PrevisionSpec {
  /** Lundi de la semaine 1. */
  debut: string;
  /** Jour (fictif) de création de la version. */
  creee: string;
  soldeInitial: number;
  seuilTension: number;
  motif: string;
  series: Series;
  /** Lignes déjà prêtes (échéances d'accords proposées par l'API), en plus des séries. */
  lignesSupplementaires?: readonly Json[];
}

export interface RealisesSpec {
  /** Nombre de semaines de réalisé à saisir (à partir de la semaine 1). */
  semaines: number;
  /** Facteur appliqué aux encaissements clients : [min, max] en pour cent du prévu. */
  clients: readonly [number, number];
  /** Facteur appliqué aux autres décaissements variables. */
  fournisseurs: readonly [number, number];
  /** Commentaires par numéro de semaine (1 = première semaine de la version). */
  commentaires?: Readonly<Record<number, string>>;
  /** Dernier jour de saisie autorisé (le réalisé d'une semaine est saisi le lundi suivant). */
  saisieAuPlusTard: string;
}

export function lignesDe(series: Series, echelle: Echelle = ECHELLE_IDENTITE): Json[] {
  const lignes: Json[] = [];
  for (const [categorie, valeurs] of Object.entries(series) as [Categorie, readonly number[]][]) {
    const sens = (ENCAISSEMENTS as readonly string[]).includes(categorie)
      ? "encaissement"
      : "decaissement";
    valeurs.forEach((v, i) => {
      if (v > 0)
        lignes.push({ semaine: i + 1, sens, categorie, montant: echelle(Math.round(v * M)) });
    });
  }
  return lignes;
}

const entre = (alea: Alea, [min, max]: readonly [number, number]): number =>
  alea.entier(min, max) / 100;

/** Flux réalisé de la semaine `i` (0..12) déduit des lignes prévues (séries et échéances d'accords). */
function fluxRealise(lignes: readonly Json[], r: RealisesSpec, i: number, alea: Alea): Json {
  const encaissement: Record<string, number> = {};
  const decaissement: Record<string, number> = {};
  for (const l of lignes) {
    if (l.semaine !== i + 1) continue;
    const categorie = l.categorie as string;
    const prevu = l.montant as number;
    if (l.sens === "encaissement") {
      const f = categorie === "clients" ? entre(alea, r.clients) : 1;
      encaissement[categorie] = (encaissement[categorie] ?? 0) + Math.round(prevu * f);
    } else {
      const fixe =
        categorie === "salaires" || categorie === "fiscal_social" || categorie === "service_dette";
      const f = fixe || l.echeance_id ? 1 : entre(alea, r.fournisseurs);
      decaissement[categorie] = (decaissement[categorie] ?? 0) + Math.round(prevu * f);
    }
  }
  return {
    ...(Object.keys(encaissement).length > 0 ? { encaissement } : {}),
    ...(Object.keys(decaissement).length > 0 ? { decaissement } : {}),
  };
}

/**
 * Crée la version de prévision (session `par`), puis saisit ses semaines de réalisé (session
 * `saisie`), chacune le lundi qui suit la semaine ; antidate le tout.
 */
export async function semerVersionTresorerie(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  saisie: SessionDemo,
  spec: PrevisionSpec,
  realises: RealisesSpec,
  alea: Alea,
  echelle: Echelle = ECHELLE_IDENTITE,
): Promise<void> {
  const debut = await debutAppel(ctx);
  const lignes = [...lignesDe(spec.series, echelle), ...(spec.lignesSupplementaires ?? [])];
  await creer(
    par,
    urlD(dossierId, "/tresorerie/versions"),
    {
      date_debut: spec.debut,
      solde_initial: echelle(Math.round(spec.soldeInitial * M)),
      seuil_tension: echelle(Math.round(spec.seuilTension * M)),
      lignes,
      motif: spec.motif,
    },
    `trésorerie ${spec.debut}`,
  );
  await dater(ctx, dossierId, debut, spec.creee, "red_tresorerie_versions");
  for (let i = 0; i < realises.semaines; i += 1) {
    const lundi = plus(spec.debut, 7 * i);
    const jourSaisie = plus(lundi, 7);
    if (jourSaisie > realises.saisieAuPlusTard) break;
    const commentaire = realises.commentaires?.[i + 1];
    const t = await debutAppel(ctx);
    await creer(
      saisie,
      urlD(dossierId, "/tresorerie/realises"),
      {
        semaine_debut: lundi,
        flux: fluxRealise(lignes, realises, i, alea),
        ...(commentaire ? { commentaire } : {}),
      },
      `réalisé ${lundi}`,
    );
    await dater(ctx, dossierId, t, jourSaisie, "red_tresorerie_realises");
  }
}

const CATEGORIE_PAR_CREANCIER: Record<string, Categorie> = {
  banque: "service_dette",
  fournisseur: "fournisseurs",
  fiscal: "fiscal_social",
  social: "fiscal_social",
  bailleur: "loyers_charges",
  autre: "autres_decaissements",
};

/**
 * Échéances des accords en vigueur qui tombent dans la fenêtre de 13 semaines commençant à
 * `debut`, sous forme de lignes de décaissement rattachées à leur créancier et à leur échéance
 * (même règle que la proposition de l'API, mais pour la fenêtre de la version à créer).
 */
export async function lignesAccords(
  ctx: ContexteTenantDemo,
  dossierId: string,
  debut: string,
): Promise<Json[]> {
  const r = await ctx.proprietaire.query(
    `SELECT e.id, e.creancier_id, e.montant::text AS montant, c.categorie,
            (e.date_echeance - $2::date) AS jours
       FROM red_echeances e JOIN red_creanciers c ON c.id = e.creancier_id
      WHERE e.dossier_id = $1 AND NOT EXISTS (
        SELECT 1 FROM red_negociation_evenements x
         WHERE x.creancier_id = e.creancier_id AND x.type = 'rupture' AND x.accord_id = e.accord_id)
      ORDER BY e.date_echeance, e.rang`,
    [dossierId, debut],
  );
  return (r.rows as Record<string, unknown>[])
    .filter((x) => (x.jours as number) >= 0 && (x.jours as number) < 91)
    .map((x) => ({
      semaine: Math.floor((x.jours as number) / 7) + 1,
      sens: "decaissement",
      categorie: CATEGORIE_PAR_CREANCIER[x.categorie as string] ?? "autres_decaissements",
      montant: Number(x.montant),
      creancier_id: x.creancier_id,
      echeance_id: x.id,
    }));
}
