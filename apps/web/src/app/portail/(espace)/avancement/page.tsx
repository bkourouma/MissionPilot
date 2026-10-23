import Link from "next/link";
import type { Metadata } from "next";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  API_AVANCEMENT_PORTAIL,
  aucunRapportPortail,
  CHEMIN_AVANCEMENT_PORTAIL,
  formaterAvancement,
  hrefRapportPortail,
  libelleSemaineRapport,
  type LignePortailAvancement,
} from "../../../../lib/avancement";
import { formaterDate } from "../../../../lib/format";
import {
  hrefPage,
  lireCurseur,
  peut,
  requetePage,
  type PagePortail,
} from "../../../../lib/portail";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Avancement de vos missions" };

/** Rapports d'avancement hebdomadaires validés par le cabinet, du plus récent au plus ancien. */
export default async function AvancementPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.avancement.lire")) {
    return <NonDisponible titre="Avancement" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<LignePortailAvancement>>(
    requetePage(API_AVANCEMENT_PORTAIL, curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Avancement de vos missions"
        soustitre="Le point hebdomadaire que votre cabinet a relu et validé : avancement, jalons, indicateurs et documents partagés."
        badges={
          <BadgeStatut tonalite="neutre" sansIcone>
            Lecture seule
          </BadgeStatut>
        }
      />
      {!r.ok ? (
        <EtatErreur
          titre="La liste des rapports n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_AVANCEMENT_PORTAIL, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={aucunRapportPortail.titre} icone="calendrier">
          <p>{aucunRapportPortail.aide}</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((l) => (
            <li key={l.id}>
              <Carte
                className="mp-module"
                niveauTitre={2}
                titre={
                  <Link href={hrefRapportPortail(l.id)} className="mp-lien-etendu">
                    {libelleSemaineRapport(l)}
                  </Link>
                }
                actions={
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {`Avancement : ${formaterAvancement(l.avancement_pourcentage)}`}
                  </BadgeStatut>
                }
              >
                <p className="mp-texte-doux">
                  {`${l.mission_intitule} · publié le ${formaterDate(l.valide_le, "Africa/Abidjan")}`}
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
              ? hrefPage(CHEMIN_AVANCEMENT_PORTAIL, r.donnees.curseur_suivant)
              : null
          }
          hrefDebut={curseur ? CHEMIN_AVANCEMENT_PORTAIL : null}
          libelle="Pages des rapports d'avancement"
        />
      ) : null}
    </div>
  );
}
