import type { RedClotureContenu } from "@missionpilot/shared";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

/**
 * Contrôles de complétude du bilan : les contrôles bloquants non satisfaits empêchent la
 * validation et sont nommés ; les contrôles informatifs signalent seulement ce qui manque.
 */
export function ClotureControles({ contenu }: { contenu: RedClotureContenu }) {
  const manquantsBloquants = contenu.controles.filter((c) => c.bloquant && !c.satisfait);
  return (
    <Carte titre="Contrôles de complétude" niveauTitre={3}>
      <div className="mp-pile">
        <p>
          {manquantsBloquants.length === 0
            ? "Tous les contrôles bloquants sont satisfaits."
            : `${manquantsBloquants.length} contrôle(s) bloquant(s) à satisfaire avant la validation.`}
        </p>
        <ul className="mp-clo-controles" aria-label="Contrôles de complétude du bilan">
          {contenu.controles.map((c) => (
            <li key={c.code}>
              <span className="mp-clo-controles__libelle">{c.libelle}</span>
              <BadgeStatut tonalite="neutre" sansIcone>
                {c.bloquant ? "Bloquant" : "Informatif"}
              </BadgeStatut>
              <BadgeStatut tonalite={c.satisfait ? "succes" : c.bloquant ? "attention" : "neutre"}>
                {c.satisfait ? "Satisfait" : "Manquant"}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      </div>
    </Carte>
  );
}
