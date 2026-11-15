"use client";

import { useState, type FormEvent } from "react";
import type { TacheIa } from "@missionpilot/shared";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
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
 * Modèle OpenRouter par tâche : le modèle recommandé par CabinetPilot (signalé), ou un modèle
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
  const t = useT();
  const langue = useLangue();
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
    const v = chargeModeles(saisies, modeles, autorises, langue);
    if (v.ok && Object.keys(v.charge.modeles).length === 0) {
      setInfo(t("Aucun changement à enregistrer.", "No change to save."));
      return;
    }
    await e.enregistrer(v, {
      succes: t("Modèles par tâche enregistrés.", "Models per task saved."),
    });
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
          ? t(
              "Seuls les modèles au tarif connu de CabinetPilot sont proposés. Avant d'en retenir un, vérifiez chez OpenRouter que son fournisseur ne s'entraîne pas sur les données envoyées.",
              "Only models with a price known to CabinetPilot are offered. Before choosing one, check with OpenRouter that its provider does not train on the data sent.",
            )
          : t(
              "Aucun autre modèle n'est proposé pour l'instant : chaque tâche suit le modèle recommandé.",
              "No other model is offered for now: each task follows the recommended model.",
            )}
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
          motifEn="change the firm's AI models"
        />
      ) : null}
      {info ? (
        <p className="mp-texte-doux" role="status">
          {info}
        </p>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={e.f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer les modèles", "Save the models")}
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
  const t = useT();
  const langue = useLangue();
  // Sans liste autorisée, seul le modèle recommandé reste possible (modèle en place conservé).
  const choixPossible = autorises.length > 0 || m.personnalise;
  return (
    <fieldset className="mp-ia-modele">
      <legend className="mp-champ__libelle">{libelleTache(m.tache, langue)}</legend>
      <div className="mp-ia-modele__entete">
        {m.personnalise ? (
          <BadgeStatut tonalite="neutre">
            {t("Modèle choisi par le cabinet", "Model chosen by the firm")}
          </BadgeStatut>
        ) : (
          <BadgeStatut tonalite="succes">{t("Modèle recommandé", "Recommended model")}</BadgeStatut>
        )}
        <span className="mp-ia-code">{m.modele}</span>
      </div>
      <p className="mp-texte-petit">
        {t("Recommandé par CabinetPilot :", "Recommended by CabinetPilot:")}{" "}
        <span className="mp-ia-code">{m.recommande}</span>
      </p>
      {choixPossible ? (
        <CaseACocher
          libelle={t("Suivre le modèle recommandé", "Follow the recommended model")}
          aide={t(
            "Il suit les mises à jour de CabinetPilot.",
            "It follows CabinetPilot's updates.",
          )}
          checked={s.recommande}
          onChange={(ev) => maj({ recommande: ev.target.checked, modele: s.modele || m.modele })}
        />
      ) : null}
      {s.recommande || !choixPossible ? null : (
        <Select
          libelle={t("Modèle", "Model")}
          aide={t(
            "Liste des modèles autorisés : le plafond mensuel reste fiable.",
            "List of allowed models: the monthly ceiling remains reliable.",
          )}
          options={optionsModele(m, autorises, langue)}
          value={s.modele}
          onChange={(ev) => maj({ modele: ev.target.value })}
          erreur={erreur}
        />
      )}
    </fieldset>
  );
}
