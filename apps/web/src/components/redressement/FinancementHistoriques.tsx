import type { RedCovenantsVue, RedFinancementVue } from "@missionpilot/shared";
import { RED_FINANCEMENT_TYPE_PERIODE_LIBELLES } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import { Tableau } from "../ui/Tableau";

type VersionCovenants = RedCovenantsVue["historique"][number];
type VersionFinancement = RedFinancementVue["historique"][number];

/** Historique des versions de covenants (ajout seul : rien n'est effacé). */
export function HistoriqueCovenants({ versions }: { versions: VersionCovenants[] }) {
  return (
    <Tableau
      legende="Historique des versions de covenants"
      messageVide="Aucune version de covenants."
      colonnes={[
        { cle: "version", entete: "Version", rendu: (v: VersionCovenants) => v.version },
        {
          cle: "nombre",
          entete: "Covenants",
          alignement: "droite",
          rendu: (v) => v.nombre_covenants,
        },
        { cle: "auteur", entete: "Auteur", rendu: (v) => v.cree_par.nom },
        { cle: "date", entete: "Créée le", rendu: (v) => formaterDateHeure(v.cree_le) },
        { cle: "motif", entete: "Motif", rendu: (v) => v.motif ?? "—" },
      ]}
      lignes={versions}
      cleLigne={(v) => v.id}
    />
  );
}

/** Historique des versions du plan de financement (ajout seul). */
export function HistoriqueFinancement({ versions }: { versions: VersionFinancement[] }) {
  return (
    <Tableau
      legende="Historique des versions du plan de financement"
      messageVide="Aucune version du plan de financement."
      colonnes={[
        { cle: "version", entete: "Version", rendu: (v: VersionFinancement) => v.version },
        { cle: "debut", entete: "Début", rendu: (v) => formaterDate(v.date_debut) },
        {
          cle: "periodes",
          entete: "Périodes",
          rendu: (v) =>
            `${v.nombre_periodes} (${RED_FINANCEMENT_TYPE_PERIODE_LIBELLES[v.type_periode].toLowerCase()})`,
        },
        { cle: "lignes", entete: "Lignes", alignement: "droite", rendu: (v) => v.nombre_lignes },
        { cle: "auteur", entete: "Auteur", rendu: (v) => v.cree_par.nom },
        { cle: "date", entete: "Créée le", rendu: (v) => formaterDateHeure(v.cree_le) },
        { cle: "motif", entete: "Motif", rendu: (v) => v.motif ?? "—" },
      ]}
      lignes={versions}
      cleLigne={(v) => v.id}
    />
  );
}
