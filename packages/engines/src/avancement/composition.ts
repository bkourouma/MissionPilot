import { analyserDateISO } from "../commun/dates";
import { ajouterJours, jourSemaine } from "../planning/dates";
import {
  ErreurAvancement,
  PLAFOND_JALONS_PAR_LISTE,
  PLAFOND_KPI_RAPPORT,
  PLAFOND_LIBELLE_RAPPORT,
  PLAFOND_LIVRABLES_RAPPORT,
  VERSION_CONTENU_AVANCEMENT,
  type AvancementHebdo,
  type FaitSaillant,
  type FaitsAvancementHebdo,
  type JalonFait,
  type JalonRapport,
  type KpiFait,
  type KpiRapport,
  type ListeJalonsRapport,
  type StatutKpiRapport,
} from "./types";

/*
 * Composition du rapport d'avancement hebdomadaire (AUT-10). Fonction pure et déterministe : mêmes
 * faits, même contenu (tri total, aucune horloge, aucun hasard). Les libellés repris des faits sont
 * nettoyés (caractères de contrôle et chevrons retirés, longueur bornée) ; aucun montant n'entre ni
 * ne sort.
 */

const nettoyer = (texte: string): string =>
  texte
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PLAFOND_LIBELLE_RAPPORT);

function exigerDate(date: string, code: "SEMAINE_INVALIDE" | "DATE_INVALIDE"): void {
  if (!analyserDateISO(date).valide) throw new ErreurAvancement(code, `Date invalide : ${code}.`);
}

function exigerNombreFini(valeur: number | null, quoi: string): void {
  if (valeur !== null && !Number.isFinite(valeur)) {
    throw new ErreurAvancement("FAIT_INVALIDE", `${quoi} : nombre fini attendu.`);
  }
}

const comparerTexte = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function listeJalons(jalons: readonly JalonFait[], decroissant: boolean): ListeJalonsRapport {
  const tries = [...jalons].sort((a, b) => {
    const d = comparerTexte(a.datePrevue ?? "", b.datePrevue ?? "");
    return (decroissant ? -d : d) || comparerTexte(a.libelle, b.libelle);
  });
  const elements: JalonRapport[] = tries.slice(0, PLAFOND_JALONS_PAR_LISTE).map((j) => ({
    libelle: nettoyer(j.libelle),
    date_prevue: j.datePrevue,
  }));
  return { nombre: jalons.length, elements };
}

const STATUT_RAPPORT: Record<KpiFait["statut"], StatutKpiRapport> = {
  vert: "vert",
  orange: "orange",
  rouge: "rouge",
  non_mesure: "non_evalue",
  sans_cible: "non_evalue",
};

/** Ordre d'affichage des KPI : les rouges d'abord. */
const RANG_STATUT: Record<StatutKpiRapport, number> = {
  rouge: 0,
  orange: 1,
  vert: 2,
  non_evalue: 3,
};

const pluriel = (n: number, singulier: string, plurielTexte: string) =>
  n > 1 ? plurielTexte : singulier;

function phrases(c: Omit<AvancementHebdo, "faits_saillants">): FaitSaillant[] {
  const p: FaitSaillant[] = [];
  if (c.avancement.pourcentage === null) {
    p.push({
      code: "avancement",
      texte: "Avancement physique non mesurable : aucun jalon ni livrable suivi.",
    });
  } else {
    const e = c.avancement.elements;
    p.push({
      code: "avancement",
      texte: `Avancement physique : ${c.avancement.pourcentage} % (${e} ${pluriel(e, "élément suivi", "éléments suivis")}).`,
    });
  }
  const j = c.jalons;
  if (j.total > 0) {
    const n = j.atteints.nombre;
    p.push({
      code: "jalons_atteints",
      texte: `${n} ${pluriel(n, "jalon atteint", "jalons atteints")} sur ${j.total}.`,
    });
  }
  if (j.en_retard.nombre > 0) {
    const n = j.en_retard.nombre;
    p.push({
      code: "jalons_en_retard",
      texte: `${n} ${pluriel(n, "jalon en retard", "jalons en retard")}.`,
    });
  }
  if (j.a_venir.nombre > 0) {
    const n = j.a_venir.nombre;
    p.push({
      code: "jalons_a_venir",
      texte: `${n} ${pluriel(n, "jalon à venir", "jalons à venir")}.`,
    });
  }
  if (c.kpis.total > 0) {
    const n = c.kpis.non_evalue;
    p.push({
      code: "kpis",
      texte: `Indicateurs : ${c.kpis.vert} au vert, ${c.kpis.orange} à l'orange, ${c.kpis.rouge} au rouge, ${n} non ${pluriel(n, "évalué", "évalués")}.`,
    });
  }
  if (c.livrables.partages > 0) {
    const n = c.livrables.partages;
    p.push({
      code: "livrables",
      texte: `${n} ${pluriel(n, "livrable partagé", "livrables partagés")}.`,
    });
  }
  return p;
}

