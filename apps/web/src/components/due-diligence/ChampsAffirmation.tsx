"use client";

import { CLASSE_RISQUE_LIBELLES } from "@missionpilot/shared";
import {
  CLASSES_AFFIRMATION,
  AVIS_MOTIF_MAX,
  ENONCE_MAX,
  type ChampAffirmation,
  type SaisieAffirmation,
} from "../../lib/due-diligence-saisie";
import { CaseACocher } from "../ui/CaseACocher";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_CLASSE = CLASSES_AFFIRMATION.map((c) => ({
  valeur: c,
  libelle: `${c} · ${CLASSE_RISQUE_LIBELLES[c]}`,
}));

export interface ChampsAffirmationProps {
  valeur: SaisieAffirmation;
  onChange: (partiel: Partial<SaisieAffirmation>) => void;
  erreurs: Partial<Record<ChampAffirmation, string>>;
  /** Expert métier ou associé : peut signer l'avis d'expert (l'API le vérifie). */
  peutSigner: boolean;
  libelle?: string;
  aide?: string;
}

/**
 * Affirmation d'un point d'analyse, d'un risque ou d'une hypothèse : une assertion du registre des
 * preuves, sourcée ou signalée « fragile ». La solidité n'est jamais saisie : elle vient du moteur.
 */
export function ChampsAffirmation({
  valeur,
  onChange,
  erreurs,
  peutSigner,
  libelle = "Affirmation",
  aide = "Une affirmation vérifiable. Elle devient une assertion du registre des preuves : reliez-lui ensuite des sources, sinon elle sera signalée fragile.",
}: ChampsAffirmationProps) {
  return (
    <>
      <ZoneTexte
        libelle={libelle}
        required
        rows={3}
        maxLength={ENONCE_MAX}
        value={valeur.enonce}
        onChange={(e) => onChange({ enonce: e.target.value })}
        erreur={erreurs.enonce}
        aide={aide}
      />
      <Select
        libelle="Classe de risque"
        required
        options={OPTIONS_CLASSE}
        value={valeur.classe_risque}
        onChange={(e) => onChange({ classe_risque: e.target.value })}
        erreur={erreurs.classe_risque}
        aide="R2 ou R3 : l'affirmation doit reposer sur une preuve ou sur un avis d'expert signé."
      />
      <fieldset className="mp-groupe-cases">
        <legend>Avis d&apos;expert</legend>
        <CaseACocher
          libelle="Cette affirmation est un avis d'expert, sans preuve"
          checked={valeur.avis_expert}
          onChange={(e) =>
            onChange({
              avis_expert: e.target.checked,
              signer_avis: e.target.checked && valeur.signer_avis,
            })
          }
        />
        {valeur.avis_expert ? (
          <>
            <ZoneTexte
              libelle="Fondement de l'avis"
              required
              rows={2}
              maxLength={AVIS_MOTIF_MAX}
              value={valeur.avis_expert_motif}
              onChange={(e) => onChange({ avis_expert_motif: e.target.value })}
              erreur={erreurs.avis_expert_motif}
            />
            {peutSigner ? (
              <CaseACocher
                libelle="Je signe cet avis en mon nom"
                checked={valeur.signer_avis}
                onChange={(e) => onChange({ signer_avis: e.target.checked })}
              />
            ) : (
              <p className="mp-texte-doux mp-texte-petit">
                La signature d&apos;un avis d&apos;expert revient à un expert métier ou à un
                associé.
              </p>
            )}
          </>
        ) : null}
      </fieldset>
    </>
  );
}
