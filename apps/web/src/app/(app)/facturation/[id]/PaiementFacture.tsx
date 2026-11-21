import Link from "next/link";
import { BadgePaiement } from "../../../../components/finance/BadgePaiement";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { Tableau } from "../../../../components/ui/Tableau";
import {
  libelleMode,
  libelleOrigineImputation,
  type PaiementFacture as Paiement,
} from "../../../../lib/encaissements";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import { creerTraduire } from "@missionpilot/shared";
import { libelleNiveau } from "../../../../lib/creances";
import { formaterDate, formaterDateHeure, formaterMontantMineur } from "../../../../lib/format";
import type { Devise } from "../../../../lib/format";
import { RelanceManuelle } from "./RelanceManuelle";

/**
 * Situation de paiement (dérivée par l'API), imputations et historique des relances d'une
 * facture émise. Aucun coût ni marge : seulement net à payer, encaissé et reste dû.
 */
export async function PaiementFacture({
  paiement: p,
  devise,
  gererEncaissements,
}: {
  paiement: Paiement;
  devise: Devise;
  gererEncaissements: boolean;
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const d = p.devise ?? devise;
  const relancable =
    gererEncaissements &&
    p.statut_paiement !== undefined &&
    p.statut_paiement !== "soldee" &&
    p.statut_paiement !== "annulee";
  return (
    <Carte
      titre={t("Paiement et relances", "Payment and reminders")}
      actions={
        p.statut_paiement ? (
          <BadgePaiement statut={p.statut_paiement} joursRetard={p.jours_retard} />
        ) : null
      }
    >
      <div className="mp-pile mp-chiffres">
        {p.statut_paiement ? (
          <ul className="mp-totaux" aria-label={t("Situation de paiement", "Payment status")}>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">{t("Net à payer", "Net payable")}</span>
              <span className="mp-totaux__valeur">
                {formaterMontantMineur(p.net_a_payer, d, langue)}
              </span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">{t("Encaissé", "Received")}</span>
              <span className="mp-totaux__valeur">
                {formaterMontantMineur(p.encaisse, d, langue)}
              </span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">{t("Reste à payer", "Balance due")}</span>
              <span className="mp-totaux__valeur">{formaterMontantMineur(p.solde, d, langue)}</span>
            </li>
          </ul>
        ) : (
          <p className="mp-texte-doux">
            {t(
              "La situation de paiement est suivie dès l'émission.",
              "The payment status is tracked from issuance.",
            )}
          </p>
        )}
        <Tableau
          legende={t(
            "Encaissements imputés sur la facture",
            "Payments received allocated to the invoice",
          )}
          legendeVisible
          lignes={p.imputations}
          cleLigne={(i) => i.id}
          messageVide={t("Aucun encaissement imputé pour l'instant.", "No payment allocated yet.")}
          colonnes={[
            {
              cle: "date",
              entete: t("Date", "Date"),
              rendu: (i) => formaterDate(i.date_imputation, "UTC", langue),
            },
            {
              cle: "mode",
              entete: t("Moyen", "Method"),
              rendu: (i) =>
                gererEncaissements ? (
                  <Link href={`/facturation/encaissements/${i.encaissement_id}`}>
                    {libelleMode(i.mode, langue)}
                  </Link>
                ) : (
                  libelleMode(i.mode, langue)
                ),
            },
            {
              cle: "origine",
              entete: t("Origine", "Origin"),
              rendu: (i) => libelleOrigineImputation(i.origine, langue),
            },
            {
              cle: "montant",
              entete: t("Montant", "Amount"),
              alignement: "droite",
              rendu: (i) => (
                <span className="mp-montant">{formaterMontantMineur(i.montant, d, langue)}</span>
              ),
            },
          ]}
        />
        <Tableau
          legende={t("Historique des relances", "Reminder history")}
          legendeVisible
          lignes={p.relances}
          cleLigne={(r) => r.id}
          messageVide={t("Aucune relance pour cette facture.", "No reminders for this invoice.")}
          colonnes={[
            {
              cle: "date",
              entete: t("Date", "Date"),
              rendu: (r) => formaterDate(r.date_relance, "UTC", langue),
            },
            {
              cle: "niveau",
              entete: t("Niveau", "Level"),
              rendu: (r) => libelleNiveau(r.niveau, langue),
            },
            {
              cle: "mode",
              entete: t("Déclenchement", "Triggered"),
              rendu: (r) =>
                r.mode === "automatique" ? t("Automatique", "Automatic") : t("Manuelle", "Manual"),
            },
            {
              cle: "retard",
              entete: t("Retard", "Delay"),
              alignement: "droite",
              rendu: (r) => String(r.jours_retard) + "\u00a0" + t("j", "d"),
            },
            {
              cle: "email",
              entete: t("E-mail au client", "Email to client"),
              rendu: (r) =>
                r.email_envoye ? (
                  <BadgeStatut tonalite="succes">{t("Envoyé", "Sent")}</BadgeStatut>
                ) : r.email_prepare ? (
                  <BadgeStatut tonalite="neutre">
                    {t("Préparé, non envoyé", "Prepared, not sent")}
                  </BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="neutre">{t("Aucun", "None")}</BadgeStatut>
                ),
            },
            {
              cle: "cree",
              entete: t("Enregistrée le", "Recorded on"),
              rendu: (r) => formaterDateHeure(r.cree_le, undefined, langue),
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
