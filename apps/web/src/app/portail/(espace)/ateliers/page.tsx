import Link from "next/link";
import type { Metadata } from "next";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { formaterDate } from "../../../../lib/format";
import {
  API_ATELIERS_PORTAIL,
  cheminAtelierPortail,
  CHEMIN_ATELIERS_PORTAIL,
  libelleMethode,
  type AtelierPortailResume,
} from "../../../../lib/plan-ateliers";
import {
  hrefPage,
  lireCurseur,
  peut,
  requetePage,
  type PagePortail,
} from "../../../../lib/portail";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Ateliers" };

/** Ateliers stratégiques ouverts auxquels votre cabinet vous invite : voter, classer, noter. */
export default async function AteliersPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.ateliers.participer")) {
    return <NonDisponible titre="Ateliers" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<AtelierPortailResume>>(
    requetePage(API_ATELIERS_PORTAIL, curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Ateliers"
        soustitre="Les ateliers de réflexion stratégique auxquels votre cabinet vous invite. Votre contribution est confidentielle : seuls les résultats d'ensemble sont partagés, à la clôture."
      />
      {!r.ok ? (
        <EtatErreur
          titre="La liste des ateliers n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_ATELIERS_PORTAIL, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun atelier ouvert pour le moment." icone="personnes">
          <p>Quand votre cabinet vous invitera à un atelier, il apparaîtra ici.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((a) => (
            <li key={a.id}>
              <Carte
                className="mp-module"
                niveauTitre={2}
                titre={
                  <Link href={cheminAtelierPortail(a.id)} className="mp-lien-etendu">
                    {a.titre}
                  </Link>
                }
                actions={
                  <BadgeStatut tonalite={a.a_contribue ? "succes" : "attention"}>
                    {a.a_contribue ? "Contribution déposée" : "À faire"}
                  </BadgeStatut>
                }
              >
                <p className="mp-texte-doux">
                  {`${a.methodes.map(libelleMethode).join(", ")} · ouvert le ${formaterDate(a.ouvert_le)}`}
                </p>
              </Carte>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant
              ? hrefPage(CHEMIN_ATELIERS_PORTAIL, r.donnees.curseur_suivant)
              : null
          }
          hrefDebut={curseur ? CHEMIN_ATELIERS_PORTAIL : null}
          libelle="Pages des ateliers"
        />
      ) : null}
    </div>
  );
}
