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
import { MODE_LIBELLES, type TypeMission } from "../../../lib/catalogue";
import { formaterNombre } from "../../../lib/format";
import { exigerPermission } from "../../../lib/session";
import { InstallationCatalogue } from "./InstallationCatalogue";

export const metadata: Metadata = { title: "Catalogue des types de mission" };

export default async function PageCatalogue({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("catalogue.lire");
  const peutEcrire = aPermission(utilisateur.roles, "catalogue.ecrire");
  const peutInstaller = aPermission(utilisateur.roles, "cabinet.gerer");
  const archives = (await searchParams).statut === "archives";
  const r = await chargerServeur<{ elements: TypeMission[] }>(
    `/api/types-mission?actif=${archives ? "false" : "true"}`,
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Types de mission"
        soustitre="Modèles de missions du cabinet : découpage en phases, lots et tâches, jours types par grade."
        actions={
          peutEcrire ? (
            <Link href="/catalogue/nouveau" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>Nouveau type</span>
            </Link>
          ) : null
        }
      />

      {peutInstaller ? (
        <Carte titre="Catalogue de conseil de départ" niveauTitre={2}>
          <InstallationCatalogue />
        </Carte>
      ) : null}

      <nav className="mp-filtre-segments" aria-label="Statut des types affichés">
        <Link
          href="/catalogue"
          aria-current={archives ? undefined : "page"}
          className="mp-onglets__lien"
        >
          Actifs
        </Link>
        <Link
          href="/catalogue?statut=archives"
          aria-current={archives ? "page" : undefined}
          className="mp-onglets__lien"
        >
          Archivés
        </Link>
      </nav>

      {!r.ok ? (
        <EtatErreur
          titre="Le catalogue n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={archives ? "/catalogue?statut=archives" : "/catalogue"}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            archives ? "Aucun type de mission archivé." : "Aucun type de mission dans le catalogue."
          }
          icone="livre"
        >
          {!archives ? (
            <p>
              {peutInstaller
                ? "Installez le catalogue de conseil de départ, ou créez votre premier type."
                : peutEcrire
                  ? "Créez votre premier type de mission."
                  : "Un associé ou un expert métier doit d'abord le constituer."}
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
                    <BadgeStatut tonalite="attention">Valeurs de départ à valider</BadgeStatut>
                  ) : null
                }
              >
                <p className="mp-texte-doux">
                  {[t.domaine, MODE_LIBELLES[t.mode_facturation]].filter(Boolean).join(" · ")}
                </p>
                {t.duree_type_jours !== null ? (
                  <p>Durée type : {formaterNombre(t.duree_type_jours)} jours calendaires</p>
                ) : null}
              </Carte>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
