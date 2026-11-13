import type { Langue, Traduire } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Tableau, type ColonneTableau } from "../../../../components/ui/Tableau";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { libelleTache } from "../../../../lib/ia";
import { libelleCritere, libellePlafondJetons, type RouteTacheVue } from "./routage-cache";

/**
 * Routage des modèles par tâche (AGT-06), en lecture : modèle recommandé par CabinetPilot et ce
 * qui a guidé son choix (coût, qualité, rapidité), modèle appliqué au cabinet, plafond de jetons
 * de sortie de la tâche (il borne aussi le coût réservé avant chaque appel). Le choix du modèle
 * se fait dans « Modèle par tâche ».
 */
const colonnes = (t: Traduire, langue: Langue): readonly ColonneTableau<RouteTacheVue>[] => [
  { cle: "tache", entete: t("Tâche", "Task"), rendu: (l) => libelleTache(l.tache, langue) },
  {
    cle: "critere",
    entete: t("Critère du choix", "Selection criterion"),
    rendu: (l) => (
      <span>
        <BadgeStatut tonalite="neutre">{libelleCritere(l.critere, langue)}</BadgeStatut>
        {l.motif ? <span className="mp-texte-petit mp-texte-doux"> {l.motif}</span> : null}
      </span>
    ),
  },
  {
    cle: "modele_recommande",
    entete: t("Modèle recommandé", "Recommended model"),
    rendu: (l) => <span className="mp-ia-code">{l.modele_recommande}</span>,
  },
  {
    cle: "modele_applique",
    entete: t("Modèle appliqué", "Applied model"),
    rendu: (l) => (
      <span>
        <span className="mp-ia-code">{l.modele_applique}</span>
        {l.personnalise ? (
          <span className="mp-texte-petit mp-texte-doux">
            {" "}
            {t("(choisi par le cabinet)", "(chosen by the firm)")}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    cle: "plafond_jetons_sortie",
    entete: t("Sortie maximale", "Maximum output"),
    alignement: "droite",
    rendu: (l) => libellePlafondJetons(l.plafond_jetons_sortie, langue),
  },
];

export async function RoutageIa({ routage }: { routage: readonly RouteTacheVue[] }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <div className="mp-pile">
      <p className="mp-texte-petit mp-texte-doux">
        {t(
          "Chaque tâche suit un modèle choisi pour son équilibre entre coût, qualité et rapidité. Les plafonds de coût du cabinet et des missions s'appliquent à toutes les tâches.",
          "Each task follows a model chosen for its balance between cost, quality and speed. The firm's and engagements' cost ceilings apply to all tasks.",
        )}
      </p>
      <Tableau
        legende={t("Routage des modèles par tâche", "Model routing per task")}
        colonnes={colonnes(t, langue)}
        lignes={routage}
        cleLigne={(l) => l.tache}
        messageVide={t(
          "Le routage des modèles n'est pas disponible.",
          "Model routing is not available.",
        )}
      />
    </div>
  );
}
