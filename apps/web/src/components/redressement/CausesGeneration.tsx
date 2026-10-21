"use client";

import { useState, type FormEvent } from "react";
import { RED_CAUSES_CONTEXTE_MAX } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminGenerationCauses, messageDiagnostic } from "../../lib/redressement-diagnostic";
import { corpsGenerationCauses } from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
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
  const f = useFormulaire<"contexte">();
  const [contexte, setContexte] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsGenerationCauses(contexte),
      (charge) => api.post(cheminGenerationCauses(dossierId), charge),
      {
        succes: "Proposition reçue : relisez-la, corrigez-la puis faites-la valider.",
        messageSpecifique: messageDiagnostic,
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
      aria-label="Demander une proposition de causes racines"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Proposition impossible"
      />
      <ZoneTexte
        libelle="Contexte complémentaire (facultatif)"
        aide={`Éléments connus du consultant, ${RED_CAUSES_CONTEXTE_MAX} caractères au plus. Évitez les noms de personnes.`}
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
          texteChargement="Proposition en cours…"
          disabled={desactiveParce !== undefined}
        >
          Demander une proposition à l&apos;IA
        </Bouton>
        {desactiveParce ? (
          <span className="mp-texte-doux mp-texte-petit">{desactiveParce}</span>
        ) : null}
      </div>
    </form>
  );
}
