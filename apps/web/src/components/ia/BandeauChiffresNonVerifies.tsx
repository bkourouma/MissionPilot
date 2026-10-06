"use client";

import { useId, type Ref } from "react";
import { Alerte } from "../ui/Alerte";
import { CaseACocher } from "../ui/CaseACocher";
import { Icone } from "../ui/Icone";
import "./ia.css";

export interface BandeauChiffresNonVerifiesProps {
  /** Nombres de la sortie absents des chiffres fournis par les moteurs (tels que signalés par l'API). */
  nombres: readonly string[];
  acquitte: boolean;
  onAcquitteChange: (acquitte: boolean) => void;
  /** Erreur affichée sous la case (validation tentée sans acquittement). */
  erreur?: string;
  desactive?: boolean;
  /** Conteneur de la case : le panneau y place le focus quand l'acquittement manque. */
  refZone?: Ref<HTMLDivElement>;
}

/**
 * Bandeau BLOQUANT : des nombres du contenu ne viennent pas des moteurs de calcul. La
 * validation exige que l'humain coche explicitement l'attestation (l'API refuse sinon, 409
 * CHIFFRES_NON_VERIFIES). Les chiffres d'un livrable sortent des moteurs, jamais du modèle.
 */
export function BandeauChiffresNonVerifies({
  nombres,
  acquitte,
  onAcquitteChange,
  erreur,
  desactive,
  refZone,
}: BandeauChiffresNonVerifiesProps) {
  const id = useId();
  const idErreur = erreur ? `${id}-erreur` : undefined;
  return (
    <div className="mp-chiffres-ia" role="group" aria-labelledby={`${id}-titre`}>
      <Alerte
        tonalite="attention"
        annonce="aucune"
        titre={<span id={`${id}-titre`}>Chiffres non vérifiés : validation bloquée</span>}
      >
        <p>
          Ces nombres ne viennent pas des moteurs de calcul de MissionPilot. Vérifiez chacun
          d&apos;eux à la source ; corrigez ou retirez ceux qui sont faux en modifiant le texte,
          puis attestez-les pour pouvoir valider.
        </p>
        {nombres.length > 0 ? (
          <ul className="mp-chiffres-ia__liste" aria-label="Nombres signalés">
            {nombres.map((n, i) => (
              <li key={`${i}-${n}`}>
                <span className="mp-chiffres-ia__nombre">{n}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Alerte>
      <div ref={refZone} className={erreur ? "mp-champ mp-champ--erreur" : "mp-champ"}>
        <CaseACocher
          libelle="J'ai vérifié chacun de ces nombres et j'atteste leur exactitude."
          checked={acquitte}
          disabled={desactive}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={idErreur}
          onChange={(e) => onAcquitteChange(e.target.checked)}
        />
        {erreur ? (
          <p className="mp-champ__erreur" id={idErreur}>
            <Icone nom="attention" taille={16} />
            <span>{erreur}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
