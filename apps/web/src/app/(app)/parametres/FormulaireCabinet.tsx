"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { GroupeCases } from "../../../components/ui/CaseACocher";
import { Bouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select } from "../../../components/ui/Select";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { api } from "../../../lib/api";
import { messageSpecifiqueLangue } from "../../../lib/double-authentification";
import {
  optionsDevises,
  optionsJours,
  optionsPays,
  optionsUnites,
  saisieDepuisCabinet,
  validerCabinet,
  type Cabinet,
  type ChampCabinet,
  type SaisieCabinet,
} from "../../../lib/cabinet";

export function FormulaireCabinet({ cabinet }: { cabinet: Cabinet }) {
  const t = useT();
  const langue = useLangue();
  const OPTIONS_PAYS = optionsPays(langue);
  const OPTIONS_UNITES = optionsUnites(langue);
  const OPTIONS_JOURS = optionsJours(langue);
  const [saisie, setSaisie] = useState<SaisieCabinet>(() => saisieDepuisCabinet(cabinet));
  const f = useFormulaire<ChampCabinet>();
  const maj = <K extends keyof SaisieCabinet>(k: K, v: SaisieCabinet[K]) =>
    setSaisie((s) => ({ ...s, [k]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerCabinet(saisie, langue), (charge) => api.patch("/api/cabinet", charge), {
      succes: t("Paramètres du cabinet enregistrés.", "Firm settings saved."),
      messageSpecifique: messageSpecifiqueLangue(langue),
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Nom du cabinet", "Firm name")}
          name="nom"
          required
          maxLength={200}
          value={saisie.nom}
          onChange={(e) => maj("nom", e.target.value)}
          erreur={f.erreurs.nom}
        />
        <Select
          libelle={t("Pays", "Country")}
          name="pays"
          required
          options={
            OPTIONS_PAYS.some((o) => o.valeur === saisie.pays)
              ? OPTIONS_PAYS
              : [{ valeur: saisie.pays, libelle: saisie.pays }, ...OPTIONS_PAYS]
          }
          value={saisie.pays}
          onChange={(e) => maj("pays", e.target.value)}
          erreur={f.erreurs.pays}
        />
        <Select
          libelle={t("Devise de base", "Base currency")}
          name="devise_base"
          required
          options={optionsDevises(langue)}
          value={saisie.devise_base}
          onChange={(e) => maj("devise_base", e.target.value)}
          erreur={f.erreurs.devise_base}
          aide={t(
            "Devise des budgets et des factures, sauf indication contraire.",
            "Currency of budgets and invoices, unless stated otherwise.",
          )}
        />
        <Select
          libelle={t("Unité de saisie des temps", "Time entry unit")}
          name="unite_saisie_temps"
          required
          options={OPTIONS_UNITES}
          value={saisie.unite_saisie_temps}
          onChange={(e) => maj("unite_saisie_temps", e.target.value)}
          erreur={f.erreurs.unite_saisie_temps}
          aide={t("Pas de saisie dans la feuille de temps.", "Entry step in the timesheet.")}
        />
        <Champ
          libelle={t("Heures par jour", "Hours per day")}
          name="heures_par_jour"
          required
          inputMode="decimal"
          value={saisie.heures_par_jour}
          onChange={(e) => maj("heures_par_jour", e.target.value)}
          erreur={f.erreurs.heures_par_jour}
          aide={t(
            "Durée d'une journée de travail, ex. 8 ou 7,5.",
            "Length of a working day, e.g. 8 or 7.5.",
          )}
        />
      </div>
      <GroupeCases
        legende={t("Jours travaillés", "Working days")}
        nom="jours_travailles"
        requis
        disposition="ligne"
        options={OPTIONS_JOURS}
        valeurs={saisie.jours_travailles.map(String)}
        onChange={(v) => maj("jours_travailles", v.map(Number))}
        erreur={f.erreurs.jours_travailles}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
      </div>
    </form>
  );
}
