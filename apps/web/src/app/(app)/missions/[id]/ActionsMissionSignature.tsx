"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import { libelleDevise, type Devise } from "../../../../lib/format";
import {
  aujourdhuiIso,
  deviseFlottante,
  validerSignature,
  type ChargeSignature,
  type NatureSupplementaire,
  type SaisieSignature,
} from "../../../../lib/missions";
import { aideMontant } from "../../../../lib/saisie";

/**
 * Signature de la lettre de mission (MIS-07) en deux temps : la saisie est validée, puis un
 * rappel explicite que le budget initial sera FIGÉ demande une confirmation.
 */
export function Signature({
  missionId,
  devise,
  natures,
  peutSaisirTaux,
  onSignee,
}: {
  missionId: string;
  devise: Devise;
  natures: NatureSupplementaire[];
  peutSaisirTaux: boolean;
  onSignee: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieSignature>({
    date_signature: aujourdhuiIso(),
    taux_change: "",
    lignes: [],
  });
  const [aConfirmer, setAConfirmer] = useState<ChargeSignature | null>(null);
  const [erreursLocales, setErreursLocales] = useState<Partial<Record<string, string>>>({});
  const f = useFormulaire<string>();
  const refConfirmer = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (aConfirmer) refConfirmer.current?.focus();
  }, [aConfirmer]);

  function preparer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerSignature(s, devise, natures, langue);
    if (!v.ok) {
      setErreursLocales(v.erreurs);
      return;
    }
    setErreursLocales({});
    setAConfirmer(v.charge);
  }

  async function signer() {
    if (!aConfirmer) return;
    const ok = await f.envoyer(
      { ok: true, charge: aConfirmer },
      (c) => api.post(`/api/missions/${encodeURIComponent(missionId)}/signer`, c),
      { apres: onSignee },
    );
    if (!ok) setAConfirmer(null);
  }

  const majLigne = (i: number, champ: string, v: string | boolean) =>
    setS((x) => ({
      ...x,
      lignes: x.lignes.map((l, k) => (k === i ? { ...l, [champ]: v } : l)),
    }));
  const erreurs = { ...erreursLocales, ...f.erreurs };

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="signature" onClick={() => setOuvert(true)}>
          {t("Signer la lettre de mission", "Sign the engagement letter")}
        </Bouton>
      </div>
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={preparer}
      aria-label={t("Signer la lettre de mission", "Sign the engagement letter")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Signature de la lettre de mission", "Signing the engagement letter")}
      </p>
      <Alerte
        tonalite="attention"
        titre={t("Le budget initial sera figé", "The initial budget will be locked")}
        annonce="aucune"
      >
        <p>
          {t(
            "À la signature, le budget est calculé depuis les jours budgétés du découpage, puis ",
            "On signing, the budget is computed from the days budgeted in the work breakdown, then ",
          )}
          <strong>{t("figé", "locked")}</strong>
          {t(
            " : il ne pourra plus être modifié. Toute évolution passera par une révision motivée, validée par le directeur de mission.",
            ": it can no longer be modified. Any change will go through a justified revision, approved by the engagement director.",
          )}
        </p>
      </Alerte>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Signature impossible", "Signing not possible")}
      />
      {deviseFlottante(devise) && !peutSaisirTaux ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              `Le taux de change ${libelleDevise(devise)} est saisi par un associé ou un gestionnaire : demandez-lui de signer.`,
              `The ${libelleDevise(devise)} exchange rate is entered by a partner or a manager: ask them to sign.`,
            )}
          </p>
        </Alerte>
      ) : !deviseFlottante(devise) ? (
        <p className="mp-texte-doux">
          {devise === "EUR"
            ? t(
                "Parité légale euro / franc CFA (655,957) appliquée automatiquement.",
                "Legal euro / CFA franc parity (655.957) applied automatically.",
              )
            : t(
                "Taux de change appliqué automatiquement (parité fixe).",
                "Exchange rate applied automatically (fixed parity).",
              )}
        </p>
      ) : null}
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Champ
          libelle={t("Date de signature", "Signature date")}
          name="date_signature"
          type="date"
          required
          value={s.date_signature}
          onChange={(e) => setS((x) => ({ ...x, date_signature: e.target.value }))}
          erreur={erreurs.date_signature}
        />
        {deviseFlottante(devise) && peutSaisirTaux ? (
          <Champ
            libelle={t(
              `Taux de change : 1 ${libelleDevise(devise)} = … (devise du cabinet)`,
              `Exchange rate: 1 ${libelleDevise(devise)} = … (firm currency)`,
            )}
            name="taux_change"
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.taux_change}
            onChange={(e) => setS((x) => ({ ...x, taux_change: e.target.value }))}
            erreur={erreurs.taux_change}
            aide={t(
              "Figé à la signature pour toute la mission.",
              "Locked at signing for the whole engagement.",
            )}
          />
        ) : null}
      </div>
      {natures.length > 0 ? (
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">
            {t("Lignes supplémentaires (facultatives)", "Additional lines (optional)")}
          </legend>
          <p className="mp-champ__aide">
            {t(
              `Débours${natures.includes("sous_traitance") ? " ou sous-traitance" : ""} prévus, au forfait. ${aideMontant(devise)}`,
              `Planned expenses${natures.includes("sous_traitance") ? " or subcontracting" : ""}, as a lump sum. ${aideMontant(devise, "en")}`,
            )}
          </p>
          {s.lignes.map((l, i) => (
            <div key={i} className="mp-ligne-saisie">
              <Select
                libelle={t(`Nature (ligne ${i + 1})`, `Type (line ${i + 1})`)}
                options={natures.map((n) => ({
                  valeur: n,
                  libelle:
                    n === "debours"
                      ? t("Débours", "Expenses")
                      : t("Sous-traitance", "Subcontracting"),
                }))}
                value={l.nature}
                onChange={(e) => majLigne(i, "nature", e.target.value)}
                erreur={erreurs[`lignes.${i}.nature`]}
              />
              <Champ
                libelle={t(`Libellé (ligne ${i + 1})`, `Label (line ${i + 1})`)}
                maxLength={200}
                value={l.libelle}
                onChange={(e) => majLigne(i, "libelle", e.target.value)}
                erreur={erreurs[`lignes.${i}.libelle`]}
              />
              <Champ
                libelle={t(
                  `Montant en ${libelleDevise(devise)} (ligne ${i + 1})`,
                  `Amount in ${libelleDevise(devise)} (line ${i + 1})`,
                )}
                inputMode="decimal"
                autoComplete="off"
                value={l.montant}
                onChange={(e) => majLigne(i, "montant", e.target.value)}
                erreur={erreurs[`lignes.${i}.montant`]}
              />
              {l.nature === "debours" ? (
                <CaseACocher
                  libelle={t("Refacturable au client", "Rebillable to the client")}
                  checked={l.refacturable}
                  onChange={(e) => majLigne(i, "refacturable", e.target.checked)}
                />
              ) : null}
              <div>
                <Bouton
                  variante="discret"
                  icone="corbeille"
                  onClick={() =>
                    setS((x) => ({ ...x, lignes: x.lignes.filter((_, k) => k !== i) }))
                  }
                >
                  {t(`Retirer la ligne ${i + 1}`, `Remove line ${i + 1}`)}
                </Bouton>
              </div>
            </div>
          ))}
          <div>
            <Bouton
              variante="secondaire"
              icone="plus"
              disabled={s.lignes.length >= 50}
              onClick={() =>
                setS((x) => ({
                  ...x,
                  lignes: [
                    ...x.lignes,
                    {
                      nature: natures[0] as NatureSupplementaire,
                      libelle: "",
                      montant: "",
                      refacturable: false,
                    },
                  ],
                }))
              }
            >
              {t("Ajouter une ligne", "Add a line")}
            </Bouton>
          </div>
        </fieldset>
      ) : null}

      {aConfirmer ? (
        <div
          className="mp-confirmation"
          role="group"
          aria-label={t("Confirmer la signature", "Confirm the signature")}
        >
          <p className="mp-confirmation__question">
            {t(
              "Confirmer la signature ? Le budget initial sera FIGÉ et ne pourra plus être modifié.",
              "Confirm the signature? The initial budget will be LOCKED and can no longer be modified.",
            )}
          </p>
          <div className="mp-confirmation__boutons">
            <Bouton
              ref={refConfirmer}
              variante="danger"
              icone="cadenas"
              chargement={f.enCours}
              texteChargement={t("Signature…", "Signing…")}
              onClick={signer}
            >
              {t("Oui, signer et figer le budget", "Yes, sign and lock the budget")}
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setAConfirmer(null)}>
              {t("Revenir à la saisie", "Back to editing")}
            </Bouton>
          </div>
        </div>
      ) : (
        <div className="mp-actions-formulaire">
          <Bouton type="submit" icone="signature">
            {t("Continuer vers la confirmation", "Continue to confirmation")}
          </Bouton>
          <Bouton variante="discret" onClick={() => setOuvert(false)}>
            {t("Annuler", "Cancel")}
          </Bouton>
        </div>
      )}
    </form>
  );
}
