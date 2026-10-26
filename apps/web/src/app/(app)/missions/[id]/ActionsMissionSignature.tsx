"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
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
    const v = validerSignature(s, devise, natures);
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
          Signer la lettre de mission
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
      aria-label="Signer la lettre de mission"
    >
      <p className="mp-sous-formulaire__titre">Signature de la lettre de mission</p>
      <Alerte tonalite="attention" titre="Le budget initial sera figé" annonce="aucune">
        <p>
          À la signature, le budget est calculé depuis les jours budgétés du découpage, puis{" "}
          <strong>figé</strong> : il ne pourra plus être modifié. Toute évolution passera par une
          révision motivée, validée par le directeur de mission.
        </p>
      </Alerte>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Signature impossible"
      />
      {deviseFlottante(devise) && !peutSaisirTaux ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {`Le taux de change ${libelleDevise(devise)} est saisi par un associé ou un gestionnaire : demandez-lui de signer.`}
          </p>
        </Alerte>
      ) : !deviseFlottante(devise) ? (
        <p className="mp-texte-doux">
          {devise === "EUR"
            ? "Parité légale euro / franc CFA (655,957) appliquée automatiquement."
            : "Taux de change appliqué automatiquement (parité fixe)."}
        </p>
      ) : null}
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Champ
          libelle="Date de signature"
          name="date_signature"
          type="date"
          required
          value={s.date_signature}
          onChange={(e) => setS((x) => ({ ...x, date_signature: e.target.value }))}
          erreur={erreurs.date_signature}
        />
        {deviseFlottante(devise) && peutSaisirTaux ? (
          <Champ
            libelle={`Taux de change : 1 ${libelleDevise(devise)} = … (devise du cabinet)`}
            name="taux_change"
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.taux_change}
            onChange={(e) => setS((x) => ({ ...x, taux_change: e.target.value }))}
            erreur={erreurs.taux_change}
            aide="Figé à la signature pour toute la mission."
          />
        ) : null}
      </div>
      {natures.length > 0 ? (
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">Lignes supplémentaires (facultatives)</legend>
          <p className="mp-champ__aide">{`Débours${natures.includes("sous_traitance") ? " ou sous-traitance" : ""} prévus, au forfait. ${aideMontant(devise)}`}</p>
          {s.lignes.map((l, i) => (
            <div key={i} className="mp-ligne-saisie">
              <Select
                libelle={`Nature (ligne ${i + 1})`}
                options={natures.map((n) => ({
                  valeur: n,
                  libelle: n === "debours" ? "Débours" : "Sous-traitance",
                }))}
                value={l.nature}
                onChange={(e) => majLigne(i, "nature", e.target.value)}
                erreur={erreurs[`lignes.${i}.nature`]}
              />
              <Champ
                libelle={`Libellé (ligne ${i + 1})`}
                maxLength={200}
                value={l.libelle}
                onChange={(e) => majLigne(i, "libelle", e.target.value)}
                erreur={erreurs[`lignes.${i}.libelle`]}
              />
              <Champ
                libelle={`Montant en ${libelleDevise(devise)} (ligne ${i + 1})`}
                inputMode="decimal"
                autoComplete="off"
                value={l.montant}
                onChange={(e) => majLigne(i, "montant", e.target.value)}
                erreur={erreurs[`lignes.${i}.montant`]}
              />
              {l.nature === "debours" ? (
                <CaseACocher
                  libelle="Refacturable au client"
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
                  {`Retirer la ligne ${i + 1}`}
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
              Ajouter une ligne
            </Bouton>
          </div>
        </fieldset>
      ) : null}

      {aConfirmer ? (
        <div className="mp-confirmation" role="group" aria-label="Confirmer la signature">
          <p className="mp-confirmation__question">
            Confirmer la signature ? Le budget initial sera FIGÉ et ne pourra plus être modifié.
          </p>
          <div className="mp-confirmation__boutons">
            <Bouton
              ref={refConfirmer}
              variante="danger"
              icone="cadenas"
              chargement={f.enCours}
              texteChargement="Signature…"
              onClick={signer}
            >
              Oui, signer et figer le budget
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setAConfirmer(null)}>
              Revenir à la saisie
            </Bouton>
          </div>
        </div>
      ) : (
        <div className="mp-actions-formulaire">
          <Bouton type="submit" icone="signature">
            Continuer vers la confirmation
          </Bouton>
          <Bouton variante="discret" onClick={() => setOuvert(false)}>
            Annuler
          </Bouton>
        </div>
      )}
    </form>
  );
}
