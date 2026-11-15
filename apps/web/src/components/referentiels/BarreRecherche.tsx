import type { ReactNode } from "react";
import { classesBouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { Select } from "../ui/Select";
import { obtenirT } from "../../lib/i18n/serveur";
import type { ParametresListe } from "../../lib/clients";

export interface BarreRechercheProps {
  action: string;
  params: ParametresListe;
  libelleRecherche: string;
  aideRecherche?: string;
  libelleStatut?: string;
  /** Filtres supplémentaires (listes déroulantes). */
  autres?: ReactNode;
}

/**
 * Recherche et filtre par statut en formulaire GET : fonctionne sans JavaScript, l'état est
 * dans l'URL (partage, retour arrière, reprise après coupure).
 */
export async function BarreRecherche({
  action,
  params,
  libelleRecherche,
  aideRecherche,
  libelleStatut,
  autres,
}: BarreRechercheProps) {
  const t = await obtenirT();
  const optionsStatut = [
    { valeur: "actifs", libelle: t("Actifs", "Active") },
    { valeur: "archives", libelle: t("Archivés", "Archived") },
    { valeur: "tous", libelle: t("Tous", "All") },
  ];
  return (
    <form
      method="get"
      action={action}
      className="mp-filtres"
      role="search"
      aria-label={libelleRecherche}
    >
      <div className="mp-grille-champs mp-grille-champs--filtres">
        <Champ
          libelle={libelleRecherche}
          type="search"
          name="q"
          maxLength={100}
          defaultValue={params.q}
          aide={aideRecherche}
          autoComplete="off"
        />
        <Select
          libelle={libelleStatut ?? t("Statut", "Status")}
          name="statut"
          options={optionsStatut}
          defaultValue={params.statut}
        />
        {autres}
      </div>
      <div className="mp-actions-formulaire">
        <button type="submit" className={classesBouton("primaire")}>
          <Icone nom="recherche" />
          <span>{t("Rechercher", "Search")}</span>
        </button>
      </div>
    </form>
  );
}
