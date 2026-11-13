"use client";

import { useState, type FormEvent } from "react";
import { RED_CAUSES_CONTEXTE_MAX } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminGenerationCauses, messageDiagnostic } from "../../lib/redressement-diagnostic";
import { corpsGenerationCauses } from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Demande d'une proposition de causes racines à l'IA (droits « écrire » et « utiliser l'IA »).
 * Le contexte libre est facultatif et transmis comme donnée non fiable ; la proposition arrive
 * en « Brouillon IA » et ne devient exploitable qu'une fois validée par un consultant.
 */
export function CausesGeneration({
  dossierId,
  desactiveParce,
}: {
  dossierId: string;
  /** Raison affichée quand la demande n'est pas possible (ex. droit « utiliser l'IA » absent). */
  desactiveParce?: string;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"contexte">();
  const [contexte, setContexte] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsGenerationCauses(contexte, langue),
      (charge) => api.post(cheminGenerationCauses(dossierId), charge),
      {
        succes: t(
          "Proposition reçue : relisez-la, corrigez-la puis faites-la valider.",
          "Proposal received: review it, correct it, then have it approved.",
        ),
        messageSpecifique: (e) => messageDiagnostic(e, langue),
        apres: () => setContexte(""),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Demander une proposition de causes racines", "Request a root-cause proposal")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Proposition impossible", "Proposal not possible")}
      />
      <ZoneTexte
        libelle={t("Contexte complémentaire (facultatif)", "Additional context (optional)")}
        aide={t(
          `Éléments connus du consultant, ${RED_CAUSES_CONTEXTE_MAX} caractères au plus. Évitez les noms de personnes.`,
          `Information known to the consultant, ${RED_CAUSES_CONTEXTE_MAX} characters at most. Avoid people's names.`,
        )}
        value={contexte}
        onChange={(e) => setContexte(e.target.value)}
        disabled={desactiveParce !== undefined}
        erreur={f.erreurs.contexte}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement={t("Proposition en cours…", "Generating proposal…")}
          disabled={desactiveParce !== undefined}
        >
          {t("Demander une proposition à l'IA", "Request a proposal from the AI")}
        </Bouton>
        {desactiveParce ? (
          <span className="mp-texte-doux mp-texte-petit">{desactiveParce}</span>
        ) : null}
      </div>
    </form>
  );
}
