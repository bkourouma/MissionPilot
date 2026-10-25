import Link from "next/link";
import type { Metadata } from "next";
import { VEILLE_STATUTS } from "@missionpilot/shared";
import "../../../../components/appels-offres/appels-offres.css";
import { VeilleResultats } from "../../../../components/appels-offres/VeilleResultats";
import {
  VeilleImportFichier,
  VeilleSaisieAvis,
} from "../../../../components/appels-offres/VeilleSaisie";
import { VeilleSources } from "../../../../components/appels-offres/VeilleSources";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Select } from "../../../../components/ui/Select";
import { chargerServeur } from "../../../../lib/api-serveur";
import { droitsAppelsOffres } from "../../../../lib/appels-offres";
import {
  API_VEILLE,
  cheminResultatsVeille,
  hrefVeille,
  libelleStatutVeille,
  lireFiltresVeille,
  PAGE_VEILLE,
  type PageResultatsVeille,
  type ResumeVeille,
  type SourceVeilleVue,
} from "../../../../lib/appels-offres-veille";
import { exigerLectureAo } from "../../../../lib/appels-offres-serveur";

export const metadata: Metadata = { title: "Veille des appels d'offres" };

/**
 * Veille multi-sources des appels d'offres (AO-01) : sources simulées activables par le cabinet,
 * collecte à la main, import d'un fichier CSV/JSON, avis dédoublonnés avec leur score de
 * rapprochement expliqué (moteur) ; retenir, écarter (motif) ou créer la fiche. Aucun appel
 * externe : l'API ne visite jamais l'adresse d'un avis.
 */
export default async function PageVeille({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await exigerLectureAo();
  const droits = droitsAppelsOffres(session.utilisateur.roles);
  const filtres = lireFiltresVeille(await searchParams);
  const [sources, resume, r] = await Promise.all([
    chargerServeur<{ elements: SourceVeilleVue[] }>(`${API_VEILLE}/sources`),
    chargerServeur<ResumeVeille>(API_VEILLE),
    chargerServeur<PageResultatsVeille>(cheminResultatsVeille(filtres)),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Veille des appels d'offres"
        soustitre="Avis de plusieurs sources, dédoublonnés et rapprochés des compétences, références et secteurs du cabinet."
        retour={{ href: "/appels-offres", libelle: "Appels d'offres" }}
      />

      {resume.ok ? (
        <p className="mp-texte-doux" role="status">
          {resume.donnees.total} avis suivi(s) sur {resume.donnees.plafond} au plus ·{" "}
          {VEILLE_STATUTS.map(
            (s) => `${libelleStatutVeille(s)} : ${resume.donnees.par_statut[s] ?? 0}`,
          ).join(" · ")}
        </p>
      ) : null}

      <div className="mp-grille-cartes">
        <Carte titre="Sources de veille">
          {sources.ok ? (
            <VeilleSources sources={sources.donnees.elements} gerer={droits.gerer} />
          ) : (
            <EtatErreur
              titre="Les sources n'ont pas pu être chargées."
              message={sources.message}
              hrefReessayer={hrefVeille(filtres)}
            />
          )}
        </Carte>
        {droits.gerer ? (
          <Carte titre="Importer un fichier">
            <VeilleImportFichier />
          </Carte>
        ) : null}
        {droits.gerer ? (
          <Carte titre="Saisir un avis">
            <VeilleSaisieAvis />
          </Carte>
        ) : null}
      </div>

      <section aria-labelledby="titre-avis" className="mp-pile">
        <h2 id="titre-avis" className="mp-section__titre">
          Avis
        </h2>
        <form
          method="get"
          action="/appels-offres/veille"
          className="mp-filtres"
          aria-label="Filtrer les avis"
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Champ libelle="Rechercher" name="q" defaultValue={filtres.q} maxLength={100} />
            <Select
              libelle="Statut"
              name="statut"
              invite="Tous les statuts"
              defaultValue={filtres.statut}
              options={VEILLE_STATUTS.map((s) => ({ valeur: s, libelle: libelleStatutVeille(s) }))}
            />
            <Champ
              libelle="Score minimal"
              name="score_min"
              type="number"
              min={0}
              max={100}
              defaultValue={filtres.score_min}
            />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className="mp-bouton mp-bouton--secondaire">
              Filtrer
            </button>
          </div>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre="Les avis n'ont pas pu être chargés."
            message={r.message}
            hrefReessayer={hrefVeille(filtres)}
          />
        ) : (
          <>
            <VeilleResultats resultats={r.donnees.elements} gerer={droits.gerer} />
            <nav className="mp-ao__actions" aria-label="Pagination des avis">
              {filtres.page > 1 ? (
                <Link href={hrefVeille({ ...filtres, page: filtres.page - 1 })}>
                  Page précédente
                </Link>
              ) : null}
              {filtres.page * PAGE_VEILLE < r.donnees.total ? (
                <Link href={hrefVeille({ ...filtres, page: filtres.page + 1 })}>Page suivante</Link>
              ) : null}
            </nav>
          </>
        )}
      </section>
    </div>
  );
}
