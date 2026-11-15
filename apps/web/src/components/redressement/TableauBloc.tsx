import Link from "next/link";
import type { ReactNode } from "react";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { hrefRedressement } from "../../lib/redressement";
import { blocVide, type BlocTableau } from "../../lib/redressement-tableau";
import { Carte } from "../ui/Carte";

/** Bloc du tableau : carte titrée, ou état vide explicatif avec lien vers l'onglet concerné. */
export async function TableauBloc({
  bloc,
  missionId,
  vide,
  children,
}: {
  bloc: BlocTableau;
  missionId: string;
  /** Vrai quand le bloc de l'API vaut null. */
  vide: boolean;
  children?: ReactNode;
}) {
  const b = blocVide(bloc, await obtenirLangue());
  return (
    <Carte titre={b.titre} niveauTitre={3} className="mp-tdb-bloc">
      {vide ? (
        <div className="mp-pile">
          <p className="mp-texte-doux">{b.texte}</p>
          <Link href={hrefRedressement(missionId, b.section)} className="mp-tdb-hors-impression">
            {b.lien}
          </Link>
        </div>
      ) : (
        children
      )}
    </Carte>
  );
}

/** Liste de couples libellé / valeur. */
export function TableauListe({ lignes }: { lignes: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="mp-tdb-liste">
      {lignes.map(([libelle, valeur]) => (
        <div key={libelle} className="mp-tdb-liste__ligne">
          <dt>{libelle}</dt>
          <dd>{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}
