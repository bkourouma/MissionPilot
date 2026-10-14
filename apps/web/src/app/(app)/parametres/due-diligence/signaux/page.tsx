import type { Metadata } from "next";
import { FAMILLES_RISQUE_DD } from "@missionpilot/shared";
import { BadgeNiveauRisque } from "../../../../../components/due-diligence/BadgesDd";
import { FormulaireSignal } from "../../../../../components/due-diligence/FormulaireSignal";
import { HistoriqueVersions } from "../../../../../components/due-diligence/HistoriqueVersions";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { Champ } from "../../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Select } from "../../../../../components/ui/Select";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  cheminSignaux,
  droitsDd,
  FAMILLE_RISQUE_DD_LIBELLES,
  hrefSignaux,
  libelleTaxonomie,
  lireFiltresSignaux,
  optionsDe,
  requeteSignaux,
  type FiltresSignaux,
  type PageDd,
  type SignalBibliotheque,
} from "../../../../../lib/due-diligence";
import { chargerTaxonomies } from "../../../../../lib/due-diligence-serveur";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Signaux d'alerte" };

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function hrefPage(filtres: FiltresSignaux, curseur: string | null) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(filtres)) if (v) u.set(k, v);
  if (curseur) u.set("curseur", curseur);
  const q = u.toString();
  return q ? `${hrefSignaux}?${q}` : hrefSignaux;
}

/**
 * Bibliothèque de signaux d'alerte (DD-11), propre au cabinet, vide au départ : aucun contenu n'est
 * inventé. Filtrable par famille, secteur, pays et état ; chaque correction crée une version motivée
 * (historique à la demande). Lecture seule sans `dd.referentiel.gerer`.
 */
export default async function PageSignauxDd({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("dd.lire");
  const droits = droitsDd(utilisateur.roles);
  const sp = await searchParams;
  const filtres = lireFiltresSignaux(sp, FAMILLES_RISQUE_DD);
  const curseurBrut = premier(sp.curseur);
  const curseur =
    curseurBrut && curseurBrut.length <= 500 && /^[A-Za-z0-9_-]+$/.test(curseurBrut)
      ? curseurBrut
      : null;
  const [page, taxonomies] = await Promise.all([
    chargerServeur<PageDd<SignalBibliotheque>>(cheminSignaux(requeteSignaux(filtres, curseur))),
    chargerTaxonomies(),
  ]);
  const filtre = Object.keys(filtres).length > 0;
  const secteursEtFilieres = [...taxonomies.secteurs, ...taxonomies.filieres];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Signaux d'alerte"
        soustitre="Bibliothèque des signaux par secteur et pays, maintenue par les experts du cabinet. Le moteur propose à chaque dossier ceux qui s'appliquent."
      />
      {taxonomies.erreur ? (
        <Alerte tonalite="attention" titre="Libellés incomplets" annonce="aucune">
          <p>{taxonomies.erreur}</p>
        </Alerte>
      ) : null}

      <form
        method="get"
        action={hrefSignaux}
        className="mp-filtres"
        role="search"
        aria-label="Filtrer les signaux"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle="Rechercher"
            type="search"
            name="q"
            maxLength={100}
            defaultValue={filtres.q}
            autoComplete="off"
          />
          <Select
            libelle="Famille"
            name="famille"
            invite="Toutes"
            options={optionsDe(FAMILLES_RISQUE_DD, FAMILLE_RISQUE_DD_LIBELLES)}
            defaultValue={filtres.famille}
          />
          <Select
            libelle="Secteur ou filière"
            name="secteur_code"
            invite="Tous"
            options={secteursEtFilieres.map((e) => ({ valeur: e.code, libelle: e.libelle }))}
            defaultValue={filtres.secteur_code}
          />
          <Select
            libelle="Pays"
            name="pays_code"
            invite="Tous"
            options={taxonomies.pays.map((e) => ({ valeur: e.code, libelle: e.libelle }))}
            defaultValue={filtres.pays_code}
          />
          <Select
            libelle="État"
            name="actif"
            invite="Tous"
            options={[
              { valeur: "true", libelle: "Actifs" },
              { valeur: "false", libelle: "Inactifs" },
            ]}
            defaultValue={filtres.actif}
          />
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
          titre="Les signaux n'ont pas pu être chargés."
          message={page.message}
          hrefReessayer={hrefPage(filtres, curseur)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={filtre ? "Aucun signal ne correspond." : "La bibliothèque est vide."}
          icone="drapeau"
        >
          <p>
            {filtre
              ? "Élargissez les filtres pour revoir tous les signaux."
              : droits.gererReferentiel
                ? "Ajoutez les signaux d'alerte propres à vos secteurs et pays : aucun contenu n'est fourni par défaut."
                : "Les experts du cabinet alimenteront la bibliothèque."}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul className="mp-dd-liste" aria-label="Signaux d'alerte">
            {page.donnees.elements.map((s) => (
              <li key={s.id} className="mp-dd-element">
                <h3 className="mp-dd-element__titre">{s.libelle}</h3>
                <span className="mp-dd-meta">
                  <BadgeNiveauRisque niveau={s.gravite_indicative} />
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {FAMILLE_RISQUE_DD_LIBELLES[s.famille]}
                  </BadgeStatut>
                  <BadgeStatut tonalite={s.actif ? "succes" : "neutre"}>
                    {s.actif ? "Actif" : "Inactif"}
                  </BadgeStatut>
                </span>
                <p className="mp-texte-petit">
                  {`Secteur : ${s.secteur_code ? libelleTaxonomie(secteursEtFilieres, s.secteur_code) : "tous"} · Pays : ${s.pays_code ? libelleTaxonomie(taxonomies.pays, s.pays_code) : "tous"} · version ${s.version}`}
                </p>
                {s.question ? (
                  <p className="mp-dd-texte">{`Question à poser : ${s.question}`}</p>
                ) : null}
                {s.reference_publique ? (
                  <p className="mp-texte-doux mp-texte-petit">{`Référence publique : ${s.reference_publique}`}</p>
                ) : null}
                <details className="mp-dd-details">
                  <summary>Historique des versions</summary>
                  <div className="mp-dd-details__corps">
                    <HistoriqueVersions
                      type="signal"
                      id={s.id}
                      secteurs={secteursEtFilieres}
                      pays={taxonomies.pays}
                    />
                  </div>
                </details>
                {droits.gererReferentiel ? (
                  <details className="mp-dd-details">
                    <summary>Corriger ce signal</summary>
                    <div className="mp-dd-details__corps">
                      <FormulaireSignal
                        secteurs={taxonomies.secteurs}
                        filieres={taxonomies.filieres}
                        pays={taxonomies.pays}
                        signal={s}
                      />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          <PaginationCurseur
            libelle="Pagination des signaux"
            hrefSuivante={
              page.donnees.curseur_suivant ? hrefPage(filtres, page.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? hrefPage(filtres, null) : null}
          />
        </>
      )}

      {droits.gererReferentiel ? (
        <Carte titre="Nouveau signal">
          <FormulaireSignal
            secteurs={taxonomies.secteurs}
            filieres={taxonomies.filieres}
            pays={taxonomies.pays}
          />
        </Carte>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>Lecture seule : la maintenance de la bibliothèque revient aux experts du cabinet.</p>
        </Alerte>
      )}
    </div>
  );
}
