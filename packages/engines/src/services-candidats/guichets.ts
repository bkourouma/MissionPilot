/**
 * Veille des guichets de financement : rapprochement DÉTERMINISTE entre une liste de guichets
 * tenue par le cabinet et le profil d'un client. Moteur pur : aucune source externe, aucun
 * contenu inventé, aucune conversion de devise (jamais de taux inventé), aucun LLM.
 *
 * Règles :
 * - guichet inactif -> exclu ; `date_limite` < `aujourdhui` -> exclu ;
 * - critères restrictifs pays, secteur, filières (au moins une en commun), taille, objet,
 *   devise : liste du guichet vide -> `non_restreint` ; profil non renseigné -> `inconnu` ;
 *   valeur dans la liste -> `ok` ; hors liste -> `ko` (exclu) ;
 * - montant : évalué seulement s'il existe une borne. Si `devise_montant` est renseignée et
 *   que la devise du profil diffère OU est absente -> `inconnu` (montant non comparable, sans
 *   conversion) ; profil sans montant -> `inconnu` ; hors borne -> `ko` ;
 * - statut : `exclu` au moindre `ko` (dont inactif et échéance dépassée) ; sinon `compatible`
 *   si aucun `inconnu` ; sinon `partiel` ;
 * - score entier 0..100 = arrondi(100 x ok / (ok + inconnu + ko)) sur les sept critères
 *   restrictifs (hors actif et échéance) ; 100 si aucun n'est restrictif ; 0 si exclu ;
 * - tri total stable : statut (compatible, partiel, exclu), score décroissant, nom
 *   (`localeCompare` « fr »), id ; l'entrée n'est jamais modifiée ;
 * - chaînes comparées sans casse ni accents (NFD) ; dates ISO AAAA-MM-JJ validées (Error sinon).
 */
import type { Devise } from "../finance/monnaie";

export const TYPES_GUICHET = [
  "banque",
  "bailleur",
  "fonds_investissement",
  "programme_public",
  "autre",
] as const;
export type TypeGuichet = (typeof TYPES_GUICHET)[number];

export const OBJETS_FINANCEMENT = [
  "creation",
  "investissement",
  "bfr",
  "croissance",
  "restructuration",
  "export",
] as const;
export type ObjetFinancement = (typeof OBJETS_FINANCEMENT)[number];

export interface GuichetFinancement {
  id: string;
  nom: string;
  type: TypeGuichet;
  /** Listes : VIDE = pas de restriction. */
  pays: string[];
  secteurs: string[];
  filieres: string[];
  tailles: string[];
  objets: ObjetFinancement[];
  devises: Devise[];
  /** Entiers (unité de la devise), null = pas de borne. */
  montant_min: number | null;
  montant_max: number | null;
  devise_montant: Devise | null;
  /** AAAA-MM-JJ, null = permanent. */
  date_limite: string | null;
  actif: boolean;
}

export interface ProfilFinancement {
  pays: string | null;
  secteur: string | null;
  filieres: string[];
  taille: string | null;
  objet: ObjetFinancement | null;
  montant: number | null;
  devise: Devise | null;
}

export type CleCritereGuichet =
  "actif" | "echeance" | "pays" | "secteur" | "filiere" | "taille" | "objet" | "devise" | "montant";
export type VerdictCritere = "ok" | "ko" | "inconnu" | "non_restreint";

export interface CritereRapprochement {
  critere: CleCritereGuichet;
  verdict: VerdictCritere;
  /** Explication en français. */
  detail: string;
}

export type StatutRapprochement = "compatible" | "partiel" | "exclu";

export interface ResultatRapprochement {
  guichet_id: string;
  statut: StatutRapprochement;
  score: number;
  criteres: CritereRapprochement[];
  raisons_exclusion: string[];
}

const RANG_STATUT: Record<StatutRapprochement, number> = { compatible: 0, partiel: 1, exclu: 2 };

