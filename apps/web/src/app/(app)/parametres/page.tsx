import Link from "next/link";
import type { Metadata } from "next";
import { Alerte } from "../../../components/ui/Alerte";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { chargerServeur } from "../../../lib/api-serveur";
import { anneeDemandee, type Cabinet, type Ferie } from "../../../lib/cabinet";
import { formaterDate } from "../../../lib/format";
import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirSession } from "../../../lib/session";
import { AjoutFerie, FeriesParDefaut, SuppressionFerie, ValidationFerie } from "./Feries";
import { FormulaireCabinet } from "./FormulaireCabinet";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Paramètres du cabinet", "Firm settings") };
}

export default async function PageParametresCabinet({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await obtenirSession();
  if (!aPermission(utilisateur.roles, "cabinet.gerer")) {
    // Gestionnaire (clôture, import) : première sous-page autorisée.
    redirect(sousPagesAutorisees("parametres", utilisateur.roles)[0]?.href ?? "/acces-refuse");
  }
  const annee = anneeDemandee((await searchParams).annee, new Date().getUTCFullYear());
  const [cabinet, feries] = await Promise.all([
    chargerServeur<Cabinet>("/api/cabinet"),
    chargerServeur<{ elements: Ferie[] }>(`/api/cabinet/feries?annee=${annee}`),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Cabinet", "Firm")}
        soustitre={t(
          "Identité du cabinet, devise et calendrier de travail utilisés par les plannings, les temps et les budgets.",
          "Firm identity, currency and work calendar used by schedules, time entries and budgets.",
        )}
      />

      <Carte titre={t("Informations générales", "General information")}>
        {cabinet.ok ? (
          <FormulaireCabinet cabinet={cabinet.donnees} />
        ) : (
          <EtatErreur
            titre={t(
              "Les paramètres du cabinet n'ont pas pu être chargés.",
              "The firm settings could not be loaded.",
            )}
            message={cabinet.message}
            hrefReessayer="/parametres"
          />
        )}
      </Carte>

      <Carte
        titre={t(`Jours fériés ${annee}`, `Public holidays ${annee}`)}
        actions={
          <nav className="mp-navigation-annee" aria-label={t("Changer d'année", "Change year")}>
            <Link className="mp-pagination__lien" href={`/parametres?annee=${annee - 1}`}>
              <Icone nom="chevronGauche" taille={18} />
              <span>{annee - 1}</span>
            </Link>
            <Link className="mp-pagination__lien" href={`/parametres?annee=${annee + 1}`}>
              <span>{annee + 1}</span>
              <Icone nom="chevronDroit" taille={18} />
            </Link>
          </nav>
        }
      >
        <div className="mp-pile">
          <Alerte
            tonalite="info"
            annonce="aucune"
            titre={t("À saisir chaque année", "To enter every year")}
          >
            <p>
              {t(
                "Les fêtes musulmanes (Korité, Tabaski, Maouloud…) suivent le calendrier lunaire : leur date change chaque année. Saisissez-les dès leur annonce officielle.",
                "Muslim holidays (Korité, Tabaski, Maouloud…) follow the lunar calendar: their date changes every year. Enter them as soon as they are officially announced.",
              )}
            </p>
          </Alerte>
          {!feries.ok ? (
            <EtatErreur
              titre={t(
                "Les jours fériés n'ont pas pu être chargés.",
                "The public holidays could not be loaded.",
              )}
              message={feries.message}
              hrefReessayer={`/parametres?annee=${annee}`}
            />
          ) : feries.donnees.elements.length === 0 ? (
            <EtatVide
              titre={t(
                `Aucun jour férié enregistré pour ${annee}.`,
                `No public holiday recorded for ${annee}.`,
              )}
              icone="calendrier"
            >
              <p>
                {t(
                  "Ajoutez les jours fériés de votre pays avec le formulaire ci-dessous.",
                  "Add your country's public holidays with the form below.",
                )}
              </p>
            </EtatVide>
          ) : (
            <ul
              className="mp-liste-lignes"
              aria-label={t(`Jours fériés ${annee}`, `Public holidays ${annee}`)}
            >
              {feries.donnees.elements.map((f) => (
                <li key={f.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong>{f.libelle}</strong>
                    <span className="mp-texte-doux">
                      {formaterDate(f.date, "UTC", langue)}
                      {f.nationale
                        ? t(" · fête nationale", " · national holiday")
                        : t(" · propre au cabinet", " · specific to the firm")}
                    </span>
                    {f.a_valider ? (
                      <span>
                        <BadgeStatut tonalite="attention">
                          {t(
                            "Proposé par défaut, à vérifier",
                            "Suggested by default, to be checked",
                          )}
                        </BadgeStatut>
                      </span>
                    ) : null}
                  </div>
                  <div className="mp-barre-actions mp-barre-actions--compacte">
                    {f.a_valider ? <ValidationFerie ferie={f} /> : null}
                    <SuppressionFerie ferie={f} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <FeriesParDefaut annee={annee} />
          <AjoutFerie annee={annee} />
        </div>
      </Carte>
    </div>
  );
}
