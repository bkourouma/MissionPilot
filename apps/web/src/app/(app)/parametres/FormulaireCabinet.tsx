"use client";

import { useState, type FormEvent } from "react";
import { GroupeCases } from "../../../components/ui/CaseACocher";
import { Bouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select } from "../../../components/ui/Select";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { api } from "../../../lib/api";
import {
  JOURS_SEMAINE,
  OPTIONS_DEVISES,
  PAYS,
  saisieDepuisCabinet,
  UNITE_LIBELLES,
  validerCabinet,
  type Cabinet,
  type ChampCabinet,
  type SaisieCabinet,
} from "../../../lib/cabinet";

const OPTIONS_PAYS = PAYS.map((p) => ({ valeur: p.code, libelle: p.nom }));
const OPTIONS_UNITES = Object.entries(UNITE_LIBELLES).map(([valeur, libelle]) => ({
  valeur,
  libelle,
}));
const OPTIONS_JOURS = JOURS_SEMAINE.map((j) => ({ valeur: String(j.numero), libelle: j.nom }));

export function FormulaireCabinet({ cabinet }: { cabinet: Cabinet }) {
  const [saisie, setSaisie] = useState<SaisieCabinet>(() => saisieDepuisCabinet(cabinet));
  const f = useFormulaire<ChampCabinet>();
  const maj = <K extends keyof SaisieCabinet>(k: K, v: SaisieCabinet[K]) =>
    setSaisie((s) => ({ ...s, [k]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerCabinet(saisie), (charge) => api.patch("/api/cabinet", charge), {
      succes: "Paramètres du cabinet enregistrés.",
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Nom du cabinet"
          name="nom"
          required
          maxLength={200}
          value={saisie.nom}
          onChange={(e) => maj("nom", e.target.value)}
          erreur={f.erreurs.nom}
        />
        <Select
          libelle="Pays"
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
          libelle="Devise de base"
          name="devise_base"
          required
          options={OPTIONS_DEVISES}
          value={saisie.devise_base}
          onChange={(e) => maj("devise_base", e.target.value)}
          erreur={f.erreurs.devise_base}
          aide="Devise des budgets et des factures, sauf indication contraire."
        />
        <Select
          libelle="Unité de saisie des temps"
          name="unite_saisie_temps"
          required
          options={OPTIONS_UNITES}
          value={saisie.unite_saisie_temps}
          onChange={(e) => maj("unite_saisie_temps", e.target.value)}
          erreur={f.erreurs.unite_saisie_temps}
          aide="Pas de saisie dans la feuille de temps."
        />
        <Champ
          libelle="Heures par jour"
          name="heures_par_jour"
          required
          inputMode="decimal"
          value={saisie.heures_par_jour}
          onChange={(e) => maj("heures_par_jour", e.target.value)}
          erreur={f.erreurs.heures_par_jour}
          aide="Durée d'une journée de travail, ex. 8 ou 7,5."
        />
      </div>
      <GroupeCases
        legende="Jours travaillés"
        nom="jours_travailles"
        requis
        disposition="ligne"
        options={OPTIONS_JOURS}
        valeurs={saisie.jours_travailles.map(String)}
        onChange={(v) => maj("jours_travailles", v.map(Number))}
        erreur={f.erreurs.jours_travailles}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}
