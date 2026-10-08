import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  cheminAvecCurseur,
  formaterDureeRevue,
  formaterPart,
  hrefPage,
  lireCurseur,
  type ContributionsIa,
} from "../../../../lib/agents";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";

export const metadata: Metadata = { title: "Contribution de l'IA" };

/**
 * Contribution de l'IA mesurée par livrable (AGT-05) : part du brouillon conservée après
 * validation (distance d'édition en mots), modifications majeures et temps de revue. Mesures
 * du moteur pur ; elles alimentent la promotion d'autonomie et la mention de contribution.
 */
export default async function PageContribution({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerServeur<ContributionsIa>(
    cheminAvecCurseur("/api/agents/contributions", curseur),
  );

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre="Contribution de l'IA"
        soustitre="La part de l'IA est une mesure, pas une affirmation : mots du brouillon conservés dans le texte validé, modifications majeures (plus de 25 % du texte, seuil à calibrer) et temps de revue."
      />
      {!r.ok ? (
        <EtatErreur
          titre="La contribution de l'IA n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage("/agents/contribution", curseur)}
        />
      ) : (
        <>
          <Carte titre="Synthèse">
            <dl className="mp-agents__chiffres">
              <div>
                <dt>Livrables mesurés</dt>
                <dd>{r.donnees.synthese.livrables}</dd>
              </div>
              <div>
                <dt>Part du brouillon conservée</dt>
                <dd>{formaterPart(r.donnees.synthese.partConservee)}</dd>
              </div>
              <div>
                <dt>Modifications majeures</dt>
                <dd>{r.donnees.synthese.modificationsMajeures}</dd>
              </div>
              <div>
                <dt>Temps de revue cumulé</dt>
                <dd>{formaterDureeRevue(r.donnees.synthese.totalRevueSecondes)}</dd>
              </div>
            </dl>
            {!r.donnees.synthese.exacte ? (
              <p className="mp-texte-petit mp-texte-doux">
                Certains textes très longs ont été mesurés par estimation prudente.
              </p>
            ) : null}
          </Carte>
          {r.donnees.elements.length === 0 ? (
            <EtatVide titre={curseur ? "Aucune autre mesure." : "Aucun livrable mesuré."}>
              <p>
                Une mesure est prise quand un brouillon d&apos;agent est validé par le circuit
                humain.
              </p>
            </EtatVide>
          ) : (
            <ul className="mp-liste-lignes">
              {r.donnees.elements.map((c) => (
                <li key={c.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong>
                      {c.agent_code ?? "Livrable"}
                      {c.brique_code ? ` · ${c.brique_code}` : ""}
                    </strong>
                    <span className="mp-texte-doux mp-texte-petit">
                      {c.mots_brouillon} mots proposés, {c.mots_valides} validés · revue{" "}
                      {formaterDureeRevue(c.temps_revue_secondes)} · {formaterDate(c.cree_le)}
                    </span>
                  </div>
                  <div className="mp-badges">
                    <BadgeStatut tonalite="neutre">
                      {c.part_conservee_pct === null ? "—" : `${c.part_conservee_pct} % conservés`}
                    </BadgeStatut>
                    {c.modification_majeure ? (
                      <BadgeStatut tonalite="attention">Modification majeure</BadgeStatut>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefPage("/agents/contribution", r.donnees.curseur_suivant)
                : null
            }
            hrefDebut={curseur ? "/agents/contribution" : null}
          />
        </>
      )}
    </div>
  );
}
