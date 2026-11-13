"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { codeDepuisLibelle, messageMethodes, type EtapeVersion } from "../../lib/methodes";
import {
  saisieDepuisEtape,
  saisieEtapeVide,
  validerEtapeCreation,
  validerEtapeModification,
  type ChampEtape,
  type SaisieEtape,
} from "../../lib/methodes-editeur";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Étape du brouillon (STD-11) : ajout, ou modification en place si `etape` est fournie (le code
 * ne change pas).
 */
export function FormulaireEtape({ versionId, etape }: { versionId: string; etape?: EtapeVersion }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampEtape>();
  const [s, setS] = useState<SaisieEtape>(etape ? saisieDepuisEtape(etape) : saisieEtapeVide());
  const base = `/api/methodes/versions/${versionId}/etapes`;

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (etape) {
      await f.envoyer(
        validerEtapeModification(s, langue),
        (charge) => api.patch(`${base}/${etape.id}`, charge),
        {
          succes: t("Étape modifiée.", "Step updated."),
          messageSpecifique: (e) => messageMethodes(e, langue),
        },
      );
      return;
    }
    const ok = await f.envoyer(
      validerEtapeCreation(s, langue),
      (charge) => api.post(base, charge),
      {
        succes: t("Étape ajoutée.", "Step added."),
        messageSpecifique: (e) => messageMethodes(e, langue),
      },
    );
    if (ok) setS(saisieEtapeVide());
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Libellé de l'étape", "Step label")}
          required
          value={s.libelle}
          maxLength={200}
          onChange={(e) =>
            setS((x) => ({
              ...x,
              libelle: e.target.value,
              code: etape ? x.code : codeDepuisLibelle(e.target.value),
            }))
          }
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle={t("Code", "Code")}
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          readOnly={Boolean(etape)}
          aide={etape ? t("Le code ne change pas.", "The code does not change.") : undefined}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
      </div>
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={2}
        maxLength={2000}
        value={s.description}
        onChange={(e) => setS({ ...s, description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={etape ? "succes" : "plus"}
          chargement={f.enCours}
          texteChargement={etape ? t("Enregistrement…", "Saving…") : t("Ajout…", "Adding…")}
        >
          {etape ? t("Enregistrer l'étape", "Save the step") : t("Ajouter l'étape", "Add the step")}
        </Bouton>
      </div>
    </form>
  );
}
