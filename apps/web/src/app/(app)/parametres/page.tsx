import Link from "next/link";
import type { Metadata } from "next";
import { Alerte } from "../../../components/ui/Alerte";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { chargerServeur } from "../../../lib/api-serveur";
import { anneeDemandee, type Cabinet, type Ferie } from "../../../lib/cabinet";
import { formaterDate } from "../../../lib/format";
import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirSession } from "../../../lib/session";
import { AjoutFerie, FeriesParDefaut, SuppressionFerie, ValidationFerie } from "./Feries";
import { FormulaireCabinet } from "./FormulaireCabinet";

export const metadata: Metadata = { title: "Paramètres du cabinet" };

export default async function PageParametresCabinet({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
        titre="Cabinet"
        soustitre="Identité du cabinet, devise et calendrier de travail utilisés par les plannings, les temps et les budgets."
      />

      <Carte titre="Informations générales">
        {cabinet.ok ? (
          <FormulaireCabinet cabinet={cabinet.donnees} />
        ) : (
          <EtatErreur
            titre="Les paramètres du cabinet n'ont pas pu être chargés."
            message={cabinet.message}
            hrefReessayer="/parametres"
          />
        )}
      </Carte>

      <Carte
        titre={`Jours fériés ${annee}`}
        actions={
          <nav className="mp-navigation-annee" aria-label="Changer d'année">
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
          <Alerte tonalite="info" annonce="aucune" titre="À saisir chaque année">
            <p>
              Les fêtes musulmanes (Korité, Tabaski, Maouloud…) suivent le calendrier lunaire : leur
              date change chaque année. Saisissez-les dès leur annonce officielle.
            </p>
          </Alerte>
          {!feries.ok ? (
            <EtatErreur
              titre="Les jours fériés n'ont pas pu être chargés."
              message={feries.message}
              hrefReessayer={`/parametres?annee=${annee}`}
            />
          ) : feries.donnees.elements.length === 0 ? (
            <EtatVide titre={`Aucun jour férié enregistré pour ${annee}.`} icone="calendrier">
              <p>Ajoutez les jours fériés de votre pays avec le formulaire ci-dessous.</p>
            </EtatVide>
          ) : (
            <ul className="mp-liste-lignes" aria-label={`Jours fériés ${annee}`}>
              {feries.donnees.elements.map((f) => (
                <li key={f.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong>{f.libelle}</strong>
                    <span className="mp-texte-doux">
                      {formaterDate(f.date)}
                      {f.nationale ? " · fête nationale" : " · propre au cabinet"}
                      {f.a_valider ? " · proposé par défaut, à vérifier" : ""}
                    </span>
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
