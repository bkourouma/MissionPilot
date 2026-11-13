import type { ReactNode } from "react";
import type { Langue, RedClotureContenu, RedEvolutionCloture } from "@missionpilot/shared";
import { formaterMontantMineur, formaterNombre, VALEUR_ABSENTE } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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

type Instant<T> = T | null;

function texteAlerte(a: Instant<RedClotureContenu["alerte"]["fin"]>, langue: Langue): string {
  return a
    ? `${libelleScore(a.score, a.niveau, langue)} (${libelleNiveauAlerte(a.niveau, langue)})`
    : VALEUR_ABSENTE;
}

function texteUrgence(u: Instant<RedClotureContenu["urgence"]["fin"]>, langue: Langue): string {
  if (!u) return VALEUR_ABSENTE;
  const n = u.domaines_rouges;
  const nb = formaterNombre(n, 0, langue);
  if (langue === "en") {
    return `${libelleVoyant(u.voyant, langue)}, ${nb} critical ${n > 1 ? "areas" : "area"}`;
  }
  return `${libelleVoyant(u.voyant, langue)}, ${nb} ${n > 1 ? "domaines" : "domaine"} critique${n > 1 ? "s" : ""}`;
}

function lignes(c: RedClotureContenu, langue: Langue): LigneEvolution[] {
  const en = langue === "en";
  const t = c.tresorerie;
  const devise = c.devise;
  const mt = (v: number | undefined) =>
    v === undefined ? VALEUR_ABSENTE : formaterMontantMineur(v, devise, langue);
  return [
    {
      cle: "alerte",
      libelle: en ? "Early-warning score" : "Score d'alerte précoce",
      ouverture: texteAlerte(c.alerte.ouverture, langue),
      fin: texteAlerte(c.alerte.fin, langue),
      variation: formaterVariationPoints(c.alerte.variation_points, langue),
      evolution: c.alerte.evolution,
    },
    {
      cle: "urgence",
      libelle: en ? "Urgency assessment" : "Évaluation d'urgence",
      ouverture: texteUrgence(c.urgence.ouverture, langue),
      fin: texteUrgence(c.urgence.fin, langue),
      variation: formaterVariationEntier(c.urgence.variation_domaines_rouges, langue),
      evolution: c.urgence.evolution,
    },
    {
      cle: "besoin",
      libelle: en ? "Financing need (13 weeks)" : "Besoin de financement (13 semaines)",
      ouverture: mt(t.ouverture?.besoin_financement),
      fin: mt(t.fin?.besoin_financement),
      variation: formaterVariationMontant(t.variation_besoin_financement, devise, langue),
      evolution: t.evolution,
    },
    {
      cle: "tension",
      libelle: en ? "Cash strain weeks" : "Semaines de tension de trésorerie",
      ouverture: t.ouverture
        ? formaterNombre(t.ouverture.semaines_tension, 0, langue)
        : VALEUR_ABSENTE,
      fin: t.fin ? formaterNombre(t.fin.semaines_tension, 0, langue) : VALEUR_ABSENTE,
      variation: formaterVariationEntier(t.variation_semaines_tension, langue),
      evolution: null,
    },
    {
      cle: "premiere",
      libelle: en ? "First strain week" : "Première semaine de tension",
      ouverture: t.ouverture
        ? libelleSemaineTension(t.ouverture.premiere_semaine_tension, langue)
        : VALEUR_ABSENTE,
      fin: t.fin ? libelleSemaineTension(t.fin.premiere_semaine_tension, langue) : VALEUR_ABSENTE,
      variation: VALEUR_ABSENTE,
      evolution: null,
    },
    {
      cle: "solde",
      libelle: en ? "Forecast minimum balance" : "Solde minimum prévu",
      ouverture: mt(t.ouverture?.solde_minimum),
      fin: mt(t.fin?.solde_minimum),
      variation: VALEUR_ABSENTE,
      evolution: null,
    },
  ];
}

/** Alerte précoce, urgence et trésorerie : état d'ouverture → état de fin, avec l'évolution du moteur. */
export async function ClotureEvolutions({ contenu }: { contenu: RedClotureContenu }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const colonnes: ColonneTableau<LigneEvolution>[] = [
    { cle: "libelle", entete: t("Indicateur", "Indicator") },
    {
      cle: "ouverture",
      entete: t("Ouverture", "Opening"),
      alignement: "droite",
      rendu: (l) => l.ouverture,
    },
    { cle: "fin", entete: t("Fin", "End"), alignement: "droite", rendu: (l) => l.fin },
    {
      cle: "variation",
      entete: t("Variation", "Change"),
      alignement: "droite",
      rendu: (l) => l.variation,
    },
    {
      cle: "evolution",
      entete: t("Évolution", "Trend"),
      rendu: (l) =>
        l.evolution ? <EvolutionBadge evolution={l.evolution} langue={langue} /> : VALEUR_ABSENTE,
    },
  ];
  return (
    <Carte titre={t("Alerte, urgence et trésorerie", "Alert, urgency and cash")} niveauTitre={3}>
      <Tableau
        legende={t(
          "Alerte précoce, urgence et trésorerie, de l'ouverture à la fin",
          "Early warning, urgency and cash, from opening to end",
        )}
        colonnes={colonnes}
        lignes={lignes(contenu, langue)}
        cleLigne={(l) => l.cle}
      />
    </Carte>
  );
}
