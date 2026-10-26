import type { SessionDemo } from "../contexte.js";
import { lire } from "./dd-outils.js";

/*
 * Faits du dossier Mboa Solaire dont les notes ont besoin, LUS par les routes du dossier
 * (synthèse et hypothèses) : aucun chiffre n'est écrit à la main, les montants et écarts sont ceux
 * des moteurs de la due diligence (dimensionnement de marché, recoupement, filtrage E&S, plan).
 * Ce module ne fait que lire et mettre en forme (montants en XOF, pourcentages, libellés).
 */

export type VerdictLu = "confirmee" | "infirmee" | "non_concluante";

export interface HypotheseLue {
  libelle: string;
  verdict: VerdictLu | null;
}

export interface MethodeMarche {
  methode: string;
  bas: number;
  base: number;
  haut: number;
  avisExpert: number;
  total: number;
}

export interface FaitsDossier {
  cible: string;
  titre: string;
  dateOperation: string | null;
  hypotheses: HypotheseLue[];
  marche: MethodeMarche[];
  ecartMarchePourcent: string | null;
  alerteMarche: boolean;
  risquesTotal: number;
  risquesEleves: number;
  esNiveau: string | null;
  esBloquantes: number;
  esThemes: number;
  esModeres: number;
  actions: string[];
  sources: { solides: number; etayees: number; fragiles: number };
  signauxConstates: number;
  signauxApplicables: number;
}

/** Montant en XOF lisible : « 4,0 milliards XOF » ou « 850 millions XOF ». */
export function montantXof(n: number): string {
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `${v.toFixed(1).replace(".", ",")} milliard${v >= 2 ? "s" : ""} XOF`;
  }
  return `${Math.round(n / 1_000_000)} millions XOF`;
}

export function libelleVerdict(v: VerdictLu | null): string {
  if (v === "infirmee") return "infirmée";
  if (v === "confirmee") return "confirmée";
  if (v === "non_concluante") return "non concluante";
  return "sans verdict";
}

interface SyntheseLue {
  cadrage: { titre: string; date_operation: string | null };
  sources: { solides: number; etayees: number; fragiles: number };
  marche: {
    dimensionnements: {
      methode: string;
      resultat: { bas: number; base: number; haut: number };
      couverture: { total: number; avis_expert: number };
    }[];
    recoupement: { ecart_bp: number; alerte: boolean } | null;
  };
  risques: { total: number; familles: { par_niveau: Record<string, number> }[] };
  filtrage_es: {
    niveau_global: string | null;
    touches_bloquantes: number;
    par_niveau: Record<string, number>;
  } | null;
  signaux: { applicables: number; constates: number };
}

interface HypothesesLues {
  noeuds: { libelle: string; verdict_en_vigueur: { verdict: VerdictLu } | null }[];
}

export async function lireFaits(
  session: SessionDemo,
  dossierId: string,
  cible: string,
): Promise<FaitsDossier> {
  const s = await lire<SyntheseLue>(session, `/api/dd/dossiers/${dossierId}/synthese`, "synthèse");
  const h = await lire<HypothesesLues>(
    session,
    `/api/dd/dossiers/${dossierId}/hypotheses`,
    "hypothèses",
  );
  const plan = await lire<{ actions: { libelle: string }[] }>(
    session,
    `/api/dd/dossiers/${dossierId}/plan-100j`,
    "plan des 100 jours",
  );
  const niveaux = s.filtrage_es?.par_niveau ?? {};
  const themes = Object.values(niveaux).reduce((a, b) => a + b, 0);
  return {
    cible,
    titre: s.cadrage.titre,
    dateOperation: s.cadrage.date_operation,
    hypotheses: h.noeuds.map((n) => ({
      libelle: n.libelle,
      verdict: n.verdict_en_vigueur?.verdict ?? null,
    })),
    marche: s.marche.dimensionnements.map((d) => ({
      methode: d.methode,
      bas: d.resultat.bas,
      base: d.resultat.base,
      haut: d.resultat.haut,
      avisExpert: d.couverture.avis_expert,
      total: d.couverture.total,
    })),
    ecartMarchePourcent:
      s.marche.recoupement === null
        ? null
        : (s.marche.recoupement.ecart_bp / 100).toFixed(1).replace(".", ","),
    alerteMarche: s.marche.recoupement?.alerte ?? false,
    risquesTotal: s.risques.total,
    risquesEleves: s.risques.familles.reduce((a, f) => a + (f.par_niveau["eleve"] ?? 0), 0),
    esNiveau: s.filtrage_es?.niveau_global ?? null,
    esBloquantes: s.filtrage_es?.touches_bloquantes ?? 0,
    esThemes: themes,
    esModeres: (niveaux["modere"] ?? 0) + (niveaux["eleve"] ?? 0) + (niveaux["critique"] ?? 0),
    actions: plan.actions.map((a) => a.libelle),
    sources: s.sources,
    signauxConstates: s.signaux.constates,
    signauxApplicables: s.signaux.applicables,
  };
}
