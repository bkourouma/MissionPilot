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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Ateliers", "Workshops") };
}

/** Ateliers stratégiques ouverts auxquels votre cabinet vous invite : voter, classer, noter. */
export default async function AteliersPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.ateliers.participer")) {
    return <NonDisponible titre={t("Ateliers", "Workshops")} />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<AtelierPortailResume>>(
    requetePage(API_ATELIERS_PORTAIL, curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Ateliers", "Workshops")}
        soustitre={t(
          "Les ateliers de réflexion stratégique auxquels votre cabinet vous invite. Votre contribution est confidentielle : seuls les résultats d'ensemble sont partagés, à la clôture.",
          "The strategic thinking workshops your firm invites you to. Your contribution is confidential: only overall results are shared, once the workshop is closed.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La liste des ateliers n'a pas pu être chargée.",
            "The list of workshops could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN_ATELIERS_PORTAIL, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t("Aucun atelier ouvert pour le moment.", "No open workshop at the moment.")}
          icone="personnes"
        >
          <p>
            {t(
              "Quand votre cabinet vous invitera à un atelier, il apparaîtra ici.",
              "When your firm invites you to a workshop, it will appear here.",
            )}
          </p>
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
                    {a.a_contribue
                      ? t("Contribution déposée", "Contribution submitted")
                      : t("À faire", "To do")}
                  </BadgeStatut>
                }
              >
                <p className="mp-texte-doux">
                  {`${a.methodes.map((m) => libelleMethode(m, langue)).join(", ")} · ${t("ouvert le", "opened on")} ${formaterDate(a.ouvert_le, "UTC", langue)}`}
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
          libelle={t("Pages des ateliers", "Workshop pages")}
        />
      ) : null}
    </div>
  );
}
