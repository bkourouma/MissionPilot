"use client";

import { useState, type FormEvent } from "react";
import {
  RED_CHECKLIST_ITEMS_MAX,
  RED_DOMAINES,
  type RedChecklistItemVue,
  type RedSecteur,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { libelleDomaine, optionsSecteurs } from "../../lib/redressement";
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [code, setCode] = useState("");
  const [intitule, setIntitule] = useState("");
  const [secteur, setSecteur] = useState<RedSecteur>(secteurInitial);
  const [motif, setMotif] = useState("");
  const [items, setItems] = useState<SaisieItemModele[]>(() =>
    depart.length > 0 ? saisieItemsDepuis(depart) : [itemVide([])],
  );
  const optionsDomaines = RED_DOMAINES.map((d) => ({
    valeur: d,
    libelle: libelleDomaine(d, langue),
  }));
  const maj = (i: number, patch: Partial<SaisieItemModele>) =>
    setItems((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const options = {
      succes: t(
        "Brouillon enregistré : publiez-le depuis la liste des versions.",
        "Draft saved: publish it from the version list.",
      ),
      messageSpecifique: (e: unknown) => messageDiagnostic(e, langue),
    };
    if (modeleId) {
      await f.envoyer(
        corpsVersionModele(items, motif, langue),
        (charge) => api.post(cheminVersionsModele(modeleId), charge),
        options,
      );
    } else {
      await f.envoyer(
        corpsNouveauModele({ code, intitule, secteur, motif }, items, langue),
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
      aria-label={
        modeleId
          ? t("Nouvelle version du modèle", "New template version")
          : t("Nouveau modèle de check-list", "New checklist template")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Saving not possible")}
      />
      {f.erreurs.global ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{f.erreurs.global}</p>
        </Alerte>
      ) : null}
      {modeleId ? null : (
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Code du modèle", "Template code")}
            aide={t(
              "Minuscules, chiffres, tiret ou tiret bas.",
              "Lowercase letters, digits, hyphen or underscore.",
            )}
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            erreur={f.erreurs.code}
          />
          <Champ
            libelle={t("Intitulé", "Title")}
            autoComplete="off"
            value={intitule}
            onChange={(e) => setIntitule(e.target.value)}
            erreur={f.erreurs.intitule}
          />
          <Select
            libelle={t("Secteur", "Sector")}
            value={secteur}
            options={optionsSecteurs(langue)}
            onChange={(e) => setSecteur(e.target.value as RedSecteur)}
            erreur={f.erreurs.secteur}
          />
        </div>
      )}
      <ul className="mp-diag-liste" aria-label={t("Items du modèle", "Template items")}>
        {items.map((it, i) => (
          <li key={it.id} className="mp-diag-item">
            <Champ
              libelle={t(`Libellé de l'item ${i + 1}`, `Label of item ${i + 1}`)}
              autoComplete="off"
              value={it.libelle}
              onChange={(e) => maj(i, { libelle: e.target.value })}
              erreur={f.erreurs[`${i}.libelle`]}
            />
            <div className="mp-grille-champs">
              <Select
                libelle={t("Domaine", "Area")}
                value={it.domaine}
                options={optionsDomaines}
                onChange={(e) => maj(i, { domaine: e.target.value as SaisieItemModele["domaine"] })}
              />
              <Champ
                libelle={t("Aide (facultative)", "Help (optional)")}
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
                aria-label={t(`Retirer l'item ${i + 1}`, `Remove item ${i + 1}`)}
                onClick={() => setItems((l) => l.filter((_, k) => k !== i))}
              >
                {t("Retirer", "Remove")}
              </Bouton>
            </div>
          </li>
        ))}
      </ul>
      <Champ
        libelle={t("Motif de la version (facultatif)", "Version reason (optional)")}
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
          {t("Ajouter un item", "Add an item")}
        </Bouton>
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer un brouillon", "Save a draft")}
        </Bouton>
      </div>
    </form>
  );
}
