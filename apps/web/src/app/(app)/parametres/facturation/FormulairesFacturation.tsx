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
  OPTIONS_BASES_RETENUE,
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
  max: number;
  aide?: string;
}[] = [
  { champ: "raison_sociale", libelle: "Raison sociale", max: 200, aide: "Vide : nom du cabinet." },
  { champ: "forme_juridique", libelle: "Forme juridique", max: 80 },
  { champ: "rccm", libelle: "Numéro RCCM", max: 80 },
  { champ: "compte_contribuable", libelle: "Compte contribuable", max: 80 },
  { champ: "regime_fiscal", libelle: "Régime fiscal", max: 120 },
  { champ: "telephone", libelle: "Téléphone", max: 40 },
  { champ: "email", libelle: "E-mail de facturation", max: 254 },
  { champ: "banque", libelle: "Banque", max: 120 },
];

/** Mentions légales, coordonnées de paiement et numérotation (« cabinet.gerer »). */
export function FormulaireIdentite({
  parametres,
  annee,
}: {
  parametres: ParametresFacturation;
  annee: number;
}) {
  const [s, setS] = useState<SaisieIdentite>(() => saisieIdentite(parametres));
  // Demandée par l'API pour modifier les coordonnées bancaires (IBAN, banque, autres).
  const [confirmation, setConfirmation] = useState<SaisieConfirmation | null>(null);
  const f = useFormulaire<ChampIdentite | ChampConfirmation>();
  const maj = (champ: keyof SaisieIdentite) => (v: string) => setS((x) => ({ ...x, [champ]: v }));
  const chiffres = lireNombre(s.chiffres_numero);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await f.envoyer(
      avecReconfirmation(validerIdentite(s), confirmation),
      (c) => api.patch("/api/parametres-facturation", c, { redirigerSi401: false }),
      {
        succes: "Mentions et coordonnées enregistrées.",
        messageSpecifique: (e) => {
          if (confirmationDemandee(e)) setConfirmation((c) => c ?? SAISIE_CONFIRMATION_VIDE);
          return messageReconfirmation(e, confirmation?.facteur ?? "totp");
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
            libelle={l.libelle}
            aide={l.aide}
            maxLength={l.max}
            type={l.champ === "email" ? "email" : l.champ === "telephone" ? "tel" : "text"}
            value={s[l.champ]}
            onChange={(e) => maj(l.champ)(e.target.value)}
            erreur={f.erreurs[l.champ]}
          />
        ))}
        <Champ
          libelle="IBAN"
          aide="Espaces acceptés. Un IBAN modifié change le compte où vos clients paient : vérifiez-le."
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={50}
          value={s.iban}
          onChange={(e) => maj("iban")(e.target.value)}
          erreur={f.erreurs.iban}
        />
      </div>
      <ZoneTexte
        libelle="Adresse"
        maxLength={500}
        value={s.adresse}
        onChange={(e) => maj("adresse")(e.target.value)}
        erreur={f.erreurs.adresse}
      />
      <ZoneTexte
        libelle="Autres coordonnées de paiement"
        aide="Mobile Money, chèque à l'ordre de…"
        maxLength={500}
        value={s.autres_coordonnees}
        onChange={(e) => maj("autres_coordonnees")(e.target.value)}
        erreur={f.erreurs.autres_coordonnees}
      />
      <ZoneTexte
        libelle="Mentions complémentaires"
        aide="Pénalités de retard, conditions particulières…"
        maxLength={1000}
        value={s.mentions_complementaires}
        onChange={(e) => maj("mentions_complementaires")(e.target.value)}
        erreur={f.erreurs.mentions_complementaires}
      />
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Numérotation continue</legend>
        <p className="mp-champ__aide">
          {`Format : ${apercuNumero(s.prefixe_facture.trim().toUpperCase() || "FA", chiffres && Number.isInteger(chiffres) ? chiffres : 5, annee)}. Le numéro définitif est attribué à l'émission, sans trou.`}
        </p>
        <div className="mp-grille-champs mp-grille-champs--serree">
          <Champ
            libelle="Préfixe des factures"
            required
            maxLength={10}
            autoCapitalize="characters"
            value={s.prefixe_facture}
            onChange={(e) => maj("prefixe_facture")(e.target.value)}
            erreur={f.erreurs.prefixe_facture}
          />
          <Champ
            libelle="Préfixe des avoirs"
            required
            maxLength={10}
            autoCapitalize="characters"
            value={s.prefixe_avoir}
            onChange={(e) => maj("prefixe_avoir")(e.target.value)}
            erreur={f.erreurs.prefixe_avoir}
          />
          <Champ
            libelle="Chiffres du compteur"
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
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer les mentions
        </Bouton>
      </div>
    </form>
  );
}

