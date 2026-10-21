"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  cheminAffectation,
  cheminEligibles,
  libelleViolationIndependance,
  type EligibiliteRelecteurs,
} from "../../lib/qualite-froide";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { useActionFroide } from "./useActionFroide";

export interface FroideAffectationProps {
  echantillonId: string;
  /** Intitulé de la mission, pour nommer les contrôles. */
  mission: string;
}

/**
 * Affectation d'un relecteur indépendant. La liste des relecteurs et leur éligibilité (équipe
 * de la mission, directeur, etc.) sont jugées par l'API ; les non éligibles restent visibles,
 * désactivés, avec la raison.
 */
export function FroideAffectation({ echantillonId, mission }: FroideAffectationProps) {
  const a = useActionFroide();
  const [liste, setListe] = useState<EligibiliteRelecteurs | null>(null);
  const [choix, setChoix] = useState("");
  const [erreurChoix, setErreurChoix] = useState<string | undefined>();

  if (!liste) {
    return (
      <div className="mp-froide__pile">
        <Bouton
          variante="secondaire"
          chargement={a.enCours}
          texteChargement="Chargement…"
          aria-label={`Choisir un relecteur pour la mission ${mission}`}
          onClick={async () => {
            const r = await a.agir(
              () => api.get<EligibiliteRelecteurs>(cheminEligibles(echantillonId)),
              { rafraichir: false },
            );
            if (r.ok) setListe(r.valeur);
          }}
        >
          Choisir un relecteur
        </Bouton>
        <RetourFormulaire
          erreur={a.erreur}
          refAlerte={a.refAlerte}
          titreErreur="Liste indisponible"
        />
      </div>
    );
  }

  const ineligibles = liste.relecteurs.filter((r) => !r.eligible);
  return (
    <form
      className="mp-froide__pile"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (choix === "") {
          setErreurChoix("Choisissez un relecteur éligible.");
          return;
        }
        setErreurChoix(undefined);
        await a.agir(() => api.post(cheminAffectation(echantillonId), { relecteur_id: choix }), {
          succes: "Relecteur affecté.",
        });
      }}
    >
      <RetourFormulaire
        erreur={a.erreur}
        succes={a.succes}
        refAlerte={a.refAlerte}
        titreErreur="Affectation refusée"
      />
      {a.violations.length > 0 ? (
        <ul className="mp-froide-ineligibles">
          {a.violations.map((v, i) => (
            <li key={`${v.code}-${i}`}>{libelleViolationIndependance(v)}</li>
          ))}
        </ul>
      ) : null}
      <Select
        libelle={`Relecteur indépendant pour la mission ${mission}`}
        value={choix}
        onChange={(e) => setChoix(e.target.value)}
        invite="Choisir un relecteur"
        options={liste.relecteurs.map((r) => ({
          valeur: r.id,
          libelle: r.eligible
            ? r.nom
            : `${r.nom} (non éligible : ${r.violations.map(libelleViolationIndependance).join(", ")})`,
          desactivee: !r.eligible,
        }))}
        erreur={erreurChoix}
        aide={
          ineligibles.length > 0
            ? "Les personnes grisées ne sont pas indépendantes de cette mission."
            : undefined
        }
      />
      <div>
        <Bouton type="submit" chargement={a.enCours} texteChargement="Affectation…">
          Affecter
        </Bouton>
      </div>
    </form>
  );
}
