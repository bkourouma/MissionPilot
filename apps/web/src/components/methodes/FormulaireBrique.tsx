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
  type BriqueVersion,
  type ChampBrique,
  type EtapeVersion,
  type SaisieBrique,
} from "../../lib/methodes";
import { saisieDepuisBrique, validerBriqueModification } from "../../lib/methodes-editeur";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
 * d'autonomie proposés dépendent de la classe (N2 au plus pour un livrable client). Avec
 * `brique`, le formulaire modifie la brique en place (son code ne change pas).
 */
export function FormulaireBrique({
  versionId,
  etapes,
  brique,
}: {
  versionId: string;
  etapes: Pick<EtapeVersion, "id" | "libelle">[];
  brique?: BriqueVersion;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampBrique>();
  const [s, setS] = useState<SaisieBrique>(
    brique ? saisieDepuisBrique(brique) : saisieBriqueVide(etapes[0]?.id ?? ""),
  );
  const base = `/api/methodes/versions/${versionId}/briques`;
  const maj = <K extends keyof SaisieBrique>(k: K, v: SaisieBrique[K]) =>
    setS((x) => ({ ...x, [k]: v }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (brique) {
      await f.envoyer(
        validerBriqueModification(s, langue),
        (charge) => api.patch(`${base}/${brique.id}`, charge),
        {
          succes: t("Brique modifiée.", "Building block updated."),
          messageSpecifique: (e) => messageMethodes(e, langue),
        },
      );
      return;
    }
    const ok = await f.envoyer(validerBrique(s, langue), (charge) => api.post(base, charge), {
      succes: t("Brique ajoutée.", "Building block added."),
      messageSpecifique: (e) => messageMethodes(e, langue),
    });
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
          libelle={t("Étape", "Step")}
          required
          value={s.etape_id}
          onChange={(e) => maj("etape_id", e.target.value)}
          options={etapes.map((x) => ({ valeur: x.id, libelle: x.libelle }))}
          invite={t("Choisir l'étape…", "Choose the step…")}
          erreur={f.erreurs.etape_id}
        />
        <Champ
          libelle={t("Libellé", "Label")}
          required
          value={s.libelle}
          maxLength={200}
          onChange={(e) => {
            maj("libelle", e.target.value);
            if (!brique) maj("code", codeDepuisLibelle(e.target.value));
          }}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle={t("Code", "Code")}
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          readOnly={Boolean(brique)}
          aide={brique ? t("Le code ne change pas.", "The code does not change.") : undefined}
          onChange={(e) => maj("code", e.target.value)}
          erreur={f.erreurs.code}
        />
      </div>
      <ZoneTexte
        libelle={t("Objet", "Purpose")}
        required
        rows={2}
        maxLength={2000}
        value={s.objet}
        onChange={(e) => maj("objet", e.target.value)}
        erreur={f.erreurs.objet}
      />
      <div className="mp-grille-champs">
        <ZoneTexte
          libelle={t("Entrées (contrat de données)", "Inputs (data contract)")}
          rows={2}
          maxLength={2000}
          value={s.entrees}
          onChange={(e) => maj("entrees", e.target.value)}
        />
        <ZoneTexte
          libelle={t("Sortie", "Output")}
          rows={2}
          maxLength={2000}
          value={s.sortie}
          onChange={(e) => maj("sortie", e.target.value)}
        />
        <ZoneTexte
          libelle={t("Définition de terminé", "Definition of done")}
          rows={2}
          maxLength={2000}
          value={s.definition_termine}
          onChange={(e) => maj("definition_termine", e.target.value)}
        />
      </div>
      <div className="mp-grille-champs">
        <Select
          libelle={t("Moteur de calcul", "Calculation engine")}
          value={s.moteur}
          onChange={(e) => maj("moteur", e.target.value)}
          invite={t("Aucun (jugement de l'expert)", "None (expert judgment)")}
          options={CODES_MOTEURS_STANDARD.map((c) => ({ valeur: c, libelle: MOTEURS_STANDARD[c] }))}
        />
        <Champ
          libelle={t("Agent IA autorisé (code)", "Authorized AI agent (code)")}
          value={s.agent}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => maj("agent", e.target.value)}
          aide={t(
            "Code du registre des agents, ex. redacteur ; vide : aucun agent.",
            "Code from the agent registry, e.g. redacteur; empty: no agent.",
          )}
        />
        <Select
          libelle={t("Classe de risque", "Risk class")}
          required
          value={s.classe_risque}
          onChange={(e) => changerClasse(e.target.value as ClasseRisque)}
          options={CLASSES_RISQUE.map((c) => ({ valeur: c, libelle: libelleClasse(c, langue) }))}
        />
        <Select
          libelle={t("Autonomie de l'IA au plus", "AI autonomy at most")}
          required
          value={s.niveau_autonomie_max}
          onChange={(e) => maj("niveau_autonomie_max", e.target.value as NiveauAutonomie)}
          options={niveauxAdmis(s.classe_risque).map((n) => ({
            valeur: n,
            libelle: libelleNiveau(n, langue),
          }))}
          erreur={f.erreurs.niveau_autonomie_max}
        />
        <Champ
          libelle={t("Temps type (jours)", "Standard time (days)")}
          inputMode="decimal"
          value={s.temps_type_jours}
          onChange={(e) => maj("temps_type_jours", e.target.value)}
          erreur={f.erreurs.temps_type_jours}
          aide={t("Par quart de jour, ex. 0,5.", "In quarter-day steps, e.g. 0.5.")}
        />
        <Champ
          libelle={t("Profil", "Profile")}
          value={s.profil_temps}
          maxLength={120}
          onChange={(e) => maj("profil_temps", e.target.value)}
          aide={t("Ex. consultant senior.", "E.g. senior consultant.")}
        />
      </div>
      <CaseACocher
        libelle={t("Active par défaut", "Active by default")}
        aide={t(
          "Décochée : la brique ne s'active que par une règle de contexte ou une dérogation.",
          "Unchecked: the building block is only activated by a context rule or a waiver.",
        )}
        checked={s.active_par_defaut}
        onChange={(e) => maj("active_par_defaut", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={brique ? "succes" : "plus"}
          chargement={f.enCours}
          texteChargement={brique ? t("Enregistrement…", "Saving…") : t("Ajout…", "Adding…")}
        >
          {brique
            ? t("Enregistrer la brique", "Save the building block")
            : t("Ajouter la brique", "Add the building block")}
        </Bouton>
      </div>
    </form>
  );
}
