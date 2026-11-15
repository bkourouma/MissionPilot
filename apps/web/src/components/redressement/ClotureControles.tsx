import type { RedClotureContenu } from "@missionpilot/shared";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { libelleControle } from "../../lib/redressement-cloture";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

/**
 * Contrôles de complétude du bilan : les contrôles bloquants non satisfaits empêchent la
 * validation et sont nommés ; les contrôles informatifs signalent seulement ce qui manque.
 */
export async function ClotureControles({ contenu }: { contenu: RedClotureContenu }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const manquantsBloquants = contenu.controles.filter((c) => c.bloquant && !c.satisfait);
  return (
    <Carte titre={t("Contrôles de complétude", "Completeness checks")} niveauTitre={3}>
      <div className="mp-pile">
        <p>
          {manquantsBloquants.length === 0
            ? t(
                "Tous les contrôles bloquants sont satisfaits.",
                "All blocking checks are satisfied.",
              )
            : t(
                `${manquantsBloquants.length} contrôle(s) bloquant(s) à satisfaire avant la validation.`,
                `${manquantsBloquants.length} blocking check(s) to satisfy before approval.`,
              )}
        </p>
        <ul
          className="mp-clo-controles"
          aria-label={t("Contrôles de complétude du bilan", "Review completeness checks")}
        >
          {contenu.controles.map((c) => (
            <li key={c.code}>
              <span className="mp-clo-controles__libelle">
                {langue === "en" ? libelleControle(c.code, langue) : c.libelle}
              </span>
              <BadgeStatut tonalite="neutre" sansIcone>
                {c.bloquant ? t("Bloquant", "Blocking") : t("Informatif", "Informational")}
              </BadgeStatut>
              <BadgeStatut tonalite={c.satisfait ? "succes" : c.bloquant ? "attention" : "neutre"}>
                {c.satisfait ? t("Satisfait", "Satisfied") : t("Manquant", "Missing")}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      </div>
    </Carte>
  );
}
