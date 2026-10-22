"use client";

import { useState } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { api } from "../../../../../lib/api";
import { ordreSuivant } from "../../../../../lib/decoupage";
import { NoeudPhase } from "./ArbreDecoupagePhase";
import type { CollaborationDecoupage, Contexte, DroitsDecoupage } from "./arbre-decoupage-types";
import { FormulaireLibelle, type GradeDecoupage } from "./FormulairesDecoupage";
import type { Decoupage } from "../../../../../lib/decoupage";

export type { CollaborationDecoupage, DroitsDecoupage } from "./arbre-decoupage-types";

export interface ArbreDecoupageProps {
  missionId: string;
  decoupage: Pick<Decoupage, "phases">;
  grades: GradeDecoupage[];
  droits: DroitsDecoupage;
  budgets: Record<string, number>;
  collaboration: CollaborationDecoupage;
}

/**
 * Découpage phases > lots > tâches (PLN-01). La réorganisation se fait au clavier avec des
 * boutons « Monter », « Descendre » et « Déplacer vers… » ; le résultat est annoncé.
 */
export function ArbreDecoupage(props: ArbreDecoupageProps) {
  const f = useFormulaire<never>();
  const [annonce, setAnnonce] = useState("");
  const [ajoutPhase, setAjoutPhase] = useState(false);
  const base = `/api/missions/${encodeURIComponent(props.missionId)}`;
  const ctx: Contexte = {
    ...props,
    annoncer: setAnnonce,
    reorganiser: (deplacements, message) =>
      f.envoyer({ ok: true, charge: { deplacements } }, (c) => api.post(`${base}/reorganiser`, c), {
        apres: () => setAnnonce(message),
      }),
  };
  const phases = props.decoupage.phases;

  return (
    <div className="mp-pile">
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
      {phases.length === 0 ? (
        <EtatVide titre="Le découpage est vide." icone="livre">
          {props.droits.planifier ? (
            <p>Ajoutez une première phase, puis ses lots et ses tâches.</p>
          ) : (
            <p>Le chef de mission n&apos;a pas encore découpé cette mission.</p>
          )}
        </EtatVide>
      ) : (
        <ol className="mp-arbre" aria-label="Découpage de la mission">
          {phases.map((p, i) => (
            <NoeudPhase key={p.id} phase={p} rang={i} total={phases.length} ctx={ctx} />
          ))}
        </ol>
      )}
      {props.droits.planifier ? (
        ajoutPhase ? (
          <FormulaireLibelle
            titre="Nouvelle phase"
            libelleEnvoi="Ajouter la phase"
            initial={{ libelle: "" }}
            avecLivrable={false}
            onAnnuler={() => setAjoutPhase(false)}
            envoyer={(c) => api.post(`${base}/phases`, { ...c, ordre: ordreSuivant(phases) })}
          />
        ) : (
          <div>
            <Bouton variante="secondaire" icone="plus" onClick={() => setAjoutPhase(true)}>
              Ajouter une phase
            </Bouton>
          </div>
        )
      ) : null}
    </div>
  );
}
