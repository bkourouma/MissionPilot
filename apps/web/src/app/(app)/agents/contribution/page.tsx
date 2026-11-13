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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Contribution de l'IA", "AI contribution") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerServeur<ContributionsIa>(
    cheminAvecCurseur("/api/agents/contributions", curseur),
  );

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre={t("Contribution de l'IA", "AI contribution")}
        soustitre={t(
          "La part de l'IA est une mesure, pas une affirmation : mots du brouillon conservés dans le texte validé, modifications majeures (plus de 25 % du texte, seuil à calibrer) et temps de revue.",
          "The AI's share is a measurement, not a claim: draft words kept in the approved text, major edits (more than 25% of the text, threshold to be calibrated) and review time.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La contribution de l'IA n'a pas pu être chargée.",
            "The AI contribution could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage("/agents/contribution", curseur)}
        />
      ) : (
        <>
          <Carte titre={t("Synthèse", "Summary")}>
            <dl className="mp-agents__chiffres">
              <div>
                <dt>{t("Livrables mesurés", "Deliverables measured")}</dt>
                <dd>{r.donnees.synthese.livrables}</dd>
              </div>
              <div>
                <dt>{t("Part du brouillon conservée", "Share of the draft kept")}</dt>
                <dd>{formaterPart(r.donnees.synthese.partConservee, langue)}</dd>
              </div>
              <div>
                <dt>{t("Modifications majeures", "Major edits")}</dt>
                <dd>{r.donnees.synthese.modificationsMajeures}</dd>
              </div>
              <div>
                <dt>{t("Temps de revue cumulé", "Total review time")}</dt>
                <dd>{formaterDureeRevue(r.donnees.synthese.totalRevueSecondes)}</dd>
              </div>
            </dl>
            {!r.donnees.synthese.exacte ? (
              <p className="mp-texte-petit mp-texte-doux">
                {t(
                  "Certains textes très longs ont été mesurés par estimation prudente.",
                  "Some very long texts were measured using a conservative estimate.",
                )}
              </p>
            ) : null}
          </Carte>
          {r.donnees.elements.length === 0 ? (
            <EtatVide
              titre={
                curseur
                  ? t("Aucune autre mesure.", "No other measurement.")
                  : t("Aucun livrable mesuré.", "No deliverable measured.")
              }
            >
              <p>
                {t(
                  "Une mesure est prise quand un brouillon d'agent est validé par le circuit humain.",
                  "A measurement is taken when an agent's draft is approved through the human review process.",
                )}
              </p>
            </EtatVide>
          ) : (
            <ul className="mp-liste-lignes">
              {r.donnees.elements.map((c) => (
                <li key={c.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong>
                      {c.agent_code ?? t("Livrable", "Deliverable")}
                      {c.brique_code ? ` · ${c.brique_code}` : ""}
                    </strong>
                    <span className="mp-texte-doux mp-texte-petit">
                      {t(
                        `${c.mots_brouillon} mots proposés, ${c.mots_valides} validés · revue ${formaterDureeRevue(c.temps_revue_secondes)} · ${formaterDate(c.cree_le)}`,
                        `${c.mots_brouillon} words proposed, ${c.mots_valides} approved · review ${formaterDureeRevue(c.temps_revue_secondes)} · ${formaterDate(c.cree_le, "UTC", langue)}`,
                      )}
                    </span>
                  </div>
                  <div className="mp-badges">
                    <BadgeStatut tonalite="neutre">
                      {c.part_conservee_pct === null
                        ? "—"
                        : t(`${c.part_conservee_pct} % conservés`, `${c.part_conservee_pct}% kept`)}
                    </BadgeStatut>
                    {c.modification_majeure ? (
                      <BadgeStatut tonalite="attention">
                        {t("Modification majeure", "Major edit")}
                      </BadgeStatut>
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
