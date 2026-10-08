"use client";

import { useState, type FormEvent } from "react";
import type { TacheIa } from "@missionpilot/shared";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Select } from "../../../../components/ui/Select";
import {
  chargeModeles,
  libelleTache,
  optionsModele,
  saisiesModeles,
  type ChampModele,
  type ModeleTacheIa,
  type SaisieModele,
} from "../../../../lib/ia";
import { useEnregistrementIa } from "./useEnregistrementIa";

/**
 * Modèle OpenRouter par tâche : le modèle recommandé par MissionPilot (signalé), ou un modèle
 * choisi par le cabinet dans la liste FERMÉE que l'API autorise (`modeles_autorises` : tarif
 * connu, pour un plafond fiable). Aucune saisie libre : un modèle hors liste est refusé (400).
 */
export function ModelesIa({
  modeles,
  autorises,
}: {
  modeles: readonly ModeleTacheIa[];
  autorises: readonly string[];
}) {
  const [saisies, setSaisies] = useState<SaisieModele[]>(() => saisiesModeles(modeles));
  const [info, setInfo] = useState<string | null>(null);
  const e = useEnregistrementIa<ChampModele>();
  const maj = (tache: TacheIa, p: Partial<SaisieModele>) => {
    setInfo(null);
    setSaisies((s) => s.map((x) => (x.tache === tache ? { ...x, ...p } : x)));
  };

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setInfo(null);
    const v = chargeModeles(saisies, modeles, autorises);
    if (v.ok && Object.keys(v.charge.modeles).length === 0) {
      setInfo("Aucun changement à enregistrer.");
      return;
    }
    await e.enregistrer(v, { succes: "Modèles par tâche enregistrés." });
  }

  return (
    <form
      ref={e.f.refFormulaire}
      className="mp-formulaire"
      method="post"
      noValidate
      onSubmit={soumettre}
    >
      <RetourFormulaire erreur={e.f.erreurGlobale} succes={e.f.succes} refAlerte={e.f.refAlerte} />
      <p className="mp-texte-petit mp-texte-doux">
        {autorises.length > 0
          ? "Seuls les modèles au tarif connu de MissionPilot sont proposés. Avant d'en retenir un, vérifiez chez OpenRouter que son fournisseur ne s'entraîne pas sur les données envoyées."
          : "Aucun autre modèle n'est proposé pour l'instant : chaque tâche suit le modèle recommandé."}
      </p>
      <div className="mp-ia-modeles">
        {modeles.map((m) => {
          const s = saisies.find((x) => x.tache === m.tache);
          return s ? (
            <LigneModele
              key={m.tache}
              m={m}
              s={s}
              autorises={autorises}
              erreur={e.f.erreurs[`modele_${m.tache}`]}
              maj={(p) => maj(m.tache, p)}
            />
          ) : null;
        })}
      </div>
      {e.confirmation ? (
        <ChampsReconfirmation
          saisie={e.confirmation}
          onChange={e.setConfirmation}
          erreurs={e.f.erreurs}
          motif="modifier les modèles d'IA du cabinet"
        />
      ) : null}
      {info ? (
        <p className="mp-texte-doux" role="status">
          {info}
        </p>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={e.f.enCours} texteChargement="Enregistrement…">
          Enregistrer les modèles
        </Bouton>
      </div>
    </form>
  );
}

function LigneModele({
  m,
  s,
  autorises,
  erreur,
  maj,
}: {
  m: ModeleTacheIa;
  s: SaisieModele;
  autorises: readonly string[];
  erreur?: string;
  maj: (p: Partial<SaisieModele>) => void;
}) {
  // Sans liste autorisée, seul le modèle recommandé reste possible (modèle en place conservé).
  const choixPossible = autorises.length > 0 || m.personnalise;
  return (
    <fieldset className="mp-ia-modele">
      <legend className="mp-champ__libelle">{libelleTache(m.tache)}</legend>
      <div className="mp-ia-modele__entete">
        {m.personnalise ? (
          <BadgeStatut tonalite="neutre">Modèle choisi par le cabinet</BadgeStatut>
        ) : (
          <BadgeStatut tonalite="succes">Modèle recommandé</BadgeStatut>
        )}
        <span className="mp-ia-code">{m.modele}</span>
      </div>
      <p className="mp-texte-petit">
        Recommandé par MissionPilot : <span className="mp-ia-code">{m.recommande}</span>
      </p>
      {choixPossible ? (
        <CaseACocher
          libelle="Suivre le modèle recommandé"
          aide="Il suit les mises à jour de MissionPilot."
          checked={s.recommande}
          onChange={(ev) => maj({ recommande: ev.target.checked, modele: s.modele || m.modele })}
        />
      ) : null}
      {s.recommande || !choixPossible ? null : (
        <Select
          libelle="Modèle"
          aide="Liste des modèles autorisés : le plafond mensuel reste fiable."
          options={optionsModele(m, autorises)}
          value={s.modele}
          onChange={(ev) => maj({ modele: ev.target.value })}
          erreur={erreur}
        />
      )}
    </fieldset>
  );
}
