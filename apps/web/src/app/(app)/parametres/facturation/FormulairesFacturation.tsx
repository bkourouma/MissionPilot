"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import {
  avecReconfirmation,
  confirmationDemandee,
  messageReconfirmation,
  SAISIE_CONFIRMATION_VIDE,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "../../../../lib/double-authentification";
import { lireNombre } from "../../../../lib/saisie";
import {
  apercuNumero,
  autresCoordonneesMasqueesRecues,
  ibanMasqueRecu,
  optionsBasesRetenue,
  saisieIdentite,
  saisieOperationnelle,
  validerIdentite,
  validerOperationnel,
  type ChampIdentite,
  type ChampOperationnel,
  type ParametresFacturation,
  type SaisieIdentite,
  type SaisieOperationnelle,
} from "../../../../lib/parametres-facturation";

const LIGNES_IDENTITE: {
  champ: keyof SaisieIdentite;
  libelle: string;
  libelleEn: string;
  max: number;
  aide?: string;
  aideEn?: string;
}[] = [
  {
    champ: "raison_sociale",
    libelle: "Raison sociale",
    libelleEn: "Company name",
    max: 200,
    aide: "Vide : nom du cabinet.",
    aideEn: "Empty: the firm's name.",
  },
  { champ: "forme_juridique", libelle: "Forme juridique", libelleEn: "Legal form", max: 80 },
  { champ: "rccm", libelle: "Numéro RCCM", libelleEn: "RCCM number", max: 80 },
  {
    champ: "compte_contribuable",
    libelle: "Compte contribuable",
    libelleEn: "Taxpayer account number",
    max: 80,
  },
  { champ: "regime_fiscal", libelle: "Régime fiscal", libelleEn: "Tax regime", max: 120 },
  { champ: "telephone", libelle: "Téléphone", libelleEn: "Phone", max: 40 },
  { champ: "email", libelle: "E-mail de facturation", libelleEn: "Billing email", max: 254 },
  { champ: "banque", libelle: "Banque", libelleEn: "Bank", max: 120 },
];

