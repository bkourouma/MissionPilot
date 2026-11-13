import type { RedCovenantsVue, RedFinancementVue } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { libelleTypePeriodeFinancement } from "../../lib/redressement-financement";
import { Tableau } from "../ui/Tableau";

type VersionCovenants = RedCovenantsVue["historique"][number];
type VersionFinancement = RedFinancementVue["historique"][number];

/** Historique des versions de covenants (ajout seul : rien n'est effacé). */
export async function HistoriqueCovenants({ versions }: { versions: VersionCovenants[] }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Tableau
      legende={t("Historique des versions de covenants", "Covenant version history")}
      messageVide={t("Aucune version de covenants.", "No covenant version.")}
      colonnes={[
        {
          cle: "version",
          entete: t("Version", "Version"),
          rendu: (v: VersionCovenants) => v.version,
        },
        {
          cle: "nombre",
          entete: "Covenants",
          alignement: "droite",
          rendu: (v) => v.nombre_covenants,
        },
        { cle: "auteur", entete: t("Auteur", "Author"), rendu: (v) => v.cree_par.nom },
        {
          cle: "date",
          entete: t("Créée le", "Created on"),
          rendu: (v) => formaterDateHeure(v.cree_le, undefined, langue),
        },
        { cle: "motif", entete: t("Motif", "Reason"), rendu: (v) => v.motif ?? "—" },
      ]}
      lignes={versions}
      cleLigne={(v) => v.id}
    />
  );
}

/** Historique des versions du plan de financement (ajout seul). */
export async function HistoriqueFinancement({ versions }: { versions: VersionFinancement[] }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Tableau
      legende={t(
        "Historique des versions du plan de financement",
        "Financing plan version history",
      )}
      messageVide={t("Aucune version du plan de financement.", "No financing plan version.")}
      colonnes={[
        {
          cle: "version",
          entete: t("Version", "Version"),
          rendu: (v: VersionFinancement) => v.version,
        },
        {
          cle: "debut",
          entete: t("Début", "Start"),
          rendu: (v) => formaterDate(v.date_debut, "UTC", langue),
        },
        {
          cle: "periodes",
          entete: t("Périodes", "Periods"),
          rendu: (v) =>
            `${v.nombre_periodes} (${libelleTypePeriodeFinancement(v.type_periode, langue).toLowerCase()})`,
        },
        {
          cle: "lignes",
          entete: t("Lignes", "Lines"),
          alignement: "droite",
          rendu: (v) => v.nombre_lignes,
        },
        { cle: "auteur", entete: t("Auteur", "Author"), rendu: (v) => v.cree_par.nom },
        {
          cle: "date",
          entete: t("Créée le", "Created on"),
          rendu: (v) => formaterDateHeure(v.cree_le, undefined, langue),
        },
        { cle: "motif", entete: t("Motif", "Reason"), rendu: (v) => v.motif ?? "—" },
      ]}
      lignes={versions}
      cleLigne={(v) => v.id}
    />
  );
}