/** TVA, retenue, délai et validation des valeurs de départ (« facture.emettre »). */
export function FormulaireOperationnel({ parametres }: { parametres: ParametresFacturation }) {
  const [s, setS] = useState<SaisieOperationnelle>(() => saisieOperationnelle(parametres));
  const f = useFormulaire<ChampOperationnel>();
  const maj = <K extends keyof SaisieOperationnelle>(champ: K, v: SaisieOperationnelle[K]) =>
    setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerOperationnel(s), (c) => api.patch("/api/parametres-facturation", c), {
      succes: "TVA, retenue et délai enregistrés.",
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Taux de TVA autorisés (%)"
          aide="Séparés par « ; », ex. 0 ; 18"
          required
          value={s.taux_tva_autorises}
          onChange={(e) => maj("taux_tva_autorises", e.target.value)}
          erreur={f.erreurs.taux_tva_autorises}
        />
        <Champ
          libelle="TVA par défaut des honoraires (%)"
          required
          inputMode="decimal"
          value={s.taux_tva_defaut}
          onChange={(e) => maj("taux_tva_defaut", e.target.value)}
          erreur={f.erreurs.taux_tva_defaut}
        />
        <Champ
          libelle="TVA des débours refacturés (%)"
          aide="Souvent 0 : débours hors champ de la TVA."
          required
          inputMode="decimal"
          value={s.taux_tva_debours}
          onChange={(e) => maj("taux_tva_debours", e.target.value)}
          erreur={f.erreurs.taux_tva_debours}
        />
        <Champ
          libelle="Délai de paiement (jours)"
          required
          inputMode="numeric"
          value={s.delai_paiement_jours}
          onChange={(e) => maj("delai_paiement_jours", e.target.value)}
          erreur={f.erreurs.delai_paiement_jours}
        />
      </div>
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Retenue à la source</legend>
        <CaseACocher
          libelle="Appliquer une retenue sur les nouvelles factures"
          checked={s.retenue_active}
          onChange={(e) => maj("retenue_active", e.target.checked)}
        />
        <div className="mp-grille-champs">
          <Champ
            libelle="Libellé"
            required
            maxLength={120}
            value={s.retenue_libelle}
            onChange={(e) => maj("retenue_libelle", e.target.value)}
            erreur={f.erreurs.retenue_libelle}
          />
          <Champ
            libelle="Taux (%)"
            required
            inputMode="decimal"
            value={s.retenue_taux}
            onChange={(e) => maj("retenue_taux", e.target.value)}
            erreur={f.erreurs.retenue_taux}
          />
          <Select
            libelle="Assiette"
            options={OPTIONS_BASES_RETENUE}
            value={s.retenue_base}
            onChange={(e) => maj("retenue_base", e.target.value)}
            erreur={f.erreurs.retenue_base}
          />
        </div>
      </fieldset>
      <CaseACocher
        libelle="Valeurs validées par le métier"
        aide="À cocher une fois les taux vérifiés par votre expert-comptable."
        checked={s.valeurs_validees}
        onChange={(e) => maj("valeurs_validees", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}
