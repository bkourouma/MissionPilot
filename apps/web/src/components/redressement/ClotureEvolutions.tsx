import type { ReactNode } from "react";
import type { RedClotureContenu, RedEvolutionCloture } from "@missionpilot/shared";
import { formaterMontantMineur, formaterNombre, VALEUR_ABSENTE } from "../../lib/format";
import { libelleNiveauAlerte, libelleScore, libelleVoyant } from "../../lib/redressement";
import {
  formaterVariationEntier,
  formaterVariationMontant,
  formaterVariationPoints,
  libelleSemaineTension,
} from "../../lib/redressement-cloture";
import { Carte } from "../ui/Carte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { EvolutionBadge } from "./ClotureRatios";

interface LigneEvolution {
  cle: string;
  libelle: string;
  ouverture: ReactNode;
  fin: ReactNode;
  variation: ReactNode;
  evolution: RedEvolutionCloture | null;
}

const COLONNES: ColonneTableau<LigneEvolution>[] = [
  { cle: "libelle", entete: "Indicateur" },
  { cle: "ouverture", entete: "Ouverture", alignement: "droite", rendu: (l) => l.ouverture },
  { cle: "fin", entete: "Fin", alignement: "droite", rendu: (l) => l.fin },
  { cle: "variation", entete: "Variation", alignement: "droite", rendu: (l) => l.variation },
  {
    cle: "evolution",
    entete: "Évolution",
    rendu: (l) => (l.evolution ? <EvolutionBadge evolution={l.evolution} /> : VALEUR_ABSENTE),
  },
];

type Instant<T> = T | null;

function texteAlerte(a: Instant<RedClotureContenu["alerte"]["fin"]>): string {
  return a
    ? `${libelleScore(a.score, a.niveau)} (${libelleNiveauAlerte(a.niveau)})`
    : VALEUR_ABSENTE;
}

function texteUrgence(u: Instant<RedClotureContenu["urgence"]["fin"]>): string {
  if (!u) return VALEUR_ABSENTE;
  const n = u.domaines_rouges;
  return `${libelleVoyant(u.voyant)}, ${formaterNombre(n, 0)} ${n > 1 ? "domaines" : "domaine"} critique${n > 1 ? "s" : ""}`;
}

function lignes(c: RedClotureContenu): LigneEvolution[] {
  const t = c.tresorerie;
  const devise = c.devise;
  const mt = (v: number | undefined) =>
    v === undefined ? VALEUR_ABSENTE : formaterMontantMineur(v, devise);
  return [
    {
      cle: "alerte",
      libelle: "Score d'alerte précoce",
      ouverture: texteAlerte(c.alerte.ouverture),
      fin: texteAlerte(c.alerte.fin),
      variation: formaterVariationPoints(c.alerte.variation_points),
      evolution: c.alerte.evolution,
    },
    {
      cle: "urgence",
      libelle: "Évaluation d'urgence",
      ouverture: texteUrgence(c.urgence.ouverture),
      fin: texteUrgence(c.urgence.fin),
      variation: formaterVariationEntier(c.urgence.variation_domaines_rouges),
      evolution: c.urgence.evolution,
    },
    {
      cle: "besoin",
      libelle: "Besoin de financement (13 semaines)",
      ouverture: mt(t.ouverture?.besoin_financement),
      fin: mt(t.fin?.besoin_financement),
      variation: formaterVariationMontant(t.variation_besoin_financement, devise),
      evolution: t.evolution,
    },
    {
      cle: "tension",
      libelle: "Semaines de tension de trésorerie",
      ouverture: t.ouverture ? formaterNombre(t.ouverture.semaines_tension, 0) : VALEUR_ABSENTE,
      fin: t.fin ? formaterNombre(t.fin.semaines_tension, 0) : VALEUR_ABSENTE,
      variation: formaterVariationEntier(t.variation_semaines_tension),
      evolution: null,
    },
    {
      cle: "premiere",
      libelle: "Première semaine de tension",
      ouverture: t.ouverture
        ? libelleSemaineTension(t.ouverture.premiere_semaine_tension)
        : VALEUR_ABSENTE,
      fin: t.fin ? libelleSemaineTension(t.fin.premiere_semaine_tension) : VALEUR_ABSENTE,
      variation: VALEUR_ABSENTE,
      evolution: null,
    },
    {
      cle: "solde",
      libelle: "Solde minimum prévu",
      ouverture: mt(t.ouverture?.solde_minimum),
      fin: mt(t.fin?.solde_minimum),
      variation: VALEUR_ABSENTE,
      evolution: null,
    },
  ];
}

/** Alerte précoce, urgence et trésorerie : état d'ouverture → état de fin, avec l'évolution du moteur. */
export function ClotureEvolutions({ contenu }: { contenu: RedClotureContenu }) {
  return (
    <Carte titre="Alerte, urgence et trésorerie" niveauTitre={3}>
      <Tableau
        legende="Alerte précoce, urgence et trésorerie, de l'ouverture à la fin"
        colonnes={COLONNES}
        lignes={lignes(contenu)}
        cleLigne={(l) => l.cle}
      />
    </Carte>
  );
}
