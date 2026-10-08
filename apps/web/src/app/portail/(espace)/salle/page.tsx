import Link from "next/link";
import type { Metadata } from "next";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  hrefPage,
  lireCurseur,
  peut,
  requetePage,
  type PagePortail,
} from "../../../../lib/portail";
import { aujourdhui } from "../../../../lib/periode";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";
import {
  API_SALLE_PORTAIL,
  CHEMIN_SALLE_PORTAIL,
  hrefDemandePortail,
  libelleEcheance,
  resumePourClient,
  type DemandePortailResume,
} from "../../../../lib/salle-mission-portail";
import "../../../../components/salle-mission/salle.css";

export const metadata: Metadata = { title: "Documents à fournir" };

/** Demandes de documents adressées par le cabinet à l'entreprise (plus récentes d'abord). */
export default async function SallePortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.salle.deposer")) {
    return <NonDisponible titre="Documents à fournir" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<DemandePortailResume>>(
    requetePage(API_SALLE_PORTAIL, curseur),
  );
  const dateDuJour = aujourdhui();

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Documents à fournir"
        soustitre="Les pièces que votre cabinet vous demande pour la mission. Déposez-les ici, depuis un ordinateur ou en photo depuis votre téléphone : vous recevez un accusé de réception pour chaque dépôt."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les demandes n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_SALLE_PORTAIL, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun document ne vous est demandé." icone="trombone">
          <p>Dès que votre cabinet vous demandera des pièces, elles apparaîtront ici.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((d) => {
            const echeance = libelleEcheance(d, dateDuJour);
            return (
              <li key={d.id} className="mp-carte mp-salle__piece">
                <div className="mp-salle__entete-carte">
                  <h2 className="mp-salle__piece-titre">
                    <Link href={hrefDemandePortail(d.id)} className="mp-lien-etendu">
                      {d.titre}
                    </Link>
                  </h2>
                  <BadgeStatut tonalite={echeance.tonalite}>{echeance.texte}</BadgeStatut>
                </div>
                <p className="mp-texte-doux">{resumePourClient(d.synthese)}</p>
              </li>
            );
          })}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant
              ? hrefPage(CHEMIN_SALLE_PORTAIL, r.donnees.curseur_suivant)
              : null
          }
          hrefDebut={curseur ? CHEMIN_SALLE_PORTAIL : null}
          libelle="Pages des demandes de documents"
        />
      ) : null}
    </div>
  );
}
