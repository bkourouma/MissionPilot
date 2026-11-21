"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminNoeuds,
  cheminVersionNoeud,
  messageCascade,
  optionsStatut,
  SAISIE_NOEUD_VIDE,
  saisieDepuisNoeud,
  validerNoeud,
  type NoeudCascade,
  type SaisieNoeud,
  type TypeNoeudSaisi,
} from "../../lib/plan-cascade";
import { optionsResponsables, type PersonnePlan } from "../../lib/plan-elements";
import type { Resultat } from "../../lib/saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireNoeudCascadeProps {
  planId: string;
  type: TypeNoeudSaisi;
  personnes: readonly PersonnePlan[];
  /** Création sous ce parent (initiative pour un projet, projet pour un jalon)… */
  parentId?: string;
  /** … ou nouvelle version de ce nœud. */
  noeud?: NoeudCascade;
  libelleOuverture: string;
}

/**
 * Projet (sous une initiative) ou jalon (sous un projet) de la cascade (PLA-12) : création, ou
 * nouvelle version complète ; « Retirer » ajoute une version retirée (l'historique reste).
 */
export function FormulaireNoeudCascade({
  planId,
  type,
  personnes,
  parentId,
  noeud,
  libelleOuverture,
}: FormulaireNoeudCascadeProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<keyof SaisieNoeud>();
  const [ouvert, setOuvert] = useState(false);
  const initiale = () => (noeud ? saisieDepuisNoeud(noeud) : SAISIE_NOEUD_VIDE);
  const [s, setS] = useState<SaisieNoeud>(initiale);
  // Champs modifiés depuis le dernier envoi : leur erreur disparaît dès que la valeur redevient
  // valide, sans attendre un nouvel envoi du formulaire.
  const [modifies, setModifies] = useState<ReadonlySet<keyof SaisieNoeud>>(new Set());
  const controle = validerNoeud(type, s, langue).erreurs;
  const champ = (cle: keyof SaisieNoeud) => ({
    value: s[cle],
    onChange: (e: { target: { value: string } }) => {
      setS((x) => ({ ...x, [cle]: e.target.value }));
      setModifies((m) => new Set(m).add(cle));
    },
    erreur: modifies.has(cle) && !controle[cle] ? undefined : f.erreurs[cle],
  });

  async function enregistrer(retire: boolean): Promise<boolean> {
    setModifies(new Set());
    const v = validerNoeud(type, s, langue);
    const validation: Resultat<Record<string, unknown>, keyof SaisieNoeud> = v.donnees
      ? { ok: true, charge: v.donnees }
      : { ok: false, erreurs: v.erreurs };
    const ok = await f.envoyer(
      validation,
      (donnees) =>
        noeud
          ? api.post(cheminVersionNoeud(planId, noeud.id), { donnees, retire })
          : api.post(cheminNoeuds(planId), { type, parent_id: parentId, donnees }),
      {
        succes: retire
          ? t("Retiré de la cascade.", "Removed from the cascade.")
          : t("Enregistré.", "Saved."),
        messageSpecifique: (err) => messageCascade(err, langue),
      },
    );
    if (ok) {
      setOuvert(false);
      if (!noeud) setS(SAISIE_NOEUD_VIDE);
    }
    return ok;
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await enregistrer(false);
  }

  if (!ouvert) {
    return (
      <div className="mp-plan__section">
        <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
        <div className="mp-barre-actions">
          <Bouton
            variante="discret"
            icone={noeud ? "crayon" : "plus"}
            onClick={() => setOuvert(true)}
          >
            {libelleOuverture}
          </Bouton>
        </div>
      </div>
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={libelleOuverture}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement refusé", "Save refused")}
      />
      <div className="mp-grille-champs">
        <Champ libelle={t("Titre", "Title")} required maxLength={200} {...champ("titre")} />
        <Select
          libelle={t("Porteur", "Owner")}
          options={optionsResponsables(personnes, noeud?.porteur_id, langue)}
          {...champ("porteur_id")}
        />
        {type === "projet" ? (
          <Champ libelle={t("Début", "Start")} type="date" {...champ("debut")} />
        ) : null}
        <Champ libelle={t("Échéance", "Due date")} type="date" required {...champ("echeance")} />
        <Select
          libelle={t("Statut", "Status")}
          invite={
            type === "projet"
              ? t("À lancer (par défaut)", "To launch (default)")
              : t("Prévu (par défaut)", "Planned (default)")
          }
          options={optionsStatut(type, langue)}
          {...champ("statut")}
        />
      </div>
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={2}
        maxLength={5000}
        {...champ("description")}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
        {noeud ? (
          <BoutonConfirmation
            variante="danger"
            libelle={t("Retirer", "Remove")}
            ariaLabel={t(`Retirer : ${noeud.titre}`, `Remove: ${noeud.titre}`)}
            question={t(
              "Retirer ce contenu de la cascade ? Il reste dans l'historique des versions.",
              "Remove this item from the cascade? It stays in the version history.",
            )}
            libelleConfirmation={t("Oui, retirer", "Yes, remove")}
            texteChargement={t("Retrait…", "Removing…")}
            action={() => enregistrer(true)}
          />
        ) : null}
        <Bouton
          variante="secondaire"
          disabled={f.enCours}
          onClick={() => {
            setOuvert(false);
            setS(initiale());
          }}
        >
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
