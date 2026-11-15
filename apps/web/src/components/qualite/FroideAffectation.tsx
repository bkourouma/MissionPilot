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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
          texteChargement={t("Chargement…", "Loading…")}
          aria-label={t(
            `Choisir un relecteur pour la mission ${mission}`,
            `Choose a reviewer for the engagement ${mission}`,
          )}
          onClick={async () => {
            const r = await a.agir(
              () => api.get<EligibiliteRelecteurs>(cheminEligibles(echantillonId)),
              { rafraichir: false },
            );
            if (r.ok) setListe(r.valeur);
          }}
        >
          {t("Choisir un relecteur", "Choose a reviewer")}
        </Bouton>
        <RetourFormulaire
          erreur={a.erreur}
          refAlerte={a.refAlerte}
          titreErreur={t("Liste indisponible", "List unavailable")}
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
          setErreurChoix(t("Choisissez un relecteur éligible.", "Choose an eligible reviewer."));
          return;
        }
        setErreurChoix(undefined);
        await a.agir(() => api.post(cheminAffectation(echantillonId), { relecteur_id: choix }), {
          succes: t("Relecteur affecté.", "Reviewer assigned."),
        });
      }}
    >
      <RetourFormulaire
        erreur={a.erreur}
        succes={a.succes}
        refAlerte={a.refAlerte}
        titreErreur={t("Affectation refusée", "Assignment refused")}
      />
      {a.violations.length > 0 ? (
        <ul className="mp-froide-ineligibles">
          {a.violations.map((v, i) => (
            <li key={`${v.code}-${i}`}>{libelleViolationIndependance(v, langue)}</li>
          ))}
        </ul>
      ) : null}
      <Select
        libelle={t(
          `Relecteur indépendant pour la mission ${mission}`,
          `Independent reviewer for the engagement ${mission}`,
        )}
        value={choix}
        onChange={(e) => setChoix(e.target.value)}
        invite={t("Choisir un relecteur", "Choose a reviewer")}
        options={liste.relecteurs.map((r) => ({
          valeur: r.id,
          libelle: r.eligible
            ? r.nom
            : t(
                `${r.nom} (non éligible : ${r.violations.map((v) => libelleViolationIndependance(v, langue)).join(", ")})`,
                `${r.nom} (not eligible: ${r.violations.map((v) => libelleViolationIndependance(v, langue)).join(", ")})`,
              ),
          desactivee: !r.eligible,
        }))}
        erreur={erreurChoix}
        aide={
          ineligibles.length > 0
            ? t(
                "Les personnes grisées ne sont pas indépendantes de cette mission.",
                "People shown in gray are not independent of this engagement.",
              )
            : undefined
        }
      />
      <div>
        <Bouton
          type="submit"
          chargement={a.enCours}
          texteChargement={t("Affectation…", "Assigning…")}
        >
          {t("Affecter", "Assign")}
        </Bouton>
      </div>
    </form>
  );
}
