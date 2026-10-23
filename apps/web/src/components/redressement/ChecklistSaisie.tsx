"use client";

import { useState, type FormEvent } from "react";
import type { RedChecklistItemVue, RedChecklistReponseVue } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { libelleDomaine } from "../../lib/redressement";
import {
  cheminReponsesChecklist,
  libelleReponseChecklist,
  messageDiagnostic,
  OPTIONS_REPONSES_CHECKLIST,
} from "../../lib/redressement-diagnostic";
import {
  corpsReponses,
  saisieReponsesDepuis,
  type SaisieReponses,
} from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";

/**
 * Saisie des réponses d'une check-list : oui / non / partiellement / sans objet et un commentaire
 * par item. Seules les réponses modifiées partent, par lots de 40 au plus. En lecture seule, la
 * réponse courante est affichée sans champ. Monter avec une `key` qui change quand les réponses
 * du serveur changent.
 */
export function ChecklistSaisie({
  checklistId,
  items,
  reponses,
  lectureSeule,
}: {
  checklistId: string;
  items: RedChecklistItemVue[];
  reponses: RedChecklistReponseVue[];
  lectureSeule: boolean;
}) {
  const f = useFormulaire<string>();
  const [saisie, setSaisie] = useState<SaisieReponses>(() => saisieReponsesDepuis(items, reponses));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsReponses(items, saisie, reponses),
      async (lots) => {
        for (const lot of lots) await api.post(cheminReponsesChecklist(checklistId), lot);
      },
      { succes: "Réponses enregistrées.", messageSpecifique: messageDiagnostic },
    );
  }

  if (lectureSeule) {
    return (
      <ul className="mp-diag-liste" aria-label="Réponses de la check-list">
        {items.map((i) => {
          const r = reponses.find((x) => x.item_id === i.id);
          return (
            <li key={i.id} className="mp-diag-item">
              <p className="mp-diag-item__titre">{i.libelle}</p>
              <p className="mp-texte-doux mp-texte-petit">{libelleDomaine(i.domaine)}</p>
              <p>
                {r ? libelleReponseChecklist(r.reponse) : "Non renseigné"}
                {r?.commentaire ? ` : ${r.commentaire}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Réponses de la check-list"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      {f.erreurs.global ? (
        <Alerte tonalite="info" annonce="status">
          <p>{f.erreurs.global}</p>
        </Alerte>
      ) : null}
      <div className="mp-diag-liste">
        {items.map((i) => {
          const s = saisie[i.id] ?? { reponse: "", commentaire: "" };
          const nom = `reponse-${checklistId}-${i.id}`;
          return (
            <fieldset key={i.id} className="mp-diag-item">
              <legend className="mp-diag-item__titre">{i.libelle}</legend>
              <p className="mp-texte-doux mp-texte-petit">
                {libelleDomaine(i.domaine)}
                {i.aide ? ` · ${i.aide}` : ""}
              </p>
              <div className="mp-diag-reponses">
                {OPTIONS_REPONSES_CHECKLIST.map((o) => (
                  <label key={o.valeur}>
                    <input
                      type="radio"
                      name={nom}
                      value={o.valeur}
                      checked={s.reponse === o.valeur}
                      onChange={() =>
                        setSaisie((x) => ({ ...x, [i.id]: { ...s, reponse: o.valeur } }))
                      }
                    />
                    <span>{o.libelle}</span>
                  </label>
                ))}
              </div>
              <Champ
                libelle="Commentaire"
                autoComplete="off"
                value={s.commentaire}
                onChange={(e) =>
                  setSaisie((x) => ({ ...x, [i.id]: { ...s, commentaire: e.target.value } }))
                }
                erreur={f.erreurs[i.id]}
              />
            </fieldset>
          );
        })}
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer les réponses
        </Bouton>
      </div>
    </form>
  );
}
