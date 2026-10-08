import Link from "next/link";
import { BadgePaiement } from "../../../../components/finance/BadgePaiement";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { Tableau } from "../../../../components/ui/Tableau";
import {
  MODE_LIBELLES,
  ORIGINE_IMPUTATION,
  type PaiementFacture as Paiement,
} from "../../../../lib/encaissements";
import { libelleNiveau } from "../../../../lib/creances";
import { formaterDate, formaterDateHeure, formaterMontantMineur } from "../../../../lib/format";
import type { Devise } from "../../../../lib/format";
import { RelanceManuelle } from "./RelanceManuelle";

/**
 * Situation de paiement (dérivée par l'API), imputations et historique des relances d'une
 * facture émise. Aucun coût ni marge : seulement net à payer, encaissé et reste dû.
 */
export function PaiementFacture({
  paiement: p,
  devise,
  gererEncaissements,
}: {
  paiement: Paiement;
  devise: Devise;
  gererEncaissements: boolean;
}) {
  const d = p.devise ?? devise;
  const relancable =
    gererEncaissements &&
    p.statut_paiement !== undefined &&
    p.statut_paiement !== "soldee" &&
    p.statut_paiement !== "annulee";
  return (
    <Carte
      titre="Paiement et relances"
      actions={
        p.statut_paiement ? (
          <BadgePaiement statut={p.statut_paiement} joursRetard={p.jours_retard} />
        ) : null
      }
    >
      <div className="mp-pile">
        {p.statut_paiement ? (
          <ul className="mp-totaux" aria-label="Situation de paiement">
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Net à payer</span>
              <span className="mp-totaux__valeur">{formaterMontantMineur(p.net_a_payer, d)}</span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Encaissé</span>
              <span className="mp-totaux__valeur">{formaterMontantMineur(p.encaisse, d)}</span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Reste à payer</span>
              <span className="mp-totaux__valeur">{formaterMontantMineur(p.solde, d)}</span>
            </li>
          </ul>
        ) : (
          <p className="mp-texte-doux">La situation de paiement est suivie dès l&apos;émission.</p>
        )}
        <Tableau
          legende="Encaissements imputés sur la facture"
          legendeVisible
          lignes={p.imputations}
          cleLigne={(i) => i.id}
          messageVide="Aucun encaissement imputé pour l'instant."
          colonnes={[
            { cle: "date", entete: "Date", rendu: (i) => formaterDate(i.date_imputation) },
            {
              cle: "mode",
              entete: "Moyen",
              rendu: (i) =>
                gererEncaissements ? (
                  <Link href={`/facturation/encaissements/${i.encaissement_id}`}>
                    {MODE_LIBELLES[i.mode]}
                  </Link>
                ) : (
                  MODE_LIBELLES[i.mode]
                ),
            },
            { cle: "origine", entete: "Origine", rendu: (i) => ORIGINE_IMPUTATION[i.origine] },
            {
              cle: "montant",
              entete: "Montant",
              alignement: "droite",
              rendu: (i) => (
                <span className="mp-montant">{formaterMontantMineur(i.montant, d)}</span>
              ),
            },
          ]}
        />
        <Tableau
          legende="Historique des relances"
          legendeVisible
          lignes={p.relances}
          cleLigne={(r) => r.id}
          messageVide="Aucune relance pour cette facture."
          colonnes={[
            { cle: "date", entete: "Date", rendu: (r) => formaterDate(r.date_relance) },
            { cle: "niveau", entete: "Niveau", rendu: (r) => libelleNiveau(r.niveau) },
            {
              cle: "mode",
              entete: "Déclenchement",
              rendu: (r) => (r.mode === "automatique" ? "Automatique" : "Manuelle"),
            },
            {
              cle: "retard",
              entete: "Retard",
              alignement: "droite",
              rendu: (r) => String(r.jours_retard) + " j",
            },
            {
              cle: "email",
              entete: "E-mail au client",
              rendu: (r) =>
                r.email_envoye ? (
                  <BadgeStatut tonalite="succes">Envoyé</BadgeStatut>
                ) : r.email_prepare ? (
                  <BadgeStatut tonalite="neutre">Préparé, non envoyé</BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="neutre">Aucun</BadgeStatut>
                ),
            },
            {
              cle: "cree",
              entete: "Enregistrée le",
              rendu: (r) => formaterDateHeure(r.cree_le),
            },
          ]}
        />
        {relancable ? (
          <RelanceManuelle factureId={p.facture_id} cle={`${p.relances.length}`} />
        ) : null}
      </div>
    </Carte>
  );
}
