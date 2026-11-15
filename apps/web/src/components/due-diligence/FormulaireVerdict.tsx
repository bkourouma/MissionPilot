"use client";

import { useState, type FormEvent } from "react";
import { VERDICTS_DD, type VerdictDd } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminVerdictsHypothese,
  libelleRaisonVerdict,
  libellesDd,
  messageDd,
  optionsDe,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { GroupeCases } from "../ui/CaseACocher";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

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
  const t = useT();
  const langue = useLangue();
  const L = libellesDd(langue);
  const optionsVerdict = optionsDe(VERDICTS_DD, L.VERDICT);
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
      validerVerdict(s, hypotheseVersion, indication.indication, langue),
      (charge) => api.post<{ id: string }>(cheminVerdictsHypothese(hypotheseId), charge),
      {
        succes: t(
          "Verdict proposé : il attend la validation d'une autre personne.",
          "Verdict proposed: it is awaiting approval by another person.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => maj({ motif: "", assertions_citees: [] }),
      },
    );
  }

  if (enAttente) {
    return (
      <Alerte
        tonalite="info"
        titre={t("Un verdict attend sa validation", "A verdict is awaiting approval")}
        annonce="aucune"
      >
        <p>
          {t(
            "Un autre verdict est déjà proposé pour cette hypothèse : il doit être validé ou rejeté avant d'en proposer un nouveau.",
            "Another verdict is already proposed for this hypothesis: it must be approved or rejected before proposing a new one.",
          )}
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
      aria-label={t("Proposer un verdict", "Propose a verdict")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Verdict refusé", "Verdict refused")}
      />
      <p className="mp-dd-texte">
        <strong>{`${t("Indication du moteur", "Engine indication")} : ${L.VERDICT[indication.indication].toLowerCase()}. `}</strong>
        {libelleRaisonVerdict(indication.raison, langue)}
      </p>
      <Select
        libelle={t("Verdict proposé", "Proposed verdict")}
        required
        invite={t("Choisir…", "Choose…")}
        options={optionsVerdict}
        value={s.verdict}
        onChange={(e) => maj({ verdict: e.target.value })}
        erreur={f.erreurs.verdict}
      />
      {ecart ? (
        <Alerte
          tonalite="attention"
          titre={t("Écart avec l'indication du moteur", "Difference from the engine indication")}
          annonce="status"
        >
          <p>
            {t(
              `Ce verdict s'écarte de l'indication du moteur : un motif détaillé (${MOTIF_VERDICT_ECART_MIN} caractères au moins) est exigé et l'écart est tracé.`,
              `This verdict departs from the engine indication: a detailed reason (at least ${MOTIF_VERDICT_ECART_MIN} characters) is required and the difference is traced.`,
            )}
          </p>
        </Alerte>
      ) : null}
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        required
        rows={3}
        maxLength={MOTIF_VERDICT_MAX}
        value={s.motif}
        onChange={(e) => maj({ motif: e.target.value })}
        erreur={f.erreurs.motif}
      />
      {citables.length === 0 ? (
        <p className="mp-texte-doux">
          {t(
            "Aucune assertion n'est liée à l'hypothèse : seul un verdict « non concluante » est possible.",
            "No statement is linked to the hypothesis: only an “inconclusive” verdict is possible.",
          )}
        </p>
      ) : (
        <GroupeCases
          legende={t(
            "Assertions citées à l'appui du verdict",
            "Statements cited in support of the verdict",
          )}
          aide={t(
            "Une hypothèse confirmée cite au moins une assertion qui la soutient ; une hypothèse infirmée, au moins une qui la contredit.",
            "A confirmed hypothesis cites at least one statement that supports it; a refuted hypothesis, at least one that contradicts it.",
          )}
          erreur={f.erreurs.assertions_citees}
          options={citables}
          valeurs={s.assertions_citees}
          onChange={(v) => maj({ assertions_citees: v })}
          nom="assertions_citees"
        />
      )}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Proposer ce verdict", "Propose this verdict")}
        </Bouton>
      </div>
    </form>
  );
}
