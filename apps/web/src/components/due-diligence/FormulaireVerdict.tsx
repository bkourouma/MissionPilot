"use client";

import { useState, type FormEvent } from "react";
import { VERDICTS_DD, type VerdictDd } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminVerdictsHypothese,
  libelleRaisonVerdict,
  messageDd,
  optionsDe,
  VERDICT_DD_LIBELLES,
} from "../../lib/due-diligence";
import {
  ecartIndication,
  MOTIF_VERDICT_ECART_MIN,
  MOTIF_VERDICT_MAX,
  validerVerdict,
  type ChampVerdict,
  type SaisieVerdict,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { GroupeCases } from "../ui/CaseACocher";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_VERDICT = optionsDe(VERDICTS_DD, VERDICT_DD_LIBELLES);

export interface FormulaireVerdictProps {
  hypotheseId: string;
  hypotheseVersion: number;
  /** Indication du moteur sur toutes les assertions liées (jamais saisie). */
  indication: { indication: VerdictDd; raison: string };
  /** Assertions liées à l'hypothèse, citables à l'appui du verdict (libellé = énoncé et sens). */
  citables: { valeur: string; libelle: string }[];
  /** Un verdict attend déjà sa décision : en proposer un autre est refusé. */
  enAttente: boolean;
}

/**
 * Proposition de verdict (DD-09) : le moteur INDIQUE, l'expert DÉCIDE, un tiers VALIDE. Un verdict
 * qui s'écarte de l'indication exige un motif détaillé et l'écart est tracé dans les ajustements.
 */
export function FormulaireVerdict({
  hypotheseId,
  hypotheseVersion,
  indication,
  citables,
  enAttente,
}: FormulaireVerdictProps) {
  const f = useFormulaire<ChampVerdict>();
  const [s, setS] = useState<SaisieVerdict>({
    verdict: indication.indication,
    motif: "",
    assertions_citees: [],
  });
  const maj = (p: Partial<SaisieVerdict>) => setS((x) => ({ ...x, ...p }));
  const ecart = ecartIndication(s.verdict, indication.indication);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerVerdict(s, hypotheseVersion, indication.indication),
      (charge) => api.post<{ id: string }>(cheminVerdictsHypothese(hypotheseId), charge),
      {
        succes: "Verdict proposé : il attend la validation d'une autre personne.",
        messageSpecifique: messageDd,
        apres: () => maj({ motif: "", assertions_citees: [] }),
      },
    );
  }

  if (enAttente) {
    return (
      <Alerte tonalite="info" titre="Un verdict attend sa validation" annonce="aucune">
        <p>
          Un autre verdict est déjà proposé pour cette hypothèse : il doit être validé ou rejeté
          avant d&apos;en proposer un nouveau.
        </p>
      </Alerte>
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Proposer un verdict"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Verdict refusé"
      />
      <p className="mp-dd-texte">
        <strong>{`Indication du moteur : ${VERDICT_DD_LIBELLES[indication.indication].toLowerCase()}. `}</strong>
        {libelleRaisonVerdict(indication.raison)}
      </p>
      <Select
        libelle="Verdict proposé"
        required
        invite="Choisir…"
        options={OPTIONS_VERDICT}
        value={s.verdict}
        onChange={(e) => maj({ verdict: e.target.value })}
        erreur={f.erreurs.verdict}
      />
      {ecart ? (
        <Alerte tonalite="attention" titre="Écart avec l'indication du moteur" annonce="status">
          <p>
            Ce verdict s&apos;écarte de l&apos;indication du moteur : un motif détaillé (
            {MOTIF_VERDICT_ECART_MIN} caractères au moins) est exigé et l&apos;écart est tracé.
          </p>
        </Alerte>
      ) : null}
      <ZoneTexte
        libelle="Motif"
        required
        rows={3}
        maxLength={MOTIF_VERDICT_MAX}
        value={s.motif}
        onChange={(e) => maj({ motif: e.target.value })}
        erreur={f.erreurs.motif}
      />
      {citables.length === 0 ? (
        <p className="mp-texte-doux">
          Aucune assertion n&apos;est liée à l&apos;hypothèse : seul un verdict « non concluante »
          est possible.
        </p>
      ) : (
        <GroupeCases
          legende="Assertions citées à l'appui du verdict"
          aide="Une hypothèse confirmée cite au moins une assertion qui la soutient ; une hypothèse infirmée, au moins une qui la contredit."
          erreur={f.erreurs.assertions_citees}
          options={citables}
          valeurs={s.assertions_citees}
          onChange={(v) => maj({ assertions_citees: v })}
          nom="assertions_citees"
        />
      )}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Proposer ce verdict
        </Bouton>
      </div>
    </form>
  );
}
