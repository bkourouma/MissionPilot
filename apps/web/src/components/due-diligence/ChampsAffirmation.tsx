"use client";

import { CLASSE_RISQUE_LIBELLES } from "@missionpilot/shared";
import {
  CLASSES_AFFIRMATION,
  AVIS_MOTIF_MAX,
  ENONCE_MAX,
  type ChampAffirmation,
  type SaisieAffirmation,
} from "../../lib/due-diligence-saisie";
import { useT } from "../i18n/FournisseurLangue";
import { CaseACocher } from "../ui/CaseACocher";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const CLASSE_RISQUE_LIBELLES_EN: Record<(typeof CLASSES_AFFIRMATION)[number], string> = {
  R2: "Client deliverable",
  R3: "Binding",
};

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
  libelle,
  aide,
}: ChampsAffirmationProps) {
  const t = useT();
  const optionsClasse = CLASSES_AFFIRMATION.map((c) => ({
    valeur: c,
    libelle: `${c} · ${t(CLASSE_RISQUE_LIBELLES[c], CLASSE_RISQUE_LIBELLES_EN[c])}`,
  }));
  return (
    <>
      <ZoneTexte
        libelle={libelle ?? t("Affirmation", "Statement")}
        required
        rows={3}
        maxLength={ENONCE_MAX}
        value={valeur.enonce}
        onChange={(e) => onChange({ enonce: e.target.value })}
        erreur={erreurs.enonce}
        aide={
          aide ??
          t(
            "Une affirmation vérifiable. Elle devient une assertion du registre des preuves : reliez-lui ensuite des sources, sinon elle sera signalée fragile.",
            "A verifiable statement. It becomes a statement in the evidence register: then link sources to it, otherwise it will be flagged weak.",
          )
        }
      />
      <Select
        libelle={t("Classe de risque", "Risk class")}
        required
        options={optionsClasse}
        value={valeur.classe_risque}
        onChange={(e) => onChange({ classe_risque: e.target.value })}
        erreur={erreurs.classe_risque}
        aide={t(
          "R2 ou R3 : l'affirmation doit reposer sur une preuve ou sur un avis d'expert signé.",
          "R2 or R3: the statement must rest on evidence or on a signed expert opinion.",
        )}
      />
      <fieldset className="mp-groupe-cases">
        <legend>{t("Avis d'expert", "Expert opinion")}</legend>
        <CaseACocher
          libelle={t(
            "Cette affirmation est un avis d'expert, sans preuve",
            "This statement is an expert opinion, without evidence",
          )}
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
              libelle={t("Fondement de l'avis", "Basis of the opinion")}
              required
              rows={2}
              maxLength={AVIS_MOTIF_MAX}
              value={valeur.avis_expert_motif}
              onChange={(e) => onChange({ avis_expert_motif: e.target.value })}
              erreur={erreurs.avis_expert_motif}
            />
            {peutSigner ? (
              <CaseACocher
                libelle={t("Je signe cet avis en mon nom", "I sign this opinion in my name")}
                checked={valeur.signer_avis}
                onChange={(e) => onChange({ signer_avis: e.target.checked })}
              />
            ) : (
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  "La signature d'un avis d'expert revient à un expert métier ou à un associé.",
                  "Signing an expert opinion is reserved for a subject-matter expert or a partner.",
                )}
              </p>
            )}
          </>
        ) : null}
      </fieldset>
    </>
  );
}