/** Contenu structuré du rapport d'avancement d'une semaine (AUT-10). */
export function composerAvancementHebdo(faits: FaitsAvancementHebdo): AvancementHebdo {
  exigerDate(faits.semaine, "SEMAINE_INVALIDE");
  if (jourSemaine(faits.semaine) !== 1) {
    throw new ErreurAvancement("SEMAINE_INVALIDE", "La semaine est désignée par son lundi.");
  }
  exigerDate(faits.dateReference, "DATE_INVALIDE");
  for (const j of faits.jalons) {
    if (j.datePrevue !== null) exigerDate(j.datePrevue, "DATE_INVALIDE");
  }
  if (
    faits.avancement !== null &&
    !(Number.isFinite(faits.avancement) && faits.avancement >= 0 && faits.avancement <= 1)
  ) {
    throw new ErreurAvancement("AVANCEMENT_INVALIDE", "L'avancement est une fraction de 0 à 1.");
  }
  if (!Number.isInteger(faits.elementsAvancement) || faits.elementsAvancement < 0) {
    throw new ErreurAvancement("FAIT_INVALIDE", "Nombre d'éléments invalide.");
  }
  for (const k of faits.kpis) {
    exigerNombreFini(k.valeur, "Valeur de KPI");
    exigerNombreFini(k.cible, "Cible de KPI");
  }

  const ref = faits.dateReference;
  const atteints = faits.jalons.filter((j) => j.atteint);
  const ouverts = faits.jalons.filter((j) => !j.atteint);
  const enRetard = ouverts.filter((j) => j.datePrevue !== null && j.datePrevue < ref);
  const aVenir = ouverts.filter((j) => j.datePrevue !== null && j.datePrevue >= ref);
  const sansDate = ouverts.filter((j) => j.datePrevue === null).length;

  const kpis: KpiRapport[] = faits.kpis
    .map((k) => ({
      libelle: nettoyer(k.libelle),
      unite: nettoyer(k.unite),
      valeur: k.valeur,
      cible: k.cible,
      statut: STATUT_RAPPORT[k.statut],
      periode: k.periode,
    }))
    .sort(
      (a, b) =>
        RANG_STATUT[a.statut] - RANG_STATUT[b.statut] || comparerTexte(a.libelle, b.libelle),
    );
  const nombreKpi = (s: StatutKpiRapport) => kpis.filter((k) => k.statut === s).length;

  const partages = faits.livrables.filter((l) => l.partage);
  const elementsLivrables = partages
    .map((l) => ({ nom: nettoyer(l.nom), type: nettoyer(l.type), version: l.version }))
    .sort(
      (a, b) =>
        comparerTexte(a.type, b.type) || comparerTexte(a.nom, b.nom) || a.version - b.version,
    )
    .slice(0, PLAFOND_LIVRABLES_RAPPORT);

  const base: Omit<AvancementHebdo, "faits_saillants"> = {
    version: VERSION_CONTENU_AVANCEMENT,
    semaine: faits.semaine,
    semaine_fin: ajouterJours(faits.semaine, 6),
    date_reference: ref,
    mission: { intitule: nettoyer(faits.mission.intitule), statut: faits.mission.statut },
    avancement: {
      pourcentage: faits.avancement === null ? null : Math.round(faits.avancement * 100),
      elements: faits.elementsAvancement,
    },
    jalons: {
      total: faits.jalons.length,
      atteints: listeJalons(atteints, true),
      en_retard: listeJalons(enRetard, false),
      a_venir: listeJalons(aVenir, false),
      sans_date: sansDate,
    },
    kpis: {
      total: kpis.length,
      vert: nombreKpi("vert"),
      orange: nombreKpi("orange"),
      rouge: nombreKpi("rouge"),
      non_evalue: nombreKpi("non_evalue"),
      elements: kpis.slice(0, PLAFOND_KPI_RAPPORT),
    },
    livrables: {
      total: faits.livrables.length,
      partages: partages.length,
      non_partages: faits.livrables.length - partages.length,
      elements: elementsLivrables,
    },
  };
  return { ...base, faits_saillants: phrases(base) };
}
