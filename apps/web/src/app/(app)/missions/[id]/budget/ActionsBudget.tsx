"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../components/ui/CaseACocher";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { api } from "../../../../../lib/api";
import { validerRevision, type ActionsBudget as Actions } from "../../../../../lib/budget";

export interface ActionsBudgetProps {
  missionId: string;
  actions: Actions;
  enCoursId: string | null;
  enCoursLibelle: string | null;
}

/** Révision (motif obligatoire), validation selon les droits et abandon (FIN-03, FIN-15). */
export function ActionsBudget({
  missionId,
  actions,
  enCoursId,
  enCoursLibelle,
}: ActionsBudgetProps) {
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [depuisDecoupage, setDepuisDecoupage] = useState(true);
  const f = useFormulaire<"motif">();
  const g = useFormulaire<never>();
  const base = `/api/missions/${encodeURIComponent(missionId)}/budget`;

  async function creer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRevision({ motif, depuis_decoupage: depuisDecoupage }),
      (c) => api.post(`${base}/revisions`, c),
      {
        succes: "Révision créée : elle attend la validation du directeur de mission.",
        apres: () => {
          setOuvert(false);
          setMotif("");
        },
      },
    );
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={g.erreurGlobale}
        succes={g.succes}
        refAlerte={g.refAlerte}
        titreErreur="Action impossible"
      />
      <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
      {enCoursId && (actions.valider || actions.abandonner) ? (
        <div className="mp-barre-actions">
          {actions.valider ? (
            <BoutonConfirmation
              libelle={`Valider ${enCoursLibelle ?? "la révision"}`}
              variante="primaire"
              icone="cadenas"
              question="Valider et figer cette révision ? Elle deviendra le budget de référence ; l'initial reste dans l'historique."
              libelleConfirmation="Oui, valider et figer"
              texteChargement="Validation…"
              action={() =>
                g.envoyer(
                  { ok: true, charge: null },
                  () => api.post(`${base}/versions/${encodeURIComponent(enCoursId)}/valider`),
                  { succes: "Révision validée et figée." },
                )
              }
            />
          ) : null}
          {actions.abandonner ? (
            <BoutonConfirmation
              libelle="Abandonner la révision"
              icone="corbeille"
              question="Abandonner cette révision en cours ? Elle sera supprimée ; les versions figées ne changent pas."
              libelleConfirmation="Oui, abandonner"
              texteChargement="Abandon…"
              action={() =>
                g.envoyer(
                  { ok: true, charge: null },
                  () => api.supprimer(`${base}/versions/${encodeURIComponent(enCoursId)}`),
                  { succes: "Révision abandonnée." },
                )
              }
            />
          ) : null}
        </div>
      ) : null}
      {enCoursId && actions.raisonValidation ? (
        <p className="mp-texte-doux">{actions.raisonValidation}</p>
      ) : null}
      {actions.reviser ? (
        ouvert ? (
          <form
            ref={f.refFormulaire}
            className="mp-formulaire mp-sous-formulaire"
            noValidate
            onSubmit={creer}
            aria-label="Demander une révision du budget"
          >
            <p className="mp-sous-formulaire__titre">Nouvelle révision du budget</p>
            <RetourFormulaire
              erreur={f.erreurGlobale}
              refAlerte={f.refAlerte}
              titreErreur="Révision impossible"
            />
            <ZoneTexte
              libelle="Motif de la révision"
              required
              maxLength={2000}
              rows={4}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              erreur={f.erreurs.motif}
              aide="Obligatoire : avenant client, réallocation entre phases, dérive constatée…"
            />
            <CaseACocher
              libelle="Recalculer depuis le découpage actuel"
              aide="Les jours budgétés des tâches remplacent ceux de la référence (prix de la référence conservés). Sinon, la référence est reprise telle quelle."
              checked={depuisDecoupage}
              onChange={(e) => setDepuisDecoupage(e.target.checked)}
            />
            <div className="mp-actions-formulaire">
              <Bouton type="submit" chargement={f.enCours} texteChargement="Création…">
                Créer la révision
              </Bouton>
              <Bouton variante="discret" onClick={() => setOuvert(false)}>
                Annuler
              </Bouton>
            </div>
          </form>
        ) : (
          <div>
            <Bouton variante="secondaire" icone="crayon" onClick={() => setOuvert(true)}>
              Demander une révision
            </Bouton>
          </div>
        )
      ) : actions.raison && !enCoursId ? (
        <p className="mp-texte-doux">{actions.raison}</p>
      ) : null}
    </div>
  );
}
