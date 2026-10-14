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
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Listes d'exclusion" };

/**
 * Listes d'exclusion (DD-14), générales ou propres à un investisseur : règles à mots-clés, secteurs
 * et pays. Le cadre public d'inspiration est cité en référence (nom seulement, aucun extrait).
 * Lecture seule sans `dd.referentiel.gerer`.
 */
export default async function PageListesExclusionDd() {
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
        titre="Listes d'exclusion"
        soustitre="Activités, secteurs et pays exclus pour un investisseur ou pour tous. Chaque revue environnementale et sociale applique la version courante d'une liste."
      />
      {taxonomies.erreur ? (
        <Alerte tonalite="attention" titre="Libellés incomplets" annonce="aucune">
          <p>{taxonomies.erreur}</p>
        </Alerte>
      ) : null}
      {!listes.ok ? (
        <EtatErreur
          titre="Les listes n'ont pas pu être chargées."
          message={listes.message}
          hrefReessayer={hrefListesExclusion}
        />
      ) : listes.donnees.length === 0 ? (
        <EtatVide titre="Aucune liste d'exclusion." icone="drapeau">
          <p>
            {droits.gererReferentiel
              ? "Créez une liste générale ou propre à un investisseur."
              : "Les experts du cabinet créeront les listes d'exclusion."}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-dd-liste" aria-label="Listes d'exclusion">
          {listes.donnees.map((l) => (
            <li key={l.id} className="mp-dd-element">
              <h3 className="mp-dd-element__titre">{l.nom}</h3>
              <span className="mp-dd-meta">
                <BadgeStatut tonalite="neutre" sansIcone>
                  {l.client_id ? (l.client_raison_sociale ?? "Investisseur") : "Générale"}
                </BadgeStatut>
                <span className="mp-texte-petit">{`Version ${l.version} · ${l.nb_regles} règle${l.nb_regles > 1 ? "s" : ""}`}</span>
              </span>
              {l.reference_cadre ? (
                <p className="mp-texte-doux mp-texte-petit">{`Cadre public de référence : ${l.reference_cadre}`}</p>
              ) : null}
              <details className="mp-dd-details">
                <summary>Historique des versions</summary>
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
                  <summary>Corriger cette liste</summary>
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
        <Carte titre="Nouvelle liste">
          <FormulaireListeExclusion
            secteurs={taxonomies.secteurs}
            pays={taxonomies.pays}
            investisseurs={investisseurs}
          />
        </Carte>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>Lecture seule : la maintenance des listes revient aux experts du cabinet.</p>
        </Alerte>
      )}
    </div>
  );
}
