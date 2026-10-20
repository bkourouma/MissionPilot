import type { Metadata } from "next";
import { FormulaireModeleSecteur } from "../../../../../components/due-diligence/FormulaireModeleSecteur";
import { HistoriqueModele } from "../../../../../components/due-diligence/HistoriqueModele";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { droitsDd, libelleTaxonomie, type PageDd } from "../../../../../lib/due-diligence";
import {
  ANALYSES_MODELE_LIBELLES,
  cheminModelesSecteur,
  hrefModelesSecteur,
  MESSAGE_AUCUN_MODELE,
  pointsParCategorie,
  type ModeleSecteur,
} from "../../../../../lib/due-diligence-modeles";
import { chargerTaxonomies } from "../../../../../lib/due-diligence-serveur";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Modèles sectoriels" };

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
        titre="Modèles sectoriels"
        soustitre="Points à examiner par secteur et par analyse, rédigés par les experts du cabinet. Ce sont des rappels : ils n'ajoutent aucune affirmation au dossier."
      />
      {taxonomies.erreur ? (
        <Alerte tonalite="attention" titre="Libellés incomplets" annonce="aucune">
          <p>{taxonomies.erreur}</p>
        </Alerte>
      ) : null}

      {!page.ok ? (
        <EtatErreur
          titre="Les modèles n'ont pas pu être chargés."
          message={page.message}
          hrefReessayer={hrefPage(curseur)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide titre={MESSAGE_AUCUN_MODELE} icone="drapeau">
          <p>
            {droits.gererReferentiel
              ? "Ajoutez un modèle pour un secteur et une analyse : aucun contenu n'est fourni par défaut."
              : "Les experts du cabinet alimenteront cette bibliothèque."}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul className="mp-dd-liste" aria-label="Modèles sectoriels">
            {page.donnees.elements.map((m) => (
              <li key={m.id} className="mp-dd-element">
                <h3 className="mp-dd-element__titre">
                  {`${libelleTaxonomie(taxonomies.secteurs, m.secteur_code)} · ${ANALYSES_MODELE_LIBELLES[m.analyse]}`}
                </h3>
                <span className="mp-dd-meta">
                  <BadgeStatut tonalite={m.actif ? "succes" : "neutre"}>
                    {m.actif ? "Actif" : "Retiré"}
                  </BadgeStatut>
                </span>
                <p className="mp-texte-doux mp-texte-petit">{`Version ${m.version} · ${m.points.length} point(s) à examiner`}</p>
                {pointsParCategorie(m.analyse, m.points).map((g) => (
                  <section key={g.categorie} aria-label={`${g.libelle}, points à examiner`}>
                    <h4 className="mp-dd-categorie__titre">{g.libelle}</h4>
                    <ul>
                      {g.points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </section>
                ))}
                <details className="mp-dd-details">
                  <summary>Historique des versions</summary>
                  <div className="mp-dd-details__corps">
                    <HistoriqueModele id={m.id} />
                  </div>
                </details>
                {droits.gererReferentiel ? (
                  <details className="mp-dd-details">
                    <summary>Nouvelle version ou retrait</summary>
                    <div className="mp-dd-details__corps">
                      <FormulaireModeleSecteur secteurs={taxonomies.secteurs} modele={m} />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          <PaginationCurseur
            libelle="Pagination des modèles"
            hrefSuivante={
              page.donnees.curseur_suivant ? hrefPage(page.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? hrefPage(null) : null}
          />
        </>
      )}

      {droits.gererReferentiel ? (
        <Carte titre="Nouveau modèle">
          <FormulaireModeleSecteur secteurs={taxonomies.secteurs} />
        </Carte>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>Lecture seule : la rédaction des modèles revient aux experts du cabinet.</p>
        </Alerte>
      )}
    </div>
  );
}
