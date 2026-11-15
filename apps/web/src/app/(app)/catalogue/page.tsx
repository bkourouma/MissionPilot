import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { chargerServeur } from "../../../lib/api-serveur";
import { libelleMode, type TypeMission } from "../../../lib/catalogue";
import { formaterNombre } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";
import { InstallationCatalogue } from "./InstallationCatalogue";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Catalogue des types de mission", "Engagement type catalog") };
}

export default async function PageCatalogue({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("catalogue.lire");
  const tr = await obtenirT();
  const langue = await obtenirLangue();
  const peutEcrire = aPermission(utilisateur.roles, "catalogue.ecrire");
  const peutInstaller = aPermission(utilisateur.roles, "cabinet.gerer");
  const archives = (await searchParams).statut === "archives";
  const r = await chargerServeur<{ elements: TypeMission[] }>(
    `/api/types-mission?actif=${archives ? "false" : "true"}`,
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={tr("Types de mission", "Engagement types")}
        soustitre={tr(
          "Modèles de missions du cabinet : découpage en phases, lots et tâches, jours types par grade.",
          "The firm's engagement templates: breakdown into phases, work packages and tasks, typical days per grade.",
        )}
        actions={
          peutEcrire ? (
            <Link href="/catalogue/nouveau" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>{tr("Nouveau type", "New type")}</span>
            </Link>
          ) : null
        }
      />

      {peutInstaller ? (
        <Carte
          titre={tr("Catalogue de conseil de départ", "Starter consulting catalog")}
          niveauTitre={2}
        >
          <InstallationCatalogue />
        </Carte>
      ) : null}

      <nav
        className="mp-filtre-segments"
        aria-label={tr("Statut des types affichés", "Status of the types shown")}
      >
        <Link
          href="/catalogue"
          aria-current={archives ? undefined : "page"}
          className="mp-onglets__lien"
        >
          {tr("Actifs", "Active")}
        </Link>
        <Link
          href="/catalogue?statut=archives"
          aria-current={archives ? "page" : undefined}
          className="mp-onglets__lien"
        >
          {tr("Archivés", "Archived")}
        </Link>
      </nav>

      {!r.ok ? (
        <EtatErreur
          titre={tr("Le catalogue n'a pas pu être chargé.", "The catalog could not be loaded.")}
          message={r.message}
          hrefReessayer={archives ? "/catalogue?statut=archives" : "/catalogue"}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            archives
              ? tr("Aucun type de mission archivé.", "No archived engagement type.")
              : tr("Aucun type de mission dans le catalogue.", "No engagement type in the catalog.")
          }
          icone="livre"
        >
          {!archives ? (
            <p>
              {peutInstaller
                ? tr(
                    "Installez le catalogue de conseil de départ, ou créez votre premier type.",
                    "Install the starter consulting catalog, or create your first type.",
                  )
                : peutEcrire
                  ? tr("Créez votre premier type de mission.", "Create your first engagement type.")
                  : tr(
                      "Un associé ou un expert métier doit d'abord le constituer.",
                      "A partner or a domain expert must build it first.",
                    )}
            </p>
          ) : null}
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes mp-liste-cartes--grille">
          {r.donnees.elements.map((t) => (
            <li key={t.id}>
              <Carte
                niveauTitre={3}
                className="mp-module"
                titre={
                  <Link href={`/catalogue/${t.id}`} className="mp-lien-etendu">
                    {t.libelle}
                  </Link>
                }
                actions={
                  t.a_valider ? (
                    <BadgeStatut tonalite="attention">
                      {tr("Valeurs de départ à valider", "Starting values pending approval")}
                    </BadgeStatut>
                  ) : null
                }
              >
                <p className="mp-texte-doux">
                  {[t.domaine, libelleMode(t.mode_facturation, langue)].filter(Boolean).join(" · ")}
                </p>
                {t.duree_type_jours !== null ? (
                  <p>
                    {tr("Durée type : ", "Typical duration: ")}
                    {formaterNombre(t.duree_type_jours, 2, langue)}{" "}
                    {tr("jours calendaires", "calendar days")}
                  </p>
                ) : null}
              </Carte>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
