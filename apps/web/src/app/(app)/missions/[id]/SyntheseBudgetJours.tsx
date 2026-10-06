import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { Tableau } from "../../../../components/ui/Tableau";
import { COULEUR_BADGE, phasesSynthese, type NoeudSynthese } from "../../../../lib/decoupage";
import { formaterJours, formaterPourcentage } from "../../../../lib/format";

/** Signe explicite d'un écart en jours : « +2 j », « −1,5 j », « 0 j ». */
function ecart(valeur: number, relatif: number | null): string {
  const signe = valeur > 0 ? "+" : valeur < 0 ? "−" : "";
  const jours = `${signe}${formaterJours(Math.abs(valeur))}`;
  return relatif === null ? jours : `${jours} (${signe}${formaterPourcentage(Math.abs(relatif))})`;
}

/**
 * Synthèse budget / réalisé / reste à faire / atterrissage par phase (PLN-02, TPS-06), calculée
 * par le moteur planning de l'API. L'état est un badge avec texte : jamais la couleur seule.
 */
export function SyntheseBudgetJours({ racine }: { racine: NoeudSynthese }) {
  const lignes = [...phasesSynthese(racine), { ...racine, libelle: "Total de la mission" }];
  return (
    <Carte titre="Budget en jours par phase">
      <div className="mp-pile">
        <Tableau
          legende="Budget, réalisé, reste à faire et atterrissage par phase"
          lignes={lignes}
          cleLigne={(n) => n.id}
          messageVide="Aucune phase."
          colonnes={[
            {
              cle: "phase",
              entete: "Phase",
              rendu: (n) =>
                n.niveau === "mission" ? <strong>{n.libelle}</strong> : (n.libelle ?? "—"),
            },
            {
              cle: "budget",
              entete: "Budget",
              alignement: "droite",
              rendu: (n) => formaterJours(n.suivi.budget),
            },
            {
              cle: "realise",
              entete: "Réalisé",
              alignement: "droite",
              rendu: (n) => formaterJours(n.suivi.realise),
            },
            {
              cle: "reste",
              entete: "Reste à faire",
              alignement: "droite",
              rendu: (n) => formaterJours(n.suivi.resteAFaire),
            },
            {
              cle: "atterrissage",
              entete: "Atterrissage",
              alignement: "droite",
              rendu: (n) => formaterJours(n.suivi.atterrissage),
            },
            {
              cle: "ecart",
              entete: "Écart",
              alignement: "droite",
              rendu: (n) => ecart(n.suivi.ecart, n.suivi.ecartRelatif),
            },
            {
              cle: "etat",
              entete: "État",
              rendu: (n) => (
                <BadgeStatut tonalite={COULEUR_BADGE[n.couleur].tonalite}>
                  {COULEUR_BADGE[n.couleur].libelle}
                </BadgeStatut>
              ),
            },
          ]}
        />
        <p className="mp-texte-doux">
          Le réalisé provient des feuilles de temps validées ; le détail par tâche, personne et
          grade, avec le reste à faire déclaré, est dans l&apos;onglet Suivi.
        </p>
      </div>
    </Carte>
  );
}