/** Mentions légales, coordonnées de paiement et numérotation (« cabinet.gerer »). */
export function FormulaireIdentite({
  parametres,
  annee,
}: {
  parametres: ParametresFacturation;
  annee: number;
}) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieIdentite>(() => saisieIdentite(parametres));
  // Demandée par l'API pour modifier les coordonnées bancaires (IBAN, banque, autres).
  const [confirmation, setConfirmation] = useState<SaisieConfirmation | null>(null);
  const f = useFormulaire<ChampIdentite | ChampConfirmation>();
  const maj = (champ: keyof SaisieIdentite) => (v: string) => setS((x) => ({ ...x, [champ]: v }));
  const chiffres = lireNombre(s.chiffres_numero);
  // Valeurs reçues masquées : jamais renvoyées telles quelles (validerIdentite les omet
  // si elles sont inchangées).
  const ibanMasque = ibanMasqueRecu(parametres);
  const autresMasquees = autresCoordonneesMasqueesRecues(parametres);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await f.envoyer(
      avecReconfirmation(validerIdentite(s, ibanMasque, autresMasquees, langue), confirmation),
      (c) => api.patch("/api/parametres-facturation", c, { redirigerSi401: false }),
      {
        succes: t("Mentions et coordonnées enregistrées.", "Legal mentions and details saved."),
        messageSpecifique: (e) => {
          if (confirmationDemandee(e)) setConfirmation((c) => c ?? SAISIE_CONFIRMATION_VIDE);
          return messageReconfirmation(e, confirmation?.facteur ?? "totp", langue);
        },
      },
    );
    if (ok) setConfirmation(null);
    else setConfirmation((c) => (c ? { ...c, motDePasse: "", code: "" } : c));
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        {LIGNES_IDENTITE.map((l) => (
          <Champ
            key={l.champ}
            libelle={t(l.libelle, l.libelleEn)}
            aide={l.aide ? t(l.aide, l.aideEn ?? l.aide) : undefined}
            maxLength={l.max}
            type={l.champ === "email" ? "email" : l.champ === "telephone" ? "tel" : "text"}
            value={s[l.champ]}
            onChange={(e) => maj(l.champ)(e.target.value)}
            erreur={f.erreurs[l.champ]}
          />
        ))}
        <Champ
          libelle="IBAN"
          aide={
            ibanMasque
              ? t(
                  "IBAN masqué : laissez-le tel quel pour le conserver, ou saisissez le nouvel IBAN complet. Un IBAN modifié change le compte où vos clients paient : vérifiez-le.",
                  "IBAN masked: leave it as is to keep it, or enter the new full IBAN. A changed IBAN changes the account your clients pay into: double-check it.",
                )
              : t(
                  "Espaces acceptés. Un IBAN modifié change le compte où vos clients paient : vérifiez-le.",
                  "Spaces accepted. A changed IBAN changes the account your clients pay into: double-check it.",
                )
          }
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={50}
          value={s.iban}
          onChange={(e) => maj("iban")(e.target.value)}
          erreur={f.erreurs.iban}
        />
      </div>
      <ZoneTexte
        libelle={t("Adresse", "Address")}
        maxLength={500}
        value={s.adresse}
        onChange={(e) => maj("adresse")(e.target.value)}
        erreur={f.erreurs.adresse}
      />
      <ZoneTexte
        libelle={t("Autres coordonnées de paiement", "Other payment details")}
        aide={
          autresMasquees
            ? t(
                "Coordonnées masquées : laissez-les telles quelles pour les conserver, ou saisissez les nouvelles coordonnées complètes.",
                "Details masked: leave them as they are to keep them, or enter the new full details.",
              )
            : t("Mobile Money, chèque à l'ordre de…", "Mobile Money, check payable to…")
        }
        maxLength={500}
        value={s.autres_coordonnees}
        onChange={(e) => maj("autres_coordonnees")(e.target.value)}
        erreur={f.erreurs.autres_coordonnees}
      />
      <ZoneTexte
        libelle={t("Mentions complémentaires", "Additional mentions")}
        aide={t(
          "Pénalités de retard, conditions particulières…",
          "Late payment penalties, special conditions…",
        )}
        maxLength={1000}
        value={s.mentions_complementaires}
        onChange={(e) => maj("mentions_complementaires")(e.target.value)}
        erreur={f.erreurs.mentions_complementaires}
      />
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">
          {t("Numérotation continue", "Continuous numbering")}
        </legend>
        <p className="mp-champ__aide">
          {t(
            `Format : ${apercuNumero(s.prefixe_facture.trim().toUpperCase() || "FA", chiffres && Number.isInteger(chiffres) ? chiffres : 5, annee)}. Le numéro définitif est attribué à l'émission, sans trou.`,
            `Format: ${apercuNumero(s.prefixe_facture.trim().toUpperCase() || "FA", chiffres && Number.isInteger(chiffres) ? chiffres : 5, annee)}. The final number is assigned at issuance, with no gaps.`,
          )}
        </p>
        <div className="mp-grille-champs mp-grille-champs--serree">
          <Champ
            libelle={t("Préfixe des factures", "Invoice prefix")}
            required
            maxLength={10}
            autoCapitalize="characters"
            value={s.prefixe_facture}
            onChange={(e) => maj("prefixe_facture")(e.target.value)}
            erreur={f.erreurs.prefixe_facture}
          />
          <Champ
            libelle={t("Préfixe des avoirs", "Credit note prefix")}
            required
            maxLength={10}
            autoCapitalize="characters"
            value={s.prefixe_avoir}
            onChange={(e) => maj("prefixe_avoir")(e.target.value)}
            erreur={f.erreurs.prefixe_avoir}
          />
          <Champ
            libelle={t("Chiffres du compteur", "Counter digits")}
            required
            inputMode="numeric"
            maxLength={1}
            value={s.chiffres_numero}
            onChange={(e) => maj("chiffres_numero")(e.target.value)}
            erreur={f.erreurs.chiffres_numero}
          />
        </div>
      </fieldset>
      {confirmation ? (
        <ChampsReconfirmation
          saisie={confirmation}
          onChange={setConfirmation}
          erreurs={f.erreurs}
          motif="modifier les coordonnées bancaires du cabinet"
          motifEn="change the firm's bank details"
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer les mentions", "Save the mentions")}
        </Bouton>
      </div>
    </form>
  );
}

