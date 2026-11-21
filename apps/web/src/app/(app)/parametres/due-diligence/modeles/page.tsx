import type { Metadata } from "next";
import { FormulaireModeleSecteur } from "../../../../../components/due-diligence/FormulaireModeleSecteur";
import { HistoriqueModele } from "../../../../../components/due-diligence/HistoriqueModele";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { droitsDd, libelleTaxonomie, type PageDd } from "../../../../../lib/due-diligence";
import {
  ANALYSES_MODELE_LIBELLES,
  ANALYSES_MODELE_LIBELLES_EN,
  cheminModelesSecteur,
  hrefModelesSecteur,
  MESSAGE_AUCUN_MODELE,
  MESSAGE_AUCUN_MODELE_EN,
  pointsParCategorie,
  type ModeleSecteur,
} from "../../../../../lib/due-diligence-modeles";
import { chargerTaxonomies } from "../../../../../lib/due-diligence-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Modèles sectoriels", "Sector templates") };
}

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function hrefPage(curseur: string | null) {
  return curseur
    ? `${hrefModelesSecteur}?curseur=${encodeURIComponent(curseur)}`
    : hrefModelesSecteur;
}

/**
 * Modèles d'analyse par secteur (DD-07), propres au cabinet, VIDES au départ : aucun contenu n'est
 * fourni, les experts du cabinet les rédigent. Un modèle = des « points à examiner » (rappels, pas
 * des affirmations) pour un secteur et une analyse. Chaque correction crée une version motivée ;
 * un modèle retiré n'est plus proposé aux dossiers. Lecture seule sans `dd.referentiel.gerer`.
 */
export default async function PageModelesSecteurDd({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const analyses = langue === "en" ? ANALYSES_MODELE_LIBELLES_EN : ANALYSES_MODELE_LIBELLES;
  const { utilisateur } = await exigerPermission("dd.lire");
  const droits = droitsDd(utilisateur.roles);
  const sp = await searchParams;
  const curseurBrut = premier(sp.curseur);
  const curseur =
    curseurBrut && curseurBrut.length <= 500 && /^[A-Za-z0-9_-]+$/.test(curseurBrut)
      ? curseurBrut
      : null;
  const [page, taxonomies] = await Promise.all([
    chargerServeur<PageDd<ModeleSecteur>>(
      cheminModelesSecteur(curseur ? `curseur=${encodeURIComponent(curseur)}` : ""),
    ),
    chargerTaxonomies(),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Modèles sectoriels", "Sector templates")}
        soustitre={t(
          "Points à examiner par secteur et par analyse, rédigés par les experts du cabinet. Ce sont des rappels : ils n'ajoutent aucune affirmation au dossier.",
          "Points to examine by sector and by analysis, written by the firm's experts. They are reminders: they add no statement to the file.",
        )}
        actions={
          droits.gererReferentiel ? (
            <a href="#nouveau-modele" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>{t("Nouveau modèle", "New template")}</span>
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

      {!page.ok ? (
        <EtatErreur
          titre={t("Les modèles n'ont pas pu être chargés.", "The templates could not be loaded.")}
          message={page.message}
          hrefReessayer={hrefPage(curseur)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide titre={t(MESSAGE_AUCUN_MODELE, MESSAGE_AUCUN_MODELE_EN)} icone="drapeau">
          <p>
            {droits.gererReferentiel
              ? t(
                  "Ajoutez un modèle pour un secteur et une analyse : aucun contenu n'est fourni par défaut.",
                  "Add a template for a sector and an analysis: no content is provided by default.",
                )
              : t(
                  "Les experts du cabinet alimenteront cette bibliothèque.",
                  "The firm's experts will fill this library.",
                )}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul className="mp-dd-liste" aria-label={t("Modèles sectoriels", "Sector templates")}>
            {page.donnees.elements.map((m) => (
              <li key={m.id} className="mp-dd-element">
                <h3 className="mp-dd-element__titre">
                  {`${libelleTaxonomie(taxonomies.secteurs, m.secteur_code, langue)} · ${analyses[m.analyse]}`}
                </h3>
                <span className="mp-dd-meta">
                  <BadgeStatut tonalite={m.actif ? "succes" : "neutre"}>
                    {m.actif ? t("Actif", "Active") : t("Retiré", "Removed")}
                  </BadgeStatut>
                </span>
                <p className="mp-texte-doux mp-texte-petit">
                  {t(
                    `Version ${m.version} · ${m.points.length} point(s) à examiner`,
                    `Version ${m.version} · ${m.points.length} point(s) to examine`,
                  )}
                </p>
                {pointsParCategorie(m.analyse, m.points, langue).map((g) => (
                  <section
                    key={g.categorie}
                    aria-label={t(
                      `${g.libelle}, points à examiner`,
                      `${g.libelle}, points to examine`,
                    )}
                  >
                    <h4 className="mp-dd-categorie__titre">{g.libelle}</h4>
                    <ul>
                      {g.points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </section>
                ))}
                <details className="mp-dd-details">
                  <summary>{t("Historique des versions", "Version history")}</summary>
                  <div className="mp-dd-details__corps">
                    <HistoriqueModele id={m.id} />
                  </div>
                </details>
                {droits.gererReferentiel ? (
                  <details className="mp-dd-details">
                    <summary>{t("Nouvelle version ou retrait", "New version or removal")}</summary>
                    <div className="mp-dd-details__corps">
                      <FormulaireModeleSecteur secteurs={taxonomies.secteurs} modele={m} />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          <PaginationCurseur
            libelle={t("Pagination des modèles", "Template pagination")}
            hrefSuivante={
              page.donnees.curseur_suivant ? hrefPage(page.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? hrefPage(null) : null}
          />
        </>
      )}

      {droits.gererReferentiel ? (
        <Carte titre={t("Nouveau modèle", "New template")} id="nouveau-modele">
          <FormulaireModeleSecteur secteurs={taxonomies.secteurs} />
        </Carte>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Lecture seule : la rédaction des modèles revient aux experts du cabinet.",
              "Read-only: writing the templates is up to the firm's experts.",
            )}
          </p>
        </Alerte>
      )}
    </div>
  );
}
