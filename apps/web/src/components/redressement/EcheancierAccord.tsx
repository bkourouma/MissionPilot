import type { RedAccordVue, RedSituationCreancierVue } from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
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
export function EcheancierAccord({
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
  const restantes = new Map(
    (situation.accord?.echeances_restantes ?? []).map((e) => [e.rang, e.montant_restant]),
  );
  const s = situation.accord;
  const m = (v: number) => formaterMontantMineur(v, devise);
  return (
    <div className="mp-red-section">
      <dl className="mp-liste-def">
        <div>
          <dt>Accord du</dt>
          <dd>{formaterDate(accord.date_evenement)}</dd>
        </div>
        <div>
          <dt>Montant convenu</dt>
          <dd className="mp-red-valeur">{m(accord.montant_convenu)}</dd>
        </div>
        {s ? (
          <>
            <div>
              <dt>Statut</dt>
              <dd>
                <BadgeStatut tonalite={tonaliteStatutAccord(s.statut)}>
                  {libelleStatutAccord(s.statut)}
                </BadgeStatut>
              </dd>
            </div>
            <div>
              <dt>Remise obtenue</dt>
              <dd className="mp-red-valeur">{m(s.remise)}</dd>
            </div>
            <div>
              <dt>Déjà payé</dt>
              <dd className="mp-red-valeur">{m(s.total_paye)}</dd>
            </div>
            <div>
              <dt>Reste à payer</dt>
              <dd className="mp-red-valeur">{m(s.reste_a_payer)}</dd>
            </div>
            <div>
              <dt>Retard</dt>
              <dd className="mp-red-valeur">{m(s.retard)}</dd>
            </div>
          </>
        ) : null}
        {accord.conditions ? (
          <div>
            <dt>Conditions</dt>
            <dd className="mp-red-texte-libre">{accord.conditions}</dd>
          </div>
        ) : null}
      </dl>
      <Tableau
        legende="Échéancier de l'accord"
        colonnes={[
          {
            cle: "rang",
            entete: "Échéance",
            rendu: (e: RedAccordVue["echeances"][number]) => e.rang,
          },
          { cle: "date", entete: "Date", rendu: (e) => formaterDate(e.date) },
          {
            cle: "montant",
            entete: "Montant",
            alignement: "droite",
            rendu: (e) => <span className="mp-red-valeur">{m(e.montant)}</span>,
          },
          {
            cle: "restant",
            entete: "Situation",
            alignement: "droite",
            rendu: (e) => {
              const restant = restantes.get(e.rang);
              return restant === undefined ? (
                <BadgeStatut tonalite="succes">Soldée</BadgeStatut>
              ) : (
                <span className="mp-red-valeur">{m(restant)} restant</span>
              );
            },
          },
        ]}
        lignes={accord.echeances}
        cleLigne={(e) => String(e.rang)}
      />
      {accord.paiements.length > 0 ? (
        <Tableau
          legende="Paiements imputés à l'accord"
          colonnes={[
            {
              cle: "date",
              entete: "Date",
              rendu: (p: RedAccordVue["paiements"][number]) => formaterDate(p.date),
            },
            {
              cle: "montant",
              entete: "Montant",
              alignement: "droite",
              rendu: (p) => <span className="mp-red-valeur">{m(p.montant)}</span>,
            },
            {
              cle: "echeance",
              entete: "Rattaché à",
              rendu: (p) => (p.echeance_rang !== null ? `Échéance ${p.echeance_rang}` : "—"),
            },
            ...(annulation
              ? [
                  {
                    cle: "annulation",
                    entete: "Action",
                    rendu: (p: RedAccordVue["paiements"][number]) => {
                      const corps = corpsAnnulationPaiement(p.id, annulation.aujourdhui);
                      return corps.ok ? (
                        <BoutonActionRed
                          libelle="Annuler ce paiement"
                          chemin={cheminEvenements(annulation.creancierId)}
                          corps={corps.charge}
                          succes="Paiement annulé : il est retiré de l'imputation."
                          variante="danger"
                          confirmation={{
                            question:
                              "Annuler ce paiement ? Il reste visible dans le fil de négociation.",
                            libelleConfirmation: "Oui, annuler le paiement",
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
