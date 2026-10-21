import type { RedIndicateurTableauVue } from "@missionpilot/shared";
import { formaterDate } from "../../lib/format";
import { formaterIndicateur } from "../../lib/redressement-tableau";
import { Tableau } from "../ui/Tableau";

/** Indicateurs clés : chaque valeur est accompagnée de sa source et de sa date. */
export function TableauIndicateurs({
  indicateurs,
}: {
  indicateurs: readonly RedIndicateurTableauVue[];
}) {
  return (
    <Tableau
      legende="Indicateurs clés, avec leur source et leur date"
      legendeVisible
      colonnes={[
        { cle: "libelle", entete: "Indicateur", rendu: (i: RedIndicateurTableauVue) => i.libelle },
        {
          cle: "valeur",
          entete: "Valeur",
          alignement: "droite",
          rendu: (i) => formaterIndicateur(i),
        },
        { cle: "source", entete: "Source", rendu: (i) => i.source },
        { cle: "date", entete: "Date", rendu: (i) => (i.date ? formaterDate(i.date) : "—") },
      ]}
      lignes={indicateurs}
      cleLigne={(i) => i.cle}
      messageVide="Aucun indicateur disponible."
    />
  );
}
