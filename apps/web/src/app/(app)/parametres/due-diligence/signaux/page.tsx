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
  hrefSignaux,
  libelleTaxonomie,
  libellesDd,
  lireFiltresSignaux,
  optionsDe,
  requeteSignaux,
  type FiltresSignaux,
  type PageDd,
  type SignalBibliotheque,
} from "../../../../../lib/due-diligence";
import { chargerTaxonomies } from "../../../../../lib/due-diligence-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Signaux d'alerte", "Warning signals") };
}

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
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const L = libellesDd(langue);
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
  const tous = t("tous", "all");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Signaux d'alerte", "Warning signals")}
        soustitre={t(
          "Bibliothèque des signaux par secteur et pays, maintenue par les experts du cabinet. Le moteur propose à chaque dossier ceux qui s'appliquent.",
          "Library of signals by sector and country, maintained by the firm's experts. The engine offers each file the ones that apply.",
        )}
        actions={
          droits.gererReferentiel ? (
            <a href="#nouveau-signal" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>{t("Nouveau signal", "New signal")}</span>
            </a>
          ) : undefined
        }
      />
      {taxonomies.erreur ? (
        <Alerte
          tonalite="attention"
          titre={t("Libellés incomplets", "Incomplete labels")}
          annonce="aucune"
        >
          <p>{taxonomies.erreur}</p>
        </Alerte>
      ) : null}

      <form
        method="get"
        action={hrefSignaux}
        className="mp-filtres"
        role="search"
        aria-label={t("Filtrer les signaux", "Filter the signals")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle={t("Rechercher", "Search")}
            type="search"
            name="q"
            maxLength={100}
            defaultValue={filtres.q}
            autoComplete="off"
          />
          <Select
            libelle={t("Famille", "Family")}
            name="famille"
            invite={t("Toutes", "All")}
            options={optionsDe(FAMILLES_RISQUE_DD, L.FAMILLE)}
            defaultValue={filtres.famille}
          />
          <Select
            libelle={t("Secteur ou filière", "Sector or subsector")}
            name="secteur_code"
            invite={t("Tous", "All")}
            options={secteursEtFilieres.map((e) => ({ valeur: e.code, libelle: e.libelle }))}
            defaultValue={filtres.secteur_code}
          />
          <Select
            libelle={t("Pays", "Country")}
            name="pays_code"
            invite={t("Tous", "All")}
            options={taxonomies.pays.map((e) => ({ valeur: e.code, libelle: e.libelle }))}
            defaultValue={filtres.pays_code}
          />
          <Select
            libelle={t("État", "Status")}
            name="actif"
            invite={t("Tous", "All")}
            options={[
              { valeur: "true", libelle: t("Actifs", "Active") },
              { valeur: "false", libelle: t("Inactifs", "Inactive") },
            ]}
            defaultValue={filtres.actif}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("secondaire")}>
            <Icone nom="recherche" />
            <span>{t("Filtrer", "Filter")}</span>
          </button>
          {filtre ? (
            <a href={hrefSignaux} className={classesBouton("discret")}>
              {t("Effacer les filtres", "Clear filters")}
            </a>
          ) : null}
        </div>
      </form>

      {!page.ok ? (
        <EtatErreur
          titre={t("Les signaux n'ont pas pu être chargés.", "The signals could not be loaded.")}
          message={page.message}
          hrefReessayer={hrefPage(filtres, curseur)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t("Aucun signal ne correspond.", "No signal matches.")
              : t("La bibliothèque est vide.", "The library is empty.")
          }
          icone="drapeau"
        >
          <p>
            {filtre
              ? t(
                  "Élargissez les filtres pour revoir tous les signaux.",
                  "Widen the filters to see all signals again.",
                )
              : droits.gererReferentiel
                ? t(
                    "Ajoutez les signaux d'alerte propres à vos secteurs et pays : aucun contenu n'est fourni par défaut.",
                    "Add the warning signals specific to your sectors and countries: no content is provided by default.",
                  )
                : t(
                    "Les experts du cabinet alimenteront la bibliothèque.",
                    "The firm's experts will fill the library.",
                  )}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul className="mp-dd-liste" aria-label={t("Signaux d'alerte", "Warning signals")}>
            {page.donnees.elements.map((s) => (
              <li key={s.id} className="mp-dd-element">
                <h3 className="mp-dd-element__titre">{s.libelle}</h3>
                <span className="mp-dd-meta">
                  <BadgeNiveauRisque niveau={s.gravite_indicative} />
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {L.FAMILLE[s.famille]}
                  </BadgeStatut>
                  <BadgeStatut tonalite={s.actif ? "succes" : "neutre"}>
                    {s.actif ? t("Actif", "Active") : t("Inactif", "Inactive")}
                  </BadgeStatut>
                </span>
                <p className="mp-texte-petit">
                  {t(
                    `Secteur : ${s.secteur_code ? libelleTaxonomie(secteursEtFilieres, s.secteur_code, langue) : tous} · Pays : ${s.pays_code ? libelleTaxonomie(taxonomies.pays, s.pays_code, langue) : tous} · version ${s.version}`,
                    `Sector: ${s.secteur_code ? libelleTaxonomie(secteursEtFilieres, s.secteur_code, langue) : tous} · Country: ${s.pays_code ? libelleTaxonomie(taxonomies.pays, s.pays_code, langue) : tous} · version ${s.version}`,
                  )}
                </p>
                {s.question ? (
                  <p className="mp-dd-texte">{`${t("Question à poser", "Question to ask")} : ${s.question}`}</p>
                ) : null}
                {s.reference_publique ? (
                  <p className="mp-texte-doux mp-texte-petit">
                    {`${t("Référence publique", "Public reference")} : ${s.reference_publique}`}
                  </p>
                ) : null}
                <details className="mp-dd-details">
                  <summary>{t("Historique des versions", "Version history")}</summary>
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
                    <summary>{t("Corriger ce signal", "Edit this signal")}</summary>
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
            libelle={t("Pagination des signaux", "Signal pagination")}
            hrefSuivante={
              page.donnees.curseur_suivant ? hrefPage(filtres, page.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? hrefPage(filtres, null) : null}
          />
        </>
      )}

      {droits.gererReferentiel ? (
        <Carte titre={t("Nouveau signal", "New signal")} id="nouveau-signal">
          <FormulaireSignal
            secteurs={taxonomies.secteurs}
            filieres={taxonomies.filieres}
            pays={taxonomies.pays}
          />
        </Carte>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Lecture seule : la maintenance de la bibliothèque revient aux experts du cabinet.",
              "Read-only: library maintenance is up to the firm's experts.",
            )}
          </p>
        </Alerte>
      )}
    </div>
  );
}