function normaliser(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function validerDate(valeur: string, nom: string): void {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
  const d = m ? new Date(`${valeur}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valeur) {
    throw new Error(`${nom} : date AAAA-MM-JJ valide attendue (reçu « ${valeur} »).`);
  }
}

const crit = (
  critere: CleCritereGuichet,
  verdict: VerdictCritere,
  detail: string,
): CritereRapprochement => ({ critere, verdict, detail });

function critereListe(
  critere: CleCritereGuichet,
  libelle: string,
  liste: readonly string[],
  valeurs: readonly string[],
): CritereRapprochement {
  if (liste.length === 0) {
    return crit(critere, "non_restreint", `${libelle} : aucune restriction.`);
  }
  if (valeurs.length === 0) {
    return crit(
      critere,
      "inconnu",
      `${libelle} du client non renseigné ; le guichet en restreint la liste.`,
    );
  }
  const admis = new Set(liste.map(normaliser));
  const commun = valeurs.some((v) => admis.has(normaliser(v)));
  return commun
    ? crit(critere, "ok", `${libelle} du client dans la liste du guichet.`)
    : crit(critere, "ko", `${libelle} du client hors de la liste du guichet.`);
}

function critereMontant(g: GuichetFinancement, p: ProfilFinancement): CritereRapprochement {
  const { montant_min: min, montant_max: max } = g;
  if (min === null && max === null) {
    return crit("montant", "non_restreint", "Montant : aucune borne.");
  }
  if (g.devise_montant !== null && p.devise !== g.devise_montant) {
    return crit(
      "montant",
      "inconnu",
      "Devises différentes, montant non comparable (aucune conversion).",
    );
  }
  if (p.montant === null) {
    return crit("montant", "inconnu", "Montant recherché non renseigné ; le guichet le borne.");
  }
  if (min !== null && p.montant < min) {
    return crit("montant", "ko", "Montant recherché inférieur au minimum du guichet.");
  }
  if (max !== null && p.montant > max) {
    return crit("montant", "ko", "Montant recherché supérieur au maximum du guichet.");
  }
  return crit("montant", "ok", "Montant recherché dans les bornes du guichet.");
}

function evaluer(
  g: GuichetFinancement,
  p: ProfilFinancement,
  aujourdhui: string,
): ResultatRapprochement {
  const criteres: CritereRapprochement[] = [];
  criteres.push(
    g.actif ? crit("actif", "ok", "Guichet actif.") : crit("actif", "ko", "Guichet inactif."),
  );
  if (g.date_limite === null) {
    criteres.push(crit("echeance", "non_restreint", "Guichet permanent, sans date limite."));
  } else {
    validerDate(g.date_limite, `Guichet ${g.id}, date limite`);
    criteres.push(
      g.date_limite < aujourdhui
        ? crit("echeance", "ko", `Date limite dépassée (${g.date_limite}).`)
        : crit("echeance", "ok", `Date limite non dépassée (${g.date_limite}).`),
    );
  }
  const restrictifs: CritereRapprochement[] = [
    critereListe("pays", "Pays", g.pays, p.pays === null ? [] : [p.pays]),
    critereListe("secteur", "Secteur", g.secteurs, p.secteur === null ? [] : [p.secteur]),
    critereListe("filiere", "Filières", g.filieres, p.filieres),
    critereListe("taille", "Taille", g.tailles, p.taille === null ? [] : [p.taille]),
    critereListe("objet", "Objet du financement", g.objets, p.objet === null ? [] : [p.objet]),
    critereListe("devise", "Devise", g.devises, p.devise === null ? [] : [p.devise]),
    critereMontant(g, p),
  ];
  criteres.push(...restrictifs);

  const raisons_exclusion = criteres.filter((c) => c.verdict === "ko").map((c) => c.detail);
  const inconnus = criteres.some((c) => c.verdict === "inconnu");
  const statut: StatutRapprochement =
    raisons_exclusion.length > 0 ? "exclu" : inconnus ? "partiel" : "compatible";

  const pertinents = restrictifs.filter((c) => c.verdict !== "non_restreint");
  const oks = pertinents.filter((c) => c.verdict === "ok").length;
  const score =
    statut === "exclu"
      ? 0
      : pertinents.length === 0
        ? 100
        : Math.round((100 * oks) / pertinents.length);

  return { guichet_id: g.id, statut, score, criteres, raisons_exclusion };
}

/** Rapproche chaque guichet du profil ; résultat trié (voir en-tête). N'altère pas l'entrée. */
export function rapprocherGuichets(
  guichets: readonly GuichetFinancement[],
  profil: ProfilFinancement,
  aujourdhui: string,
): ResultatRapprochement[] {
  validerDate(aujourdhui, "Date du jour");
  return guichets
    .map((g) => ({ nom: g.nom, r: evaluer(g, profil, aujourdhui) }))
    .sort((a, b) => {
      const d = RANG_STATUT[a.r.statut] - RANG_STATUT[b.r.statut] || b.r.score - a.r.score;
      if (d !== 0) return d;
      const c = a.nom.localeCompare(b.nom, "fr");
      if (c !== 0) return c;
      return a.r.guichet_id < b.r.guichet_id ? -1 : a.r.guichet_id > b.r.guichet_id ? 1 : 0;
    })
    .map((x) => x.r);
}
