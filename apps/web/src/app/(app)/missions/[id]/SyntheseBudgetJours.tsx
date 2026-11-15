import { creerTraduire, type Langue } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { Tableau } from "../../../../components/ui/Tableau";
import { couleurBadge, phasesSynthese, type NoeudSynthese } from "../../../../lib/decoupage";
import { formaterJours, formaterPourcentage } from "../../../../lib/format";
import { obtenirLangue } from "../../../../lib/i18n/serveur";

/** Signe explicite d'un écart en jours : « +2 j », « −1,5 j », « 0 j ». */
function ecart(valeur: number, relatif: number | null, langue: Langue): string {
  const signe = valeur > 0 ? "+" : valeur < 0 ? "−" : "";
  const jours = `${signe}${formaterJours(Math.abs(valeur), langue)}`;
  return relatif === null
    ? jours
    : `${jours} (${signe}${formaterPourcentage(Math.abs(relatif), 1, langue)})`;
}

/**
 * Synthèse budget / réalisé / reste à faire / atterrissage par phase (PLN-02, TPS-06), calculée
 * par le moteur planning de l'API. L'état est un badge avec texte : jamais la couleur seule.
 */
export async function SyntheseBudgetJours({ racine }: { racine: NoeudSynthese }) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const lignes = [
    ...phasesSynthese(racine),
    { ...racine, libelle: t("Total de la mission", "Engagement total") },
  ];
  return (
    <Carte titre={t("Budget en jours par phase", "Budget in days by phase")}>
      <div className="mp-pile">
        <Tableau
          legende={t(
            "Budget, réalisé, reste à faire et atterrissage par phase",
            "Budget, actual, remaining work and landing by phase",
          )}
          lignes={lignes}
          cleLigne={(n) => n.id}
          messageVide={t("Aucune phase.", "No phases.")}
          colonnes={[
            {
              cle: "phase",
              entete: t("Phase", "Phase"),
              rendu: (n) =>
                n.niveau === "mission" ? <strong>{n.libelle}</strong> : (n.libelle ?? "—"),
            },
            {
              cle: "budget",
              entete: t("Budget", "Budget"),
              alignement: "droite",
              rendu: (n) => formaterJours(n.suivi.budget, langue),
            },
            {
              cle: "realise",
              entete: t("Réalisé", "Actual"),
              alignement: "droite",
              rendu: (n) => formaterJours(n.suivi.realise, langue),
            },
            {
              cle: "reste",
              entete: t("Reste à faire", "Remaining"),
              alignement: "droite",
              rendu: (n) => formaterJours(n.suivi.resteAFaire, langue),
            },
            {
              cle: "atterrissage",
              entete: t("Atterrissage", "Landing"),
              alignement: "droite",
              rendu: (n) => formaterJours(n.suivi.atterrissage, langue),
            },
            {
              cle: "ecart",
              entete: t("Écart", "Variance"),
              alignement: "droite",
              rendu: (n) => ecart(n.suivi.ecart, n.suivi.ecartRelatif, langue),
            },
            {
              cle: "etat",
              entete: t("État", "Status"),
              rendu: (n) => {
                const b = couleurBadge(n.couleur, langue);
                return b ? <BadgeStatut tonalite={b.tonalite}>{b.libelle}</BadgeStatut> : "—";
              },
            },
          ]}
        />
        <p className="mp-texte-doux">
          {t(
            "Le réalisé provient des feuilles de temps validées ; le détail par tâche, personne et grade, avec le reste à faire déclaré, est dans l'onglet Suivi.",
            "Actuals come from approved timesheets; the detail by task, person and grade, with the declared remaining work, is in the Tracking tab.",
          )}
        </p>
      </div>
    </Carte>
  );
}
