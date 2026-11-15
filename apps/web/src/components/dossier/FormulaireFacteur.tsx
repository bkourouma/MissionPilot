"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { api } from "../../lib/api";
import {
  cheminApiDossier,
  facteursConvention,
  optionsFiabilite,
  optionsSources,
  validerFacteur,
  type ChampFacteur,
  type SaisieFacteur,
} from "../../lib/dossier";

const VIDE: SaisieFacteur = {
  code: "fiabilite_comptes",
  type: "enumeration",
  valeur: "",
  date_effet: "",
  source_type: "document",
  source_libelle: "",
  fiabilite: "B",
};

/**
 * Nouvelle valeur d'un facteur de contexte (STD-04), datée et sourcée. Les facteurs de
 * convention (fiabilité des comptes, part de l'informel) alimentent l'indice de fiabilité.
 */
export function FormulaireFacteur({ clientId }: { clientId: string }) {
  const t = useT();
  const langue = useLangue();
  const TYPES = [
    {
      valeur: "enumeration",
      libelle: t("Code (choix dans une liste)", "Code (choice from a list)"),
    },
    { valeur: "liste", libelle: t("Liste de codes", "List of codes") },
    { valeur: "nombre", libelle: t("Nombre", "Number") },
    { valeur: "booleen", libelle: t("Oui / non", "Yes / no") },
  ];
  const FACTEURS = facteursConvention(langue);
  const [s, setS] = useState<SaisieFacteur>(VIDE);
  const f = useFormulaire<ChampFacteur>();
  const maj = <K extends keyof SaisieFacteur>(k: K, v: SaisieFacteur[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  const convention = FACTEURS.find((c) => c.code === s.code);
  const autre = !convention;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerFacteur(s, langue),
      (charge) => api.post(`${cheminApiDossier(clientId)}/facteurs`, charge),
      {
        succes: t("Valeur du facteur enregistrée.", "Factor value saved."),
        apres: () => setS({ ...VIDE, code: s.code }),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Renseigner un facteur de contexte", "Set a context factor")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Facteur", "Factor")}
          options={[
            ...FACTEURS.map((c) => ({ valeur: c.code, libelle: c.libelle })),
            { valeur: "", libelle: t("Autre facteur…", "Other factor…") },
          ]}
          value={convention ? s.code : ""}
          onChange={(e) => setS({ ...s, code: e.target.value, valeur: "" })}
        />
        {autre ? (
          <>
            <Champ
              libelle={t("Code du facteur", "Factor code")}
              required
              maxLength={120}
              value={s.code}
              onChange={(e) => maj("code", e.target.value)}
              erreur={f.erreurs.code}
              aide={t(
                "Code du référentiel de méthodes, ex. secteur_filiere, effectif.",
                "Code from the method framework, e.g. secteur_filiere, effectif.",
              )}
              autoComplete="off"
            />
            <Select
              libelle={t("Type", "Type")}
              options={TYPES}
              value={s.type}
              onChange={(e) => maj("type", e.target.value as SaisieFacteur["type"])}
            />
          </>
        ) : null}
        {convention ? (
          <Select
            libelle={t("Valeur", "Value")}
            invite={t("Choisir…", "Choose…")}
            options={convention.valeurs}
            value={s.valeur}
            onChange={(e) => maj("valeur", e.target.value)}
            erreur={f.erreurs.valeur}
          />
        ) : s.type === "booleen" ? (
          <Select
            libelle={t("Valeur", "Value")}
            invite={t("Choisir…", "Choose…")}
            options={[
              { valeur: "oui", libelle: t("Oui", "Yes") },
              { valeur: "non", libelle: t("Non", "No") },
            ]}
            value={s.valeur}
            onChange={(e) => maj("valeur", e.target.value)}
            erreur={f.erreurs.valeur}
          />
        ) : (
          <Champ
            libelle={t("Valeur", "Value")}
            required
            value={s.valeur}
            onChange={(e) => maj("valeur", e.target.value)}
            erreur={f.erreurs.valeur}
            aide={
              s.type === "liste"
                ? t(
                    "Codes séparés par des virgules, ex. cacao, anacarde.",
                    "Codes separated by commas, e.g. cocoa, cashew.",
                  )
                : undefined
            }
            autoComplete="off"
          />
        )}
        <Champ
          libelle={t("Date d'effet", "Effective date")}
          type="date"
          required
          value={s.date_effet}
          onChange={(e) => maj("date_effet", e.target.value)}
          erreur={f.erreurs.date_effet}
        />
        <Select
          libelle={t("Type de source", "Source type")}
          options={optionsSources(langue)}
          value={s.source_type}
          onChange={(e) => maj("source_type", e.target.value as SaisieFacteur["source_type"])}
        />
        <Champ
          libelle={t("Source", "Source")}
          required
          maxLength={300}
          value={s.source_libelle}
          onChange={(e) => maj("source_libelle", e.target.value)}
          erreur={f.erreurs.source_libelle}
          aide={t(
            "Ex. « Rapport du commissaire aux comptes 2025 ».",
            'E.g. "2025 statutory auditor\'s report".',
          )}
        />
        <Select
          libelle={t("Fiabilité de la source", "Source reliability")}
          options={optionsFiabilite(langue)}
          value={s.fiabilite}
          onChange={(e) => maj("fiabilite", e.target.value as SaisieFacteur["fiabilite"])}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la valeur", "Save the value")}
        </Bouton>
      </div>
    </form>
  );
}
