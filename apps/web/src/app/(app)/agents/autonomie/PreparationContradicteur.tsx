"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
        messageSpecifique: (e) => messageAgents(e, langue),
        apres: (r) => setMessagePrep(messagePreparation(r, langue)),
      },
    );
  }

  async function declarer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const charge = chargeBriqueContradicteur(niveau);
    await decl.envoyer(
      charge
        ? { ok: true, charge }
        : { ok: false, erreurs: { niveau_max: t("Choisissez un niveau.", "Choose a level.") } },
      (c) => api.post("/api/agents/briques", c),
      {
        succes: t(
          `Brique « revue_contradictoire » confiée à l'agent contradicteur, au niveau ${niveau} au plus.`,
          `Building block "revue_contradictoire" assigned to the contradictor agent, at level ${niveau} at most.`,
        ),
        messageSpecifique: (e) => messageAgents(e, langue),
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
          {t(
            "La préparation crée le prompt du cabinet et son jeu d'essai recommandé ; elle peut être relancée sans risque. Lancez ensuite l'évaluation de non-régression.",
            "The preparation creates the firm's prompt and its recommended test set; it can be run again safely. Then run the non-regression evaluation.",
          )}
        </p>
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            variante="secondaire"
            chargement={prep.enCours}
            texteChargement={t("Préparation…", "Preparing…")}
          >
            {t("Préparer la revue contradictoire", "Prepare the counter-analysis review")}
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
            {t(
              "La brique « revue_contradictoire » est déjà confiée à l'agent : son niveau se décide dans le détail de la brique.",
              'The building block "revue_contradictoire" is already assigned to the agent: its level is decided in the building block detail.',
            )}
          </p>
        ) : (
          <>
            <Select
              libelle={t(
                "Niveau d'autonomie maximal de la brique",
                "Maximum autonomy level of the building block",
              )}
              aide={t(
                "Analyse interne (R1) : la revue reste un brouillon IA non bloquant, lancé à la demande d'un consultant.",
                "Internal analysis (R1): the review remains a non-blocking AI draft, run at a consultant's request.",
              )}
              required
              value={niveau}
              onChange={(e) => setNiveau(e.target.value)}
              options={NIVEAUX_CONTRADICTEUR.map((n) => ({
                valeur: n,
                libelle: libelleNiveauContradicteur(n, langue),
              }))}
              erreur={decl.erreurs.niveau_max}
            />
            <div className="mp-actions-formulaire">
              <Bouton
                type="submit"
                variante="secondaire"
                chargement={decl.enCours}
                texteChargement={t("Enregistrement…", "Saving…")}
              >
                {t("Déclarer la brique", "Declare the building block")}
              </Bouton>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
