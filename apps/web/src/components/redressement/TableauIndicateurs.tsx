import type { RedIndicateurTableauVue } from "@missionpilot/shared";
import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { formaterIndicateur } from "../../lib/redressement-tableau";
import { Tableau } from "../ui/Tableau";

/** Indicateurs clés : chaque valeur est accompagnée de sa source et de sa date. */
export async function TableauIndicateurs({
  indicateurs,
}: {
  indicateurs: readonly RedIndicateurTableauVue[];
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Tableau
      legende={t(
        "Indicateurs clés, avec leur source et leur date",
        "Key indicators, with their source and date",
      )}
      legendeVisible
      colonnes={[
        {
          cle: "libelle",
          entete: t("Indicateur", "Indicator"),
          rendu: (i: RedIndicateurTableauVue) => i.libelle,
        },
        {
          cle: "valeur",
          entete: t("Valeur", "Value"),
          alignement: "droite",
          rendu: (i) => formaterIndicateur(i, langue),
        },
        { cle: "source", entete: "Source", rendu: (i) => i.source },
        {
          cle: "date",
          entete: "Date",
          rendu: (i) => (i.date ? formaterDate(i.date, "UTC", langue) : "—"),
        },
      ]}
      lignes={indicateurs}
      cleLigne={(i) => i.cle}
      messageVide={t("Aucun indicateur disponible.", "No indicator available.")}
    />
  );
}
