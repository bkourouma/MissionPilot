import {
  creerTraduire,
  type RedAccordVue,
  type RedSituationCreancierVue,
} from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  cheminEvenements,
  libelleStatutAccord,
  tonaliteStatutAccord,
} from "../../lib/redressement";
import { corpsAnnulationPaiement } from "../../lib/redressement-saisie";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { BoutonActionRed } from "./BoutonActionRed";

/**
 * Accord en vigueur et son échéancier : pour chaque échéance, « Soldée » (son rang ne figure pas
 * parmi les échéances restantes calculées par l'API) ou le montant restant. L'imputation des
 * paiements (dans l'ordre des rangs) est celle du moteur ; rien n'est recalculé ici.
 */
export async function EcheancierAccord({
  accord,
  situation,
  devise,
  annulation,
}: {
  accord: RedAccordVue;
  situation: RedSituationCreancierVue;
  devise: Devise;
  /** Présent pour qui peut écrire : propose « Annuler ce paiement » sur chaque paiement non annulé. */
  annulation?: { creancierId: string; aujourdhui: string };
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const restantes = new Map(
    (situation.accord?.echeances_restantes ?? []).map((e) => [e.rang, e.montant_restant]),
  );
  const s = situation.accord;
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
  return (
    <div className="mp-red-section">
      <dl className="mp-liste-def">
        <div>
          <dt>{t("Accord du", "Agreement of")}</dt>
          <dd>{formaterDate(accord.date_evenement, "UTC", langue)}</dd>
        </div>
        <div>
          <dt>{t("Montant convenu", "Agreed amount")}</dt>
          <dd className="mp-red-valeur">{m(accord.montant_convenu)}</dd>
        </div>
        {s ? (
          <>
            <div>
              <dt>{t("Statut", "Status")}</dt>
              <dd>
                <BadgeStatut tonalite={tonaliteStatutAccord(s.statut)}>
                  {libelleStatutAccord(s.statut, langue)}
                </BadgeStatut>
              </dd>
            </div>
            <div>
              <dt>{t("Remise obtenue", "Discount obtained")}</dt>
              <dd className="mp-red-valeur">{m(s.remise)}</dd>
            </div>
            <div>
              <dt>{t("Déjà payé", "Already paid")}</dt>
              <dd className="mp-red-valeur">{m(s.total_paye)}</dd>
            </div>
            <div>
              <dt>{t("Reste à payer", "Remaining to pay")}</dt>
              <dd className="mp-red-valeur">{m(s.reste_a_payer)}</dd>
            </div>
            <div>
              <dt>{t("Retard", "Overdue")}</dt>
              <dd className="mp-red-valeur">{m(s.retard)}</dd>
            </div>
          </>
        ) : null}
        {accord.conditions ? (
          <div>
            <dt>{t("Conditions", "Terms")}</dt>
            <dd className="mp-red-texte-libre">{accord.conditions}</dd>
          </div>
        ) : null}
      </dl>
      <Tableau
        legende={t("Échéancier de l'accord", "Agreement installment schedule")}
        colonnes={[
          {
            cle: "rang",
            entete: t("Échéance", "Installment"),
            rendu: (e: RedAccordVue["echeances"][number]) => e.rang,
          },
          { cle: "date", entete: "Date", rendu: (e) => formaterDate(e.date, "UTC", langue) },
          {
            cle: "montant",
            entete: t("Montant", "Amount"),
            alignement: "droite",
            rendu: (e) => <span className="mp-red-valeur">{m(e.montant)}</span>,
          },
          {
            cle: "restant",
            entete: t("Situation", "Position"),
            alignement: "droite",
            rendu: (e) => {
              const restant = restantes.get(e.rang);
              return restant === undefined ? (
                <BadgeStatut tonalite="succes">{t("Soldée", "Settled")}</BadgeStatut>
              ) : (
                <span className="mp-red-valeur">
                  {m(restant)} {t("restant", "remaining")}
                </span>
              );
            },
          },
        ]}
        lignes={accord.echeances}
        cleLigne={(e) => String(e.rang)}
      />
      {accord.paiements.length > 0 ? (
        <Tableau
          legende={t("Paiements imputés à l'accord", "Payments applied to the agreement")}
          colonnes={[
            {
              cle: "date",
              entete: "Date",
              rendu: (p: RedAccordVue["paiements"][number]) => formaterDate(p.date, "UTC", langue),
            },
            {
              cle: "montant",
              entete: t("Montant", "Amount"),
              alignement: "droite",
              rendu: (p) => <span className="mp-red-valeur">{m(p.montant)}</span>,
            },
            {
              cle: "echeance",
              entete: t("Rattaché à", "Linked to"),
              rendu: (p) =>
                p.echeance_rang !== null
                  ? `${t("Échéance", "Installment")} ${p.echeance_rang}`
                  : "—",
            },
            ...(annulation
              ? [
                  {
                    cle: "annulation",
                    entete: "Action",
                    rendu: (p: RedAccordVue["paiements"][number]) => {
                      const corps = corpsAnnulationPaiement(p.id, annulation.aujourdhui, langue);
                      return corps.ok ? (
                        <BoutonActionRed
                          libelle={t("Annuler ce paiement", "Cancel this payment")}
                          chemin={cheminEvenements(annulation.creancierId)}
                          corps={corps.charge}
                          succes={t(
                            "Paiement annulé : il est retiré de l'imputation.",
                            "Payment cancelled: it is removed from the allocation.",
                          )}
                          variante="danger"
                          confirmation={{
                            question: t(
                              "Annuler ce paiement ? Il reste visible dans le fil de négociation.",
                              "Cancel this payment? It stays visible in the negotiation timeline.",
                            ),
                            libelleConfirmation: t(
                              "Oui, annuler le paiement",
                              "Yes, cancel the payment",
                            ),
                          }}
                        />
                      ) : (
                        "—"
                      );
                    },
                  },
                ]
              : []),
          ]}
          lignes={accord.paiements}
          cleLigne={(p) => p.id}
        />
      ) : null}
    </div>
  );
}
