"use client";

import { useState, type FormEvent } from "react";
import type { RedChecklistItemVue, RedChecklistReponseVue } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { libelleDomaine } from "../../lib/redressement";
import {
  cheminReponsesChecklist,
  libelleReponseChecklist,
  messageDiagnostic,
  optionsReponsesChecklist,
} from "../../lib/redressement-diagnostic";
import {
  corpsReponses,
  saisieReponsesDepuis,
  type SaisieReponses,
} from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [saisie, setSaisie] = useState<SaisieReponses>(() => saisieReponsesDepuis(items, reponses));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsReponses(items, saisie, reponses, langue),
      async (lots) => {
        for (const lot of lots) await api.post(cheminReponsesChecklist(checklistId), lot);
      },
      {
        succes: t("Réponses enregistrées.", "Answers saved."),
        messageSpecifique: (e) => messageDiagnostic(e, langue),
      },
    );
  }

  if (lectureSeule) {
    return (
      <ul
        className="mp-diag-liste"
        aria-label={t("Réponses de la check-list", "Checklist answers")}
      >
        {items.map((i) => {
          const r = reponses.find((x) => x.item_id === i.id);
          return (
            <li key={i.id} className="mp-diag-item">
              <p className="mp-diag-item__titre">{i.libelle}</p>
              <p className="mp-texte-doux mp-texte-petit">{libelleDomaine(i.domaine, langue)}</p>
              <p>
                {r
                  ? libelleReponseChecklist(r.reponse, langue)
                  : t("Non renseigné", "Not filled in")}
                {r?.commentaire ? `${t(" : ", ": ")}${r.commentaire}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    );
  }

  const optionsReponses = optionsReponsesChecklist(langue);
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Réponses de la check-list", "Checklist answers")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Saving not possible")}
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
                {libelleDomaine(i.domaine, langue)}
                {i.aide ? ` · ${i.aide}` : ""}
              </p>
              <div className="mp-diag-reponses">
                {optionsReponses.map((o) => (
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
                libelle={t("Commentaire", "Comment")}
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
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer les réponses", "Save the answers")}
        </Bouton>
      </div>
    </form>
  );
}
