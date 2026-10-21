import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Tableau, type ColonneTableau } from "../../../../components/ui/Tableau";
import { libelleTache } from "../../../../lib/ia";
import { libelleCritere, libellePlafondJetons, type RouteTacheVue } from "./routage-cache";

/**
 * Routage des modèles par tâche (AGT-06), en lecture : modèle recommandé par MissionPilot et ce
 * qui a guidé son choix (coût, qualité, rapidité), modèle appliqué au cabinet, plafond de jetons
 * de sortie de la tâche (il borne aussi le coût réservé avant chaque appel). Le choix du modèle
 * se fait dans « Modèle par tâche ».
 */
const COLONNES: readonly ColonneTableau<RouteTacheVue>[] = [
  { cle: "tache", entete: "Tâche", rendu: (l) => libelleTache(l.tache) },
  {
    cle: "critere",
    entete: "Critère du choix",
    rendu: (l) => (
      <>
        <BadgeStatut tonalite="neutre">{libelleCritere(l.critere)}</BadgeStatut>
        {l.motif ? <span className="mp-texte-petit mp-texte-doux"> {l.motif}</span> : null}
      </>
    ),
  },
  {
    cle: "modele_recommande",
    entete: "Modèle recommandé",
    rendu: (l) => <span className="mp-ia-code">{l.modele_recommande}</span>,
  },
  {
    cle: "modele_applique",
    entete: "Modèle appliqué",
    rendu: (l) => (
      <>
        <span className="mp-ia-code">{l.modele_applique}</span>
        {l.personnalise ? (
          <span className="mp-texte-petit mp-texte-doux"> (choisi par le cabinet)</span>
        ) : null}
      </>
    ),
  },
  {
    cle: "plafond_jetons_sortie",
    entete: "Sortie maximale",
    alignement: "droite",
    rendu: (l) => libellePlafondJetons(l.plafond_jetons_sortie),
  },
];

export function RoutageIa({ routage }: { routage: readonly RouteTacheVue[] }) {
  return (
    <div className="mp-pile">
      <p className="mp-texte-petit mp-texte-doux">
        Chaque tâche suit un modèle choisi pour son équilibre entre coût, qualité et rapidité. Les
        plafonds de coût du cabinet et des missions s&apos;appliquent à toutes les tâches.
      </p>
      <Tableau
        legende="Routage des modèles par tâche"
        colonnes={COLONNES}
        lignes={routage}
        cleLigne={(l) => l.tache}
        messageVide="Le routage des modèles n'est pas disponible."
      />
    </div>
  );
}