/** TVA, retenue, délai et validation des valeurs de départ (« facture.emettre »). */
export function FormulaireOperationnel({ parametres }: { parametres: ParametresFacturation }) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieOperationnelle>(() => saisieOperationnelle(parametres));
  const f = useFormulaire<ChampOperationnel>();
  const maj = <K extends keyof SaisieOperationnelle>(champ: K, v: SaisieOperationnelle[K]) =>
    setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerOperationnel(s, langue),
      (c) => api.patch("/api/parametres-facturation", c),
      {
        succes: t("TVA, retenue et délai enregistrés.", "VAT, withholding and payment term saved."),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Taux de TVA autorisés (%)", "Allowed VAT rates (%)")}
          aide={t("Séparés par « ; », ex. 0 ; 18", 'Separated by ";", e.g. 0 ; 18')}
          required
          value={s.taux_tva_autorises}
          onChange={(e) => maj("taux_tva_autorises", e.target.value)}
          erreur={f.erreurs.taux_tva_autorises}
        />
        <Champ
          libelle={t("TVA par défaut des honoraires (%)", "Default VAT on fees (%)")}
          required
          inputMode="decimal"
          value={s.taux_tva_defaut}
          onChange={(e) => maj("taux_tva_defaut", e.target.value)}
          erreur={f.erreurs.taux_tva_defaut}
        />
        <Champ
          libelle={t("TVA des débours refacturés (%)", "VAT on re-billed expenses (%)")}
          aide={t(
            "Souvent 0 : débours hors champ de la TVA.",
            "Often 0: expenses outside the scope of VAT.",
          )}
          required
          inputMode="decimal"
          value={s.taux_tva_debours}
          onChange={(e) => maj("taux_tva_debours", e.target.value)}
          erreur={f.erreurs.taux_tva_debours}
        />
        <Champ
          libelle={t("Délai de paiement (jours)", "Payment term (days)")}
          required
          inputMode="numeric"
          value={s.delai_paiement_jours}
          onChange={(e) => maj("delai_paiement_jours", e.target.value)}
          erreur={f.erreurs.delai_paiement_jours}
        />
      </div>
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">{t("Retenue à la source", "Withholding tax")}</legend>
        <CaseACocher
          libelle={t(
            "Appliquer une retenue sur les nouvelles factures",
            "Apply a withholding on new invoices",
          )}
          checked={s.retenue_active}
          onChange={(e) => maj("retenue_active", e.target.checked)}
        />
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Libellé", "Label")}
            required
            maxLength={120}
            value={s.retenue_libelle}
            onChange={(e) => maj("retenue_libelle", e.target.value)}
            erreur={f.erreurs.retenue_libelle}
          />
          <Champ
            libelle={t("Taux (%)", "Rate (%)")}
            required
            inputMode="decimal"
            value={s.retenue_taux}
            onChange={(e) => maj("retenue_taux", e.target.value)}
            erreur={f.erreurs.retenue_taux}
          />
          <Select
            libelle={t("Assiette", "Base")}
            options={optionsBasesRetenue(langue)}
            value={s.retenue_base}
            onChange={(e) => maj("retenue_base", e.target.value)}
            erreur={f.erreurs.retenue_base}
          />
        </div>
      </fieldset>
      <CaseACocher
        libelle={t("Valeurs validées par le métier", "Values approved by the business")}
        aide={t(
          "À cocher une fois les taux vérifiés par votre expert-comptable.",
          "Tick once the rates have been checked by your chartered accountant.",
        )}
        checked={s.valeurs_validees}
        onChange={(e) => maj("valeurs_validees", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
      </div>
    </form>
  );
}
