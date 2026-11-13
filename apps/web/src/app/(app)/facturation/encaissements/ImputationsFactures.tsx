"use client";

import { useId } from "react";
import { BadgePaiement } from "../../../../components/finance/BadgePaiement";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Icone } from "../../../../components/ui/Icone";
import { Squelette } from "../../../../components/ui/Squelette";
import type { Creance } from "../../../../lib/encaissements";
import {
  formaterDate,
  formaterMontantMineur,
  type Devise,
  libelleDevise,
} from "../../../../lib/format";
import { montantVersSaisie } from "../../../../lib/saisie";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";

/**
 * Imputation d'un encaissement sur une ou plusieurs factures du client : un montant par
 * facture (paiement partiel possible), au plus son reste à payer (servi par l'API).
 */
export function ImputationsFactures({
  clientChoisi,
  creances,
  chargement,
  erreurChargement,
  devise,
  valeurs,
  onChange,
  erreur,
}: {
  clientChoisi: boolean;
  creances: readonly Creance[];
  chargement: boolean;
  erreurChargement: string | null;
  devise: Devise;
  valeurs: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  erreur?: string;
}) {
  const t = useT();
  const langue = useLangue();
  const id = useId();
  const idErreur = erreur ? `${id}-erreur` : undefined;
  return (
    <fieldset
      className={erreur ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}
      aria-describedby={idErreur}
      aria-invalid={erreur ? true : undefined}
    >
      <legend className="mp-champ__libelle">
        {t("Imputation sur les factures", "Allocation to invoices")}
      </legend>
      {!clientChoisi ? (
        <p className="mp-champ__aide">
          {t(
            "Choisissez le client pour voir ses factures restant dues.",
            "Choose the client to see its invoices still due.",
          )}
        </p>
      ) : chargement ? (
        <Squelette
          lignes={2}
          libelle={t("Chargement des factures restant dues…", "Loading invoices still due…")}
        />
      ) : erreurChargement ? (
        <p className="mp-champ__erreur" role="alert">
          <Icone nom="attention" taille={16} />
          <span>
            {t(
              `Factures indisponibles : ${erreurChargement}`,
              `Invoices unavailable: ${erreurChargement}`,
            )}
          </span>
        </p>
      ) : creances.length === 0 ? (
        <p className="mp-champ__aide">
          {t(
            "Aucune facture émise restant due pour ce client : l'encaissement ne peut être enregistré qu'en avance (case ci-dessous).",
            "No issued invoice is still due for this client: the payment can only be recorded as an advance (box below).",
          )}
        </p>
      ) : (
        <ul className="mp-imputations">
          {creances.map((c) => {
            const autreDevise = c.devise !== devise;
            return (
              <li key={c.facture_id} className="mp-imputations__ligne">
                <div className="mp-imputations__facture">
                  <p className="mp-imputations__titre">
                    <strong>
                      {c.numero
                        ? t(`Facture ${c.numero}`, `Invoice ${c.numero}`)
                        : t("Facture", "Invoice")}
                    </strong>{" "}
                    <BadgePaiement statut={c.statut_paiement} joursRetard={c.jours_retard} />
                  </p>
                  <p className="mp-texte-doux mp-texte-petit">
                    {t(
                      `Échéance ${formaterDate(c.date_echeance)} · reste à payer `,
                      `Due ${formaterDate(c.date_echeance, "UTC", langue)} · balance due `,
                    )}
                    <span className="mp-montant">
                      {formaterMontantMineur(c.solde, c.devise, langue)}
                    </span>
                  </p>
                  {autreDevise ? (
                    <p className="mp-texte-doux mp-texte-petit">
                      {t(
                        `Facture en ${libelleDevise(c.devise)} : choisissez cette devise pour l'imputer.`,
                        `Invoice in ${libelleDevise(c.devise)}: choose this currency to allocate to it.`,
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="mp-imputations__saisie">
                  <Champ
                    libelle={t(
                      `Montant imputé${c.numero ? ` sur ${c.numero}` : ""}`,
                      `Amount allocated${c.numero ? ` to ${c.numero}` : ""}`,
                    )}
                    inputMode="decimal"
                    disabled={autreDevise}
                    value={valeurs[c.facture_id] ?? ""}
                    onChange={(e) => onChange({ ...valeurs, [c.facture_id]: e.target.value })}
                  />
                  {!autreDevise ? (
                    <Bouton
                      variante="discret"
                      onClick={() =>
                        onChange({
                          ...valeurs,
                          [c.facture_id]: montantVersSaisie(c.solde, c.devise),
                        })
                      }
                      aria-label={t(
                        `Imputer tout le reste à payer${c.numero ? ` de ${c.numero}` : ""}`,
                        `Allocate the entire balance due${c.numero ? ` of ${c.numero}` : ""}`,
                      )}
                    >
                      {t("Tout le reste", "Full balance")}
                    </Bouton>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {erreur ? (
        <p className="mp-champ__erreur" id={idErreur}>
          <Icone nom="attention" taille={16} />
          <span>{erreur}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
