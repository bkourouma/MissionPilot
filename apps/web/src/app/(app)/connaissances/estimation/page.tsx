import type { Metadata } from "next";
import { FormulaireEstimation } from "../../../../components/connaissances/FormulairesConnaissances";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Base d'estimation" };

/**
 * Base d'estimation (CAP-02) : temps réels par brique, relevés à la validation des retours
 * d'expérience. Médiane et quartiles calculés par le moteur ; sous l'effectif minimum, aucune
 * statistique n'est donnée (une estimation ne repose jamais sur une ou deux missions).
 */
export default async function PageEstimation() {
  // Les durées réelles sont des jours : `budget.lire_jours` en plus (l'API le revérifie).
  await exigerPermission("connaissance.lire");
  await exigerPermission("budget.lire_jours");
  const r = await chargerServeur<{
    elements: { brique_code: string; missions: number | null }[];
    tronque: boolean;
  }>("/api/capitalisation/estimation/briques");
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre="Base d'estimation"
        soustitre="Temps réellement passés par brique de méthode sur les missions terminées, pour estimer une proposition."
      />
      <Carte titre="Estimer des briques">
        <FormulaireEstimation />
      </Carte>
      <Carte titre="Briques observées">
        {!r.ok ? (
          <EtatErreur
            titre="Les briques n'ont pas pu être chargées."
            message={r.message}
            hrefReessayer="/connaissances/estimation"
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune observation pour l'instant.">
            <p>
              Rattachez les tâches des missions aux briques de leur méthode : leurs temps entrent
              dans la base à la validation du retour d&apos;expérience.
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {r.donnees.elements.map((b) => (
              <li key={b.brique_code} className="mp-liste-lignes__ligne">
                <code>{b.brique_code}</code>
                <span className="mp-texte-doux mp-texte-petit">
                  {b.missions === null ? "historique insuffisant" : `${b.missions} missions`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}
