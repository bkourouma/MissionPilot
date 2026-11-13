import { Carte } from "../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import type { Collaborateur, CoutsCollaborateur, LigneCouts } from "../../../../lib/collaborateurs";
import { formaterDate, formaterMontantMineur } from "../../../../lib/format";
import { FormulaireCouts } from "./FormulaireCouts";

/**
 * Coûts et taux d'un collaborateur (FIN-02). Server Component : à n'afficher que pour un
 * utilisateur ayant `finance.lire` (vérifié par la page appelante ; l'API le vérifie aussi).
 */
export async function SectionCouts({
  collaborateur,
  peutSaisir,
}: {
  collaborateur: Collaborateur;
  peutSaisir: boolean;
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const r = await chargerServeur<CoutsCollaborateur>(
    `/api/collaborateurs/${collaborateur.id}/couts`,
  );
  const montant = (v: number | null, l: LigneCouts) => formaterMontantMineur(v, l.devise, langue);
  const externe = collaborateur.type !== "interne";

  return (
    <Carte
      titre={t("Coûts et taux", "Costs and rates")}
      actions={
        <span className="mp-mention-confidentielle">
          {t("Confidentiel : associés et gestionnaires", "Confidential: partners and managers")}
        </span>
      }
    >
      <div className="mp-pile">
        {!r.ok ? (
          <EtatErreur
            titre={t("Les coûts n'ont pas pu être chargés.", "The costs could not be loaded.")}
            message={r.message}
            hrefReessayer={`/collaborateurs/${collaborateur.id}`}
          />
        ) : r.donnees.historique.length === 0 ? (
          <EtatVide
            titre={t(
              "Aucun coût enregistré pour ce collaborateur.",
              "No cost recorded for this team member.",
            )}
          >
            {peutSaisir ? (
              <p>
                {t(
                  "Saisissez la première ligne avec le formulaire ci-dessous.",
                  "Enter the first line using the form below.",
                )}
              </p>
            ) : null}
          </EtatVide>
        ) : (
          <>
            {r.donnees.courant ? (
              <dl className="mp-liste-def">
                <div>
                  <dt>
                    {t("Coût journalier chargé en vigueur", "Current fully loaded daily cost")}
                  </dt>
                  <dd>{montant(r.donnees.courant.cout_journalier, r.donnees.courant)}</dd>
                </div>
                <div>
                  <dt>{t("Taux de vente spécifique", "Specific selling rate")}</dt>
                  <dd>
                    {r.donnees.courant.taux_vente_specifique === null
                      ? t("Taux du grade", "Grade rate")
                      : montant(r.donnees.courant.taux_vente_specifique, r.donnees.courant)}
                  </dd>
                </div>
                {externe || r.donnees.courant.cout_achat !== null ? (
                  <div>
                    <dt>{t("Coût d'achat journalier", "Daily purchase cost")}</dt>
                    <dd>{montant(r.donnees.courant.cout_achat, r.donnees.courant)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t("En vigueur depuis le", "In effect since")}</dt>
                  <dd>{formaterDate(r.donnees.courant.depuis_le, "UTC", langue)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mp-texte-doux">
                {t(
                  "Aucune ligne n'est encore en vigueur (dates d'effet à venir).",
                  "No line is in effect yet (effective dates are in the future).",
                )}
              </p>
            )}
            <Tableau
              legende={t("Historique des coûts", "Cost history")}
              legendeVisible
              lignes={r.donnees.historique}
              cleLigne={(l) => l.id}
              colonnes={[
                {
                  cle: "depuis_le",
                  entete: t("Date d'effet", "Effective date"),
                  rendu: (l) => formaterDate(l.depuis_le, "UTC", langue),
                },
                {
                  cle: "cout",
                  entete: t("Coût journalier", "Daily cost"),
                  alignement: "droite",
                  rendu: (l) => montant(l.cout_journalier, l),
                },
                {
                  cle: "taux",
                  entete: t("Taux spécifique", "Specific rate"),
                  alignement: "droite",
                  rendu: (l) => montant(l.taux_vente_specifique, l),
                },
                {
                  cle: "achat",
                  entete: t("Coût d'achat", "Purchase cost"),
                  alignement: "droite",
                  rendu: (l) => montant(l.cout_achat, l),
                },
              ]}
            />
          </>
        )}
        {peutSaisir ? (
          <FormulaireCouts collaborateurId={collaborateur.id} externe={externe} />
        ) : null}
      </div>
    </Carte>
  );
}
