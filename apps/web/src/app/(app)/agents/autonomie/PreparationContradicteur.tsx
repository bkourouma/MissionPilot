"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Select } from "../../../../components/ui/Select";
import { messageAgents } from "../../../../lib/agents";
import { api } from "../../../../lib/api";
import {
  chargeBriqueContradicteur,
  libelleNiveauContradicteur,
  messagePreparation,
  NIVEAU_CONTRADICTEUR_DEFAUT,
  NIVEAUX_CONTRADICTEUR,
  type PreparationRevue,
} from "./contradicteur-agent";

/**
 * Préparation de la revue contradictoire (droit « agent.gerer ») : sème le prompt et le jeu
 * d'essai, puis déclare la brique `revue_contradictoire` avec son niveau d'autonomie maximal.
 * La revue elle-même reste lancée à la demande d'un consultant, jamais automatiquement.
 */
export function PreparationContradicteur({ declaree }: { declaree: boolean }) {
  const prep = useFormulaire<"prompt">();
  const decl = useFormulaire<"niveau_max">();
  const [niveau, setNiveau] = useState<string>(NIVEAU_CONTRADICTEUR_DEFAUT);
  const [messagePrep, setMessagePrep] = useState<string | null>(null);

  async function preparer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessagePrep(null);
    await prep.envoyer(
      { ok: true, charge: {} },
      () => api.post<PreparationRevue>("/api/agents/revues-contradictoires/preparation", {}),
      {
        messageSpecifique: messageAgents,
        apres: (r) => setMessagePrep(messagePreparation(r)),
      },
    );
  }

  async function declarer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const charge = chargeBriqueContradicteur(niveau);
    await decl.envoyer(
      charge
        ? { ok: true, charge }
        : { ok: false, erreurs: { niveau_max: "Choisissez un niveau." } },
      (c) => api.post("/api/agents/briques", c),
      {
        succes: `Brique « revue_contradictoire » confiée à l'agent contradicteur, au niveau ${niveau} au plus.`,
        messageSpecifique: messageAgents,
      },
    );
  }

  return (
    <div className="mp-pile">
      <form ref={prep.refFormulaire} className="mp-formulaire" noValidate onSubmit={preparer}>
        <RetourFormulaire
          erreur={prep.erreurGlobale}
          succes={messagePrep}
          refAlerte={prep.refAlerte}
        />
        <p className="mp-texte-petit mp-texte-doux">
          La préparation crée le prompt du cabinet et son jeu d'essai recommandé ; elle peut être
          relancée sans risque. Lancez ensuite l'évaluation de non-régression.
        </p>
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            variante="secondaire"
            chargement={prep.enCours}
            texteChargement="Préparation…"
          >
            Préparer la revue contradictoire
          </Bouton>
        </div>
      </form>
      <form ref={decl.refFormulaire} className="mp-formulaire" noValidate onSubmit={declarer}>
        <RetourFormulaire
          erreur={decl.erreurGlobale}
          succes={decl.succes}
          refAlerte={decl.refAlerte}
        />
        {declaree ? (
          <p className="mp-texte-petit mp-texte-doux">
            La brique « revue_contradictoire » est déjà confiée à l'agent : son niveau se décide
            dans le détail de la brique.
          </p>
        ) : (
          <>
            <Select
              libelle="Niveau d'autonomie maximal de la brique"
              aide="Analyse interne (R1) : la revue reste un brouillon IA non bloquant, lancé à la demande d'un consultant."
              required
              value={niveau}
              onChange={(e) => setNiveau(e.target.value)}
              options={NIVEAUX_CONTRADICTEUR.map((n) => ({
                valeur: n,
                libelle: libelleNiveauContradicteur(n),
              }))}
              erreur={decl.erreurs.niveau_max}
            />
            <div className="mp-actions-formulaire">
              <Bouton
                type="submit"
                variante="secondaire"
                chargement={decl.enCours}
                texteChargement="Enregistrement…"
              >
                Déclarer la brique
              </Bouton>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
