import Link from "next/link";
import type { Metadata } from "next";
import { TYPES_SOURCE_PREUVE } from "@missionpilot/shared";
import { LignePreuve } from "../../../../../components/preuves/AffichagePreuves";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Champ } from "../../../../../components/ui/Champ";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Select } from "../../../../../components/ui/Select";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../lib/missions-serveur";
import {
  cheminDimensions,
  droitsPreuves,
  hrefNouvellePreuve,
  hrefRegistre,
  hrefRegistreFiltre,
  libelleFiabiliteApi,
  libelleTypeSourcePreuve,
  lireParametresRegistre,
  requeteRegistre,
  type DimensionVue,
  type PageApi,
  type PreuveVue,
} from "../../../../../lib/preuves";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Registre des preuves", "Evidence register") };
}

/**
 * Registre des preuves de la mission (PRV-01) : éléments observés (réponse, entretien,
 * observation, document, donnée externe), leur source, leur fiabilité et leur rattachement.
 * Un verbatim nominatif sans accord est masqué par l'API pour qui n'a pas le droit de le lire.
 */
export default async function PageRegistrePreuves({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("preuve.lire");
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!r.ok) return null;
  const droits = droitsPreuves(utilisateur.roles, r.donnees);
  const p = lireParametresRegistre(await searchParams);
  const [page, dimensions] = await Promise.all([
    chargerServeur<PageApi<PreuveVue>>(`/api/missions/${id}/preuves?${requeteRegistre(p)}`),
    chargerServeur<{ elements: DimensionVue[] }>(cheminDimensions(id)),
  ]);
  const dims = dimensions.ok ? dimensions.donnees.elements : [];
  const filtre = Boolean(p.q ?? p.type_source ?? p.fiabilite ?? p.dimension);

  return (
    <>
      <p className="mp-texte-doux">
        {t(
          "Une preuve est un élément observé ; elle se corrige par une nouvelle version, jamais en l'écrasant. L'indice de solidité se lit sur les assertions.",
          "Evidence is an observed item; it is corrected with a new version, never by overwriting it. The solidity index is read on the assertions.",
        )}
      </p>
      {droits.ecrire ? (
        <div>
          <Link href={hrefNouvellePreuve(id)} className={classesBouton("primaire")}>
            <Icone nom="plus" />
            <span>{t("Nouvelle preuve", "New evidence")}</span>
          </Link>
        </div>
      ) : null}

      <form
        method="get"
        action={hrefRegistre(id)}
        className="mp-filtres"
        role="search"
        aria-label={t("Filtrer les preuves", "Filter the evidence")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle={t("Rechercher", "Search")}
            type="search"
            name="q"
            maxLength={100}
            defaultValue={p.q}
            autoComplete="off"
          />
          <Select
            libelle={t("Type de source", "Source type")}
            name="type_source"
            invite={t("Tous", "All")}
            options={TYPES_SOURCE_PREUVE.map((type) => ({
              valeur: type,
              libelle: libelleTypeSourcePreuve(type, langue),
            }))}
            defaultValue={p.type_source}
          />
          <Select
            libelle={t("Fiabilité", "Reliability")}
            name="fiabilite"
            invite={t("Toutes", "All")}
            options={(["A", "B", "C", "D"] as const).map((fi) => ({
              valeur: fi,
              libelle: libelleFiabiliteApi(fi, langue),
            }))}
            defaultValue={p.fiabilite}
          />
          {dims.length > 0 ? (
            <Select
              libelle={t("Dimension", "Dimension")}
              name="dimension"
              invite={t("Toutes", "All")}
              options={dims.map((d) => ({ valeur: d.code, libelle: d.libelle }))}
              defaultValue={p.dimension}
            />
          ) : null}
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("secondaire")}>
            <Icone nom="recherche" />
            <span>{t("Filtrer", "Filter")}</span>
          </button>
        </div>
      </form>

      {!page.ok ? (
        <EtatErreur
          titre={t(
            "Le registre des preuves n'a pas pu être chargé.",
            "The evidence register could not be loaded.",
          )}
          message={page.message}
          hrefReessayer={hrefRegistreFiltre(id, p, p.curseur ?? null)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t("Aucune preuve ne correspond.", "No evidence matches.")
              : t("Aucune preuve enregistrée.", "No evidence recorded.")
          }
          icone="dossier"
        >
          <p>
            {filtre
              ? t(
                  "Élargissez les filtres pour revoir toutes les preuves de la mission.",
                  "Widen the filters to see all the engagement's evidence again.",
                )
              : droits.ecrire
                ? t(
                    "Enregistrez les réponses, verbatims, observations et documents qui fondent vos conclusions.",
                    "Record the answers, verbatims, observations and documents that underpin your conclusions.",
                  )
                : t(
                    "Les preuves de la mission apparaîtront ici dès qu'un consultant les aura enregistrées.",
                    "The engagement's evidence will appear here as soon as a consultant has recorded it.",
                  )}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul
            className="mp-preuves-liste"
            aria-label={t("Preuves de la mission", "Engagement evidence")}
          >
            {page.donnees.elements.map((preuve) => (
              <LignePreuve key={preuve.id} missionId={id} preuve={preuve} dimensions={dims} />
            ))}
          </ul>
          <PaginationCurseur
            libelle={t("Pagination du registre", "Register pagination")}
            hrefSuivante={
              page.donnees.curseur_suivant
                ? hrefRegistreFiltre(id, p, page.donnees.curseur_suivant)
                : null
            }
            hrefDebut={p.curseur ? hrefRegistreFiltre(id, p, null) : null}
          />
        </>
      )}
    </>
  );
}
