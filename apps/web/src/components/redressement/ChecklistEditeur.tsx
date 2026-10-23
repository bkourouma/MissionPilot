"use client";

import { useState, type FormEvent } from "react";
import {
  RED_CHECKLIST_ITEMS_MAX,
  RED_DOMAINE_LIBELLES,
  RED_DOMAINES,
  type RedChecklistItemVue,
  type RedSecteur,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { OPTIONS_SECTEURS } from "../../lib/redressement";
import {
  CHEMIN_CHECKLISTS_MODELES,
  cheminVersionsModele,
  messageDiagnostic,
} from "../../lib/redressement-diagnostic";
import {
  corpsNouveauModele,
  corpsVersionModele,
  itemVide,
  saisieItemsDepuis,
  type SaisieItemModele,
} from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

const OPTIONS_DOMAINES = RED_DOMAINES.map((d) => ({ valeur: d, libelle: RED_DOMAINE_LIBELLES[d] }));

/**
 * Éditeur d'items d'un modèle de check-list (domaine, libellé, aide). Sert à créer un modèle
 * (première version en brouillon) ou une nouvelle version d'un modèle existant, qui part des
 * items de la version en vigueur. Le brouillon doit ensuite être publié (étape séparée).
 */
export function ChecklistEditeur({
  modeleId,
  secteurInitial,
  depart = [],
}: {
  /** Absent : création d'un nouveau modèle. */
  modeleId?: string;
  secteurInitial: RedSecteur;
  depart?: RedChecklistItemVue[];
}) {
  const f = useFormulaire<string>();
  const [code, setCode] = useState("");
  const [intitule, setIntitule] = useState("");
  const [secteur, setSecteur] = useState<RedSecteur>(secteurInitial);
  const [motif, setMotif] = useState("");
  const [items, setItems] = useState<SaisieItemModele[]>(() =>
    depart.length > 0 ? saisieItemsDepuis(depart) : [itemVide([])],
  );
  const maj = (i: number, patch: Partial<SaisieItemModele>) =>
    setItems((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const options = {
      succes: "Brouillon enregistré : publiez-le depuis la liste des versions.",
      messageSpecifique: messageDiagnostic,
    };
    if (modeleId) {
      await f.envoyer(
        corpsVersionModele(items, motif),
        (charge) => api.post(cheminVersionsModele(modeleId), charge),
        options,
      );
    } else {
      await f.envoyer(
        corpsNouveauModele({ code, intitule, secteur, motif }, items),
        (charge) => api.post(CHEMIN_CHECKLISTS_MODELES, charge),
        options,
      );
    }
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={modeleId ? "Nouvelle version du modèle" : "Nouveau modèle de check-list"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      {f.erreurs.global ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{f.erreurs.global}</p>
        </Alerte>
      ) : null}
      {modeleId ? null : (
        <div className="mp-grille-champs">
          <Champ
            libelle="Code du modèle"
            aide="Minuscules, chiffres, tiret ou tiret bas."
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            erreur={f.erreurs.code}
          />
          <Champ
            libelle="Intitulé"
            autoComplete="off"
            value={intitule}
            onChange={(e) => setIntitule(e.target.value)}
            erreur={f.erreurs.intitule}
          />
          <Select
            libelle="Secteur"
            value={secteur}
            options={OPTIONS_SECTEURS}
            onChange={(e) => setSecteur(e.target.value as RedSecteur)}
            erreur={f.erreurs.secteur}
          />
        </div>
      )}
      <ul className="mp-diag-liste" aria-label="Items du modèle">
        {items.map((it, i) => (
          <li key={it.id} className="mp-diag-item">
            <Champ
              libelle={`Libellé de l'item ${i + 1}`}
              autoComplete="off"
              value={it.libelle}
              onChange={(e) => maj(i, { libelle: e.target.value })}
              erreur={f.erreurs[`${i}.libelle`]}
            />
            <div className="mp-grille-champs">
              <Select
                libelle="Domaine"
                value={it.domaine}
                options={OPTIONS_DOMAINES}
                onChange={(e) => maj(i, { domaine: e.target.value as SaisieItemModele["domaine"] })}
              />
              <Champ
                libelle="Aide (facultative)"
                autoComplete="off"
                value={it.aide}
                onChange={(e) => maj(i, { aide: e.target.value })}
                erreur={f.erreurs[`${i}.aide`]}
              />
            </div>
            <div className="mp-actions-formulaire">
              <Bouton
                variante="discret"
                disabled={items.length <= 1}
                aria-label={`Retirer l'item ${i + 1}`}
                onClick={() => setItems((l) => l.filter((_, k) => k !== i))}
              >
                Retirer
              </Bouton>
            </div>
          </li>
        ))}
      </ul>
      <Champ
        libelle="Motif de la version (facultatif)"
        autoComplete="off"
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          disabled={items.length >= RED_CHECKLIST_ITEMS_MAX}
          onClick={() => setItems((l) => [...l, itemVide(l)])}
        >
          Ajouter un item
        </Bouton>
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer un brouillon
        </Bouton>
      </div>
    </form>
  );
}
