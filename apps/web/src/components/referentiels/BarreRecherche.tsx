import type { ReactNode } from "react";
import { classesBouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { Select } from "../ui/Select";
import type { ParametresListe } from "../../lib/clients";

const OPTIONS_STATUT = [
  { valeur: "actifs", libelle: "Actifs" },
  { valeur: "archives", libelle: "Archivés" },
  { valeur: "tous", libelle: "Tous" },
];

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
export function BarreRecherche({
  action,
  params,
  libelleRecherche,
  aideRecherche,
  libelleStatut = "Statut",
  autres,
}: BarreRechercheProps) {
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
          libelle={libelleStatut}
          name="statut"
          options={OPTIONS_STATUT}
          defaultValue={params.statut}
        />
        {autres}
      </div>
      <div className="mp-actions-formulaire">
        <button type="submit" className={classesBouton("primaire")}>
          <Icone nom="recherche" />
          <span>Rechercher</span>
        </button>
      </div>
    </form>
  );
}
