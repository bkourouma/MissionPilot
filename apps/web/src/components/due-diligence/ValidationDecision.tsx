"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { messageDd } from "../../lib/due-diligence";
import { validerDecision } from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface ValidationDecisionProps {
  /** Route de validation (`/api/dd/verdicts/:id/validation` ou `/api/dd/notes/:id/validation`). */
  chemin: string;
  /** Champs fixes du corps (par exemple `{ version: 3 }` pour une note) : valeurs simples uniquement. */
  corps?: Record<string, number | string>;
  /** Objet validé, pour les libellés : « ce verdict », « cette version de la note ». */
  objet: string;
  succesValide: string;
  succesRejete: string;
}

/**
 * « Valider » / « Rejeter » une proposition (verdict, note) : un rejet se motive. L'affichage de ces
 * boutons suppose `dd.valider` et un valideur différent de l'auteur ; l'API reste seule juge
 * (séparation des tâches, doublée en base) et son refus s'affiche avec son message précis.
 */
export function ValidationDecision({
  chemin,
  corps = {},
  objet,
  succesValide,
  succesRejete,
}: ValidationDecisionProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const [rejet, setRejet] = useState(false);
  const refMotif = useRef<HTMLTextAreaElement>(null);

  // Le motif s'ouvre sous le bouton « Rejeter » : le curseur s'y place pour écrire sans chercher.
  useEffect(() => {
    if (rejet) refMotif.current?.focus();
  }, [rejet]);

  async function decider(decision: "valide" | "rejete") {
    await f.envoyer(
      validerDecision(decision, motif, langue),
      (charge) => api.post(chemin, { ...corps, ...charge }),
      {
        succes: decision === "valide" ? succesValide : succesRejete,
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => {
          setMotif("");
          setRejet(false);
        },
      },
    );
  }

  return (
    <div className="mp-formulaire">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Décision refusée", "Decision refused")}
      />
      {rejet ? (
        <ZoneTexte
          ref={refMotif}
          libelle={t(`Motif du rejet de ${objet}`, `Reason for rejecting ${objet}`)}
          required
          rows={2}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
          aide={t(
            "Un rejet se motive ; le motif est conservé.",
            "A rejection must be explained; the reason is kept.",
          )}
        />
      ) : null}
      <div className="mp-barre-actions">
        {rejet ? (
          <>
            <Bouton
              variante="danger"
              chargement={f.enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
              onClick={() => void decider("rejete")}
            >
              {t("Confirmer le rejet", "Confirm rejection")}
            </Bouton>
            <Bouton variante="discret" onClick={() => setRejet(false)}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </>
        ) : (
          <>
            <Bouton
              chargement={f.enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
              onClick={() => void decider("valide")}
            >
              {t("Valider", "Approve")}
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setRejet(true)}>
              {t("Rejeter", "Reject")}
            </Bouton>
          </>
        )}
      </div>
    </div>
  );
}
