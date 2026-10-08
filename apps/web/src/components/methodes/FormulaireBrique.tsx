"use client";

import { useState, type FormEvent } from "react";
import {
  CLASSES_RISQUE,
  CODES_MOTEURS_STANDARD,
  MOTEURS_STANDARD,
  type ClasseRisque,
  type NiveauAutonomie,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  codeDepuisLibelle,
  libelleClasse,
  libelleNiveau,
  messageMethodes,
  niveauxAdmis,
  saisieBriqueVide,
  validerBrique,
  type ChampBrique,
  type EtapeVersion,
  type SaisieBrique,
} from "../../lib/methodes";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Ajout d'une brique (PRD §4.1) : objet, contrat d'entrée, moteur, agent autorisé, classe de
 * risque, sortie, définition de terminé, temps type, autonomie maximale. Les niveaux
 * d'autonomie proposés dépendent de la classe (N2 au plus pour un livrable client).
 */
export function FormulaireBrique({
  versionId,
  etapes,
}: {
  versionId: string;
  etapes: Pick<EtapeVersion, "id" | "libelle">[];
}) {
  const f = useFormulaire<ChampBrique>();
  const [s, setS] = useState<SaisieBrique>(saisieBriqueVide(etapes[0]?.id ?? ""));
  const maj = <K extends keyof SaisieBrique>(k: K, v: SaisieBrique[K]) =>
    setS((x) => ({ ...x, [k]: v }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerBrique(s),
      (charge) => api.post(`/api/methodes/versions/${versionId}/briques`, charge),
      { succes: "Brique ajoutée.", messageSpecifique: messageMethodes },
    );
    if (ok) setS(saisieBriqueVide(s.etape_id));
  }

  const changerClasse = (classe: ClasseRisque) => {
    const admis = niveauxAdmis(classe);
    setS((x) => ({
      ...x,
      classe_risque: classe,
      niveau_autonomie_max: admis.includes(x.niveau_autonomie_max)
        ? x.niveau_autonomie_max
        : admis[admis.length - 1]!,
    }));
  };

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Étape"
          required
          value={s.etape_id}
          onChange={(e) => maj("etape_id", e.target.value)}
          options={etapes.map((x) => ({ valeur: x.id, libelle: x.libelle }))}
          invite="Choisir l'étape…"
          erreur={f.erreurs.etape_id}
        />
        <Champ
          libelle="Libellé"
          required
          value={s.libelle}
          maxLength={200}
          onChange={(e) => {
            maj("libelle", e.target.value);
            maj("code", codeDepuisLibelle(e.target.value));
          }}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle="Code"
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => maj("code", e.target.value)}
          erreur={f.erreurs.code}
        />
      </div>
      <ZoneTexte
        libelle="Objet"
        required
        rows={2}
        maxLength={2000}
        value={s.objet}
        onChange={(e) => maj("objet", e.target.value)}
        erreur={f.erreurs.objet}
      />
      <div className="mp-grille-champs">
        <ZoneTexte
          libelle="Entrées (contrat de données)"
          rows={2}
          maxLength={2000}
          value={s.entrees}
          onChange={(e) => maj("entrees", e.target.value)}
        />
        <ZoneTexte
          libelle="Sortie"
          rows={2}
          maxLength={2000}
          value={s.sortie}
          onChange={(e) => maj("sortie", e.target.value)}
        />
        <ZoneTexte
          libelle="Définition de terminé"
          rows={2}
          maxLength={2000}
          value={s.definition_termine}
          onChange={(e) => maj("definition_termine", e.target.value)}
        />
      </div>
      <div className="mp-grille-champs">
        <Select
          libelle="Moteur de calcul"
          value={s.moteur}
          onChange={(e) => maj("moteur", e.target.value)}
          invite="Aucun (jugement de l'expert)"
          options={CODES_MOTEURS_STANDARD.map((c) => ({ valeur: c, libelle: MOTEURS_STANDARD[c] }))}
        />
        <Champ
          libelle="Agent IA autorisé (code)"
          value={s.agent}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => maj("agent", e.target.value)}
          aide="Code du registre des agents, ex. redacteur ; vide : aucun agent."
        />
        <Select
          libelle="Classe de risque"
          required
          value={s.classe_risque}
          onChange={(e) => changerClasse(e.target.value as ClasseRisque)}
          options={CLASSES_RISQUE.map((c) => ({ valeur: c, libelle: libelleClasse(c) }))}
        />
        <Select
          libelle="Autonomie de l'IA au plus"
          required
          value={s.niveau_autonomie_max}
          onChange={(e) => maj("niveau_autonomie_max", e.target.value as NiveauAutonomie)}
          options={niveauxAdmis(s.classe_risque).map((n) => ({
            valeur: n,
            libelle: libelleNiveau(n),
          }))}
          erreur={f.erreurs.niveau_autonomie_max}
        />
        <Champ
          libelle="Temps type (jours)"
          inputMode="decimal"
          value={s.temps_type_jours}
          onChange={(e) => maj("temps_type_jours", e.target.value)}
          erreur={f.erreurs.temps_type_jours}
          aide="Par quart de jour, ex. 0,5."
        />
        <Champ
          libelle="Profil"
          value={s.profil_temps}
          maxLength={120}
          onChange={(e) => maj("profil_temps", e.target.value)}
          aide="Ex. consultant senior."
        />
      </div>
      <CaseACocher
        libelle="Active par défaut"
        aide="Décochée : la brique ne s'active que par une règle de contexte ou une dérogation."
        checked={s.active_par_defaut}
        onChange={(e) => maj("active_par_defaut", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter la brique
        </Bouton>
      </div>
    </form>
  );
}
