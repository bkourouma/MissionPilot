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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  hrefPage,
  lireCurseur,
  peut,
  requetePage,
  type PagePortail,
} from "../../../../lib/portail";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Avancement de vos missions", "Progress of your engagements") };
}

/** Rapports d'avancement hebdomadaires validés par le cabinet, du plus récent au plus ancien. */
export default async function AvancementPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.avancement.lire")) {
    return <NonDisponible titre={t("Avancement", "Progress")} />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<LignePortailAvancement>>(
    requetePage(API_AVANCEMENT_PORTAIL, curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Avancement de vos missions", "Progress of your engagements")}
        soustitre={t(
          "Le point hebdomadaire que votre cabinet a relu et validé : avancement, jalons, indicateurs et documents partagés.",
          "The weekly update your firm has reviewed and approved: progress, milestones, KPIs and shared documents.",
        )}
        badges={
          <BadgeStatut tonalite="neutre" sansIcone>
            {t("Lecture seule", "Read-only")}
          </BadgeStatut>
        }
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La liste des rapports n'a pas pu être chargée.",
            "The list of reports could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_AVANCEMENT_PORTAIL, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={langue === "en" ? "No progress report yet." : aucunRapportPortail.titre}
          icone="calendrier"
        >
          <p>
            {t(
              aucunRapportPortail.aide,
              "Your firm publishes a weekly update here on the progress of your engagements, once it has reviewed and approved it. It will appear on this page.",
            )}
          </p>
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
                    {libelleSemaineRapport(l, langue)}
                  </Link>
                }
                actions={
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {t(
                      `Avancement : ${formaterAvancement(l.avancement_pourcentage)}`,
                      `Progress: ${formaterAvancement(l.avancement_pourcentage, langue)}`,
                    )}
                  </BadgeStatut>
                }
              >
                <p className="mp-texte-doux">
                  {t(
                    `${l.mission_intitule} · publié le ${formaterDate(l.valide_le, "Africa/Abidjan")}`,
                    `${l.mission_intitule} · published on ${formaterDate(l.valide_le, "Africa/Abidjan", langue)}`,
                  )}
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
          libelle={t("Pages des rapports d'avancement", "Progress report pages")}
        />
      ) : null}
    </div>
  );
}
