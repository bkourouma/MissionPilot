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
import { chargerMission } from "../../../../../lib/missions-serveur";
import {
  cheminDimensions,
  droitsPreuves,
  FIABILITES,
  hrefNouvellePreuve,
  hrefRegistre,
  hrefRegistreFiltre,
  lireParametresRegistre,
  requeteRegistre,
  TYPE_SOURCE_LIBELLES,
  type DimensionVue,
  type PageApi,
  type PreuveVue,
} from "../../../../../lib/preuves";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Registre des preuves" };

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
        Une preuve est un élément observé ; elle se corrige par une nouvelle version, jamais en
        l&apos;écrasant. L&apos;indice de solidité se lit sur les assertions.
      </p>
      {droits.ecrire ? (
        <div>
          <Link href={hrefNouvellePreuve(id)} className={classesBouton("primaire")}>
            <Icone nom="plus" />
            <span>Nouvelle preuve</span>
          </Link>
        </div>
      ) : null}

      <form
        method="get"
        action={hrefRegistre(id)}
        className="mp-filtres"
        role="search"
        aria-label="Filtrer les preuves"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle="Rechercher"
            type="search"
            name="q"
            maxLength={100}
            defaultValue={p.q}
            autoComplete="off"
          />
          <Select
            libelle="Type de source"
            name="type_source"
            invite="Tous"
            options={TYPES_SOURCE_PREUVE.map((t) => ({
              valeur: t,
              libelle: TYPE_SOURCE_LIBELLES[t],
            }))}
            defaultValue={p.type_source}
          />
          <Select
            libelle="Fiabilité"
            name="fiabilite"
            invite="Toutes"
            options={(["A", "B", "C", "D"] as const).map((f) => ({
              valeur: f,
              libelle: FIABILITES[f],
            }))}
            defaultValue={p.fiabilite}
          />
          {dims.length > 0 ? (
            <Select
              libelle="Dimension"
              name="dimension"
              invite="Toutes"
              options={dims.map((d) => ({ valeur: d.code, libelle: d.libelle }))}
              defaultValue={p.dimension}
            />
          ) : null}
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("secondaire")}>
            <Icone nom="recherche" />
            <span>Filtrer</span>
          </button>
        </div>
      </form>

      {!page.ok ? (
        <EtatErreur
          titre="Le registre des preuves n'a pas pu être chargé."
          message={page.message}
          hrefReessayer={hrefRegistreFiltre(id, p, p.curseur ?? null)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={filtre ? "Aucune preuve ne correspond." : "Aucune preuve enregistrée."}
          icone="dossier"
        >
          <p>
            {filtre
              ? "Élargissez les filtres pour revoir toutes les preuves de la mission."
              : droits.ecrire
                ? "Enregistrez les réponses, verbatims, observations et documents qui fondent vos conclusions."
                : "Les preuves de la mission apparaîtront ici dès qu'un consultant les aura enregistrées."}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul className="mp-preuves-liste" aria-label="Preuves de la mission">
            {page.donnees.elements.map((preuve) => (
              <LignePreuve key={preuve.id} missionId={id} preuve={preuve} dimensions={dims} />
            ))}
          </ul>
          <PaginationCurseur
            libelle="Pagination du registre"
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
