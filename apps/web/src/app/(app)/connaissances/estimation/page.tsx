import type { Metadata } from "next";
import { FormulaireEstimation } from "../../../../components/connaissances/FormulairesConnaissances";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Base d'estimation", "Estimation base") };
}

/**
 * Base d'estimation (CAP-02) : temps réels par brique, relevés à la validation des retours
 * d'expérience. Médiane et quartiles calculés par le moteur ; sous l'effectif minimum, aucune
 * statistique n'est donnée (une estimation ne repose jamais sur une ou deux missions).
 */
export default async function PageEstimation() {
  // Les durées réelles sont des jours : `budget.lire_jours` en plus (l'API le revérifie).
  await exigerPermission("connaissance.lire");
  await exigerPermission("budget.lire_jours");
  const t = await obtenirT();
  const r = await chargerServeur<{
    elements: { brique_code: string; missions: number | null }[];
    tronque: boolean;
  }>("/api/capitalisation/estimation/briques");
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre={t("Base d'estimation", "Estimation base")}
        soustitre={t(
          "Temps réellement passés par brique de méthode sur les missions terminées, pour estimer une proposition.",
          "Time actually spent per method building block on completed engagements, to estimate a proposal.",
        )}
      />
      <Carte titre={t("Estimer des briques", "Estimate building blocks")}>
        <FormulaireEstimation />
      </Carte>
      <Carte titre={t("Briques observées", "Observed building blocks")}>
        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les briques n'ont pas pu être chargées.",
              "The building blocks could not be loaded.",
            )}
            message={r.message}
            hrefReessayer="/connaissances/estimation"
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide titre={t("Aucune observation pour l'instant.", "No observation yet.")}>
            <p>
              {t(
                "Rattachez les tâches des missions aux briques de leur méthode : leurs temps entrent dans la base à la validation du retour d'expérience.",
                "Link the engagements' tasks to the building blocks of their method: their times enter the base when the lessons-learned review is approved.",
              )}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {r.donnees.elements.map((b) => (
              <li key={b.brique_code} className="mp-liste-lignes__ligne">
                <code>{b.brique_code}</code>
                <span className="mp-texte-doux mp-texte-petit">
                  {b.missions === null
                    ? t("historique insuffisant", "insufficient history")
                    : t(`${b.missions} missions`, `${b.missions} engagements`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}
