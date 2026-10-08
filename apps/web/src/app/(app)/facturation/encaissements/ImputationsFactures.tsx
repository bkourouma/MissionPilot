"use client";

import { useId } from "react";
import { BadgePaiement } from "../../../../components/finance/BadgePaiement";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Icone } from "../../../../components/ui/Icone";
import { Squelette } from "../../../../components/ui/Squelette";
import type { Creance } from "../../../../lib/encaissements";
import { formaterDate, formaterMontantMineur, type Devise } from "../../../../lib/format";
import { montantVersSaisie } from "../../../../lib/saisie";

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
  const id = useId();
  const idErreur = erreur ? `${id}-erreur` : undefined;
  return (
    <fieldset
      className={erreur ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}
      aria-describedby={idErreur}
      aria-invalid={erreur ? true : undefined}
    >
      <legend className="mp-champ__libelle">Imputation sur les factures</legend>
      {!clientChoisi ? (
        <p className="mp-champ__aide">Choisissez le client pour voir ses factures restant dues.</p>
      ) : chargement ? (
        <Squelette lignes={2} libelle="Chargement des factures restant dues…" />
      ) : erreurChargement ? (
        <p className="mp-champ__erreur" role="alert">
          <Icone nom="attention" taille={16} />
          <span>{`Factures indisponibles : ${erreurChargement}`}</span>
        </p>
      ) : creances.length === 0 ? (
        <p className="mp-champ__aide">
          Aucune facture émise restant due pour ce client : l&apos;encaissement ne peut être
          enregistré qu&apos;en avance (case ci-dessous).
        </p>
      ) : (
        <ul className="mp-imputations">
          {creances.map((c) => {
            const autreDevise = c.devise !== devise;
            return (
              <li key={c.facture_id} className="mp-imputations__ligne">
                <div className="mp-imputations__facture">
                  <p className="mp-imputations__titre">
                    <strong>{c.numero ? `Facture ${c.numero}` : "Facture"}</strong>{" "}
                    <BadgePaiement statut={c.statut_paiement} joursRetard={c.jours_retard} />
                  </p>
                  <p className="mp-texte-doux mp-texte-petit">
                    {`Échéance ${formaterDate(c.date_echeance)} · reste à payer `}
                    <span className="mp-montant">{formaterMontantMineur(c.solde, c.devise)}</span>
                  </p>
                  {autreDevise ? (
                    <p className="mp-texte-doux mp-texte-petit">
                      {`Facture en ${c.devise} : choisissez cette devise pour l'imputer.`}
                    </p>
                  ) : null}
                </div>
                <div className="mp-imputations__saisie">
                  <Champ
                    libelle={`Montant imputé${c.numero ? ` sur ${c.numero}` : ""}`}
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
                      aria-label={`Imputer tout le reste à payer${c.numero ? ` de ${c.numero}` : ""}`}
                    >
                      Tout le reste
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
