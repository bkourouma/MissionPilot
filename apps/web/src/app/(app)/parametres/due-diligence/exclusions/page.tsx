import type { Metadata } from "next";
import {
  CorrectionListeExclusion,
  HistoriqueVersions,
} from "../../../../../components/due-diligence/HistoriqueVersions";
import { FormulaireListeExclusion } from "../../../../../components/due-diligence/FormulaireListeExclusion";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { droitsDd, hrefListesExclusion } from "../../../../../lib/due-diligence";
import {
  chargerInvestisseurs,
  chargerListesExclusion,
  chargerTaxonomies,
} from "../../../../../lib/due-diligence-serveur";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Listes d'exclusion", "Exclusion lists") };
}

/**
 * Listes d'exclusion (DD-14), générales ou propres à un investisseur : règles à mots-clés, secteurs
 * et pays. Le cadre public d'inspiration est cité en référence (nom seulement, aucun extrait).
 * Lecture seule sans `dd.referentiel.gerer`.
 */
export default async function PageListesExclusionDd() {
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const droits = droitsDd(utilisateur.roles);
  const [listes, taxonomies, investisseurs] = await Promise.all([
    chargerListesExclusion(),
    chargerTaxonomies(),
    droits.gererReferentiel ? chargerInvestisseurs(utilisateur.roles) : Promise.resolve([]),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Listes d'exclusion", "Exclusion lists")}
        soustitre={t(
          "Activités, secteurs et pays exclus pour un investisseur ou pour tous. Chaque revue environnementale et sociale applique la version courante d'une liste.",
          "Activities, sectors and countries excluded for one investor or for all. Each environmental and social review applies the current version of a list.",
        )}
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
      {!listes.ok ? (
        <EtatErreur
          titre={t("Les listes n'ont pas pu être chargées.", "The lists could not be loaded.")}
          message={listes.message}
          hrefReessayer={hrefListesExclusion}
        />
      ) : listes.donnees.length === 0 ? (
        <EtatVide titre={t("Aucune liste d'exclusion.", "No exclusion list.")} icone="drapeau">
          <p>
            {droits.gererReferentiel
              ? t(
                  "Créez une liste générale ou propre à un investisseur.",
                  "Create a general list or one specific to an investor.",
                )
              : t(
                  "Les experts du cabinet créeront les listes d'exclusion.",
                  "The firm's experts will create the exclusion lists.",
                )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-dd-liste" aria-label={t("Listes d'exclusion", "Exclusion lists")}>
          {listes.donnees.map((l) => (
            <li key={l.id} className="mp-dd-element">
              <h3 className="mp-dd-element__titre">{l.nom}</h3>
              <span className="mp-dd-meta">
                <BadgeStatut tonalite="neutre" sansIcone>
                  {l.client_id
                    ? (l.client_raison_sociale ?? t("Investisseur", "Investor"))
                    : t("Générale", "General")}
                </BadgeStatut>
                <span className="mp-texte-petit">
                  {t(
                    `Version ${l.version} · ${l.nb_regles} règle${l.nb_regles > 1 ? "s" : ""}`,
                    `Version ${l.version} · ${l.nb_regles} rule${l.nb_regles > 1 ? "s" : ""}`,
                  )}
                </span>
              </span>
              {l.reference_cadre ? (
                <p className="mp-texte-doux mp-texte-petit">
                  {`${t("Cadre public de référence", "Public reference framework")} : ${l.reference_cadre}`}
                </p>
              ) : null}
              <details className="mp-dd-details">
                <summary>{t("Historique des versions", "Version history")}</summary>
                <div className="mp-dd-details__corps">
                  <HistoriqueVersions
                    type="liste"
                    id={l.id}
                    secteurs={taxonomies.secteurs}
                    pays={taxonomies.pays}
                  />
                </div>
              </details>
              {droits.gererReferentiel ? (
                <details className="mp-dd-details">
                  <summary>{t("Corriger cette liste", "Edit this list")}</summary>
                  <div className="mp-dd-details__corps">
                    <CorrectionListeExclusion
                      liste={l}
                      secteurs={taxonomies.secteurs}
                      pays={taxonomies.pays}
                      investisseurs={investisseurs}
                    />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {droits.gererReferentiel ? (
        <Carte titre={t("Nouvelle liste", "New list")}>
          <FormulaireListeExclusion
            secteurs={taxonomies.secteurs}
            pays={taxonomies.pays}
            investisseurs={investisseurs}
          />
        </Carte>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Lecture seule : la maintenance des listes revient aux experts du cabinet.",
              "Read-only: list maintenance is up to the firm's experts.",
            )}
          </p>
        </Alerte>
      )}
    </div>
  );
}
