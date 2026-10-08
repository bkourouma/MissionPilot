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
  const f = useFormulaire<keyof SaisieNoeud>();
  const [ouvert, setOuvert] = useState(false);
  const initiale = () => (noeud ? saisieDepuisNoeud(noeud) : SAISIE_NOEUD_VIDE);
  const [s, setS] = useState<SaisieNoeud>(initiale);
  const champ = (cle: keyof SaisieNoeud) => ({
    value: s[cle],
    onChange: (e: { target: { value: string } }) => setS((x) => ({ ...x, [cle]: e.target.value })),
    erreur: f.erreurs[cle],
  });

  async function enregistrer(retire: boolean) {
    const v = validerNoeud(type, s);
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
        succes: retire ? "Retiré de la cascade." : "Enregistré.",
        messageSpecifique: messageCascade,
      },
    );
    if (ok) {
      setOuvert(false);
      if (!noeud) setS(SAISIE_NOEUD_VIDE);
    }
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
        titreErreur="Enregistrement refusé"
      />
      <div className="mp-grille-champs">
        <Champ libelle="Titre" required maxLength={200} {...champ("titre")} />
        <Select
          libelle="Porteur"
          options={optionsResponsables(personnes, noeud?.porteur_id)}
          {...champ("porteur_id")}
        />
        {type === "projet" ? <Champ libelle="Début" type="date" {...champ("debut")} /> : null}
        <Champ libelle="Échéance" type="date" required {...champ("echeance")} />
        <Select
          libelle="Statut"
          invite={type === "projet" ? "À lancer (par défaut)" : "Prévu (par défaut)"}
          options={optionsStatut(type)}
          {...champ("statut")}
        />
      </div>
      <ZoneTexte libelle="Description" rows={2} maxLength={5000} {...champ("description")} />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
        {noeud ? (
          <Bouton variante="danger" disabled={f.enCours} onClick={() => void enregistrer(true)}>
            Retirer
          </Bouton>
        ) : null}
        <Bouton
          variante="secondaire"
          disabled={f.enCours}
          onClick={() => {
            setOuvert(false);
            setS(initiale());
          }}
        >
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
