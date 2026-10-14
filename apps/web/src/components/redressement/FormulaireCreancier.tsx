"use client";

import { useState, type FormEvent } from "react";
import {
  RED_CATEGORIES_CREANCIER,
  RED_CATEGORIE_CREANCIER_LIBELLES,
  type RedCategorieCreancier,
  type RedCreancierVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import {
  cheminCreancier,
  cheminCreances,
  cheminCreanciers,
  messageRedressement,
} from "../../lib/redressement";
import {
  corpsCreanceDepuisFormulaire,
  corpsCreancierDepuisFormulaire,
  montantVersTexte,
  type ChampCreance,
  type ChampCreancier,
  type SaisieCreance,
  type SaisieCreancier,
} from "../../lib/redressement-saisie";
import { aideMontant, type Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_CATEGORIES = RED_CATEGORIES_CREANCIER.map((c) => ({
  valeur: c,
  libelle: RED_CATEGORIE_CREANCIER_LIBELLES[c],
}));

/** « Ajouter un créancier » : le créancier et sa créance n° 1 sont créés ensemble. */
export function FormulaireCreancier({
  dossierId,
  devise,
  aujourdhui,
}: {
  dossierId: string;
  devise: Devise;
  aujourdhui: string;
}) {
  const f = useFormulaire<ChampCreancier>();
  const [s, setS] = useState<SaisieCreancier>({
    nom: "",
    categorie: "fournisseur",
    garanti: false,
    reference: "",
    principal: "",
    interets: "",
    date_arrete: aujourdhui,
    echeance_initiale: "",
    nature: "",
  });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsCreancierDepuisFormulaire(s, devise),
      (charge) => api.post<RedCreancierVue>(cheminCreanciers(dossierId), charge),
      {
        succes: "Créancier ajouté.",
        messageSpecifique: messageRedressement,
        apres: () =>
          setS((x) => ({
            ...x,
            nom: "",
            reference: "",
            principal: "",
            interets: "",
            echeance_initiale: "",
            nature: "",
          })),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Ajouter un créancier"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Ajout impossible"
      />
      <p className="mp-texte-doux">{aideMontant(devise)}</p>
      <div className="mp-grille-champs">
        <Champ
          libelle="Nom du créancier"
          required
          maxLength={200}
          autoComplete="off"
          value={s.nom}
          onChange={(e) => setS((x) => ({ ...x, nom: e.target.value }))}
          erreur={f.erreurs.nom}
        />
        <Select
          libelle="Catégorie"
          value={s.categorie}
          onChange={(e) =>
            setS((x) => ({ ...x, categorie: e.target.value as RedCategorieCreancier }))
          }
          options={OPTIONS_CATEGORIES}
        />
        <Champ
          libelle="Référence (facultatif)"
          maxLength={120}
          autoComplete="off"
          value={s.reference}
          onChange={(e) => setS((x) => ({ ...x, reference: e.target.value }))}
          erreur={f.erreurs.reference}
        />
        <Champ
          libelle="Principal dû"
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.principal}
          onChange={(e) => setS((x) => ({ ...x, principal: e.target.value }))}
          erreur={f.erreurs.principal}
        />
        <Champ
          libelle="Intérêts et pénalités"
          inputMode="decimal"
          autoComplete="off"
          value={s.interets}
          onChange={(e) => setS((x) => ({ ...x, interets: e.target.value }))}
          erreur={f.erreurs.interets}
        />
        <Champ
          libelle="Date d'arrêté de la créance"
          type="date"
          required
          value={s.date_arrete}
          onChange={(e) => setS((x) => ({ ...x, date_arrete: e.target.value }))}
          erreur={f.erreurs.date_arrete}
        />
        <Champ
          libelle="Échéance initiale (facultative)"
          type="date"
          value={s.echeance_initiale}
          onChange={(e) => setS((x) => ({ ...x, echeance_initiale: e.target.value }))}
          erreur={f.erreurs.echeance_initiale}
        />
        <Champ
          libelle="Nature de la créance (facultatif)"
          maxLength={200}
          autoComplete="off"
          value={s.nature}
          onChange={(e) => setS((x) => ({ ...x, nature: e.target.value }))}
          erreur={f.erreurs.nature}
        />
      </div>
      <CaseACocher
        libelle="Créance garantie (sûreté, hypothèque, caution…)"
        checked={s.garanti}
        onChange={(e) => setS((x) => ({ ...x, garanti: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter le créancier
        </Bouton>
      </div>
    </form>
  );
}

/** « Mettre à jour la créance » : une nouvelle version de la créance (ajout seul). */
export function FormulaireCreance({
  creancierId,
  devise,
  courante,
}: {
  creancierId: string;
  devise: Devise;
  courante: {
    principal: number;
    interets: number;
    date_arrete: string;
    echeance_initiale: string | null;
    nature: string | null;
  };
}) {
  const f = useFormulaire<ChampCreance>();
  const [s, setS] = useState<SaisieCreance>({
    principal: montantVersTexte(courante.principal, devise),
    interets: montantVersTexte(courante.interets, devise),
    date_arrete: courante.date_arrete,
    echeance_initiale: courante.echeance_initiale ?? "",
    nature: courante.nature ?? "",
    commentaire: "",
  });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsCreanceDepuisFormulaire(s, devise),
      (charge) => api.post<RedCreancierVue>(cheminCreances(creancierId), charge),
      {
        succes: "Créance mise à jour : l'ancienne version reste dans l'historique.",
        messageSpecifique: messageRedressement,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Mettre à jour la créance"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Mise à jour impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Principal dû"
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.principal}
          onChange={(e) => setS((x) => ({ ...x, principal: e.target.value }))}
          erreur={f.erreurs.principal}
          aide={aideMontant(devise)}
        />
        <Champ
          libelle="Intérêts et pénalités"
          inputMode="decimal"
          autoComplete="off"
          value={s.interets}
          onChange={(e) => setS((x) => ({ ...x, interets: e.target.value }))}
          erreur={f.erreurs.interets}
        />
        <Champ
          libelle="Date d'arrêté"
          type="date"
          required
          value={s.date_arrete}
          onChange={(e) => setS((x) => ({ ...x, date_arrete: e.target.value }))}
          erreur={f.erreurs.date_arrete}
        />
        <Champ
          libelle="Échéance initiale"
          type="date"
          value={s.echeance_initiale}
          onChange={(e) => setS((x) => ({ ...x, echeance_initiale: e.target.value }))}
          erreur={f.erreurs.echeance_initiale}
        />
        <Champ
          libelle="Nature"
          maxLength={200}
          autoComplete="off"
          value={s.nature}
          onChange={(e) => setS((x) => ({ ...x, nature: e.target.value }))}
          erreur={f.erreurs.nature}
        />
      </div>
      <ZoneTexte
        libelle="Commentaire (facultatif)"
        maxLength={1000}
        value={s.commentaire}
        onChange={(e) => setS((x) => ({ ...x, commentaire: e.target.value }))}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Mise à jour…"
        >
          Mettre à jour la créance
        </Bouton>
      </div>
    </form>
  );
}

/** Nom, référence, caractère garanti et activité du créancier. */
export function FormulaireModificationCreancier({
  creancierId,
  nom,
  reference,
  garanti,
  actif,
}: {
  creancierId: string;
  nom: string;
  reference: string | null;
  garanti: boolean;
  actif: boolean;
}) {
  const f = useFormulaire<"nom">();
  const [s, setS] = useState({ nom, reference: reference ?? "", garanti, actif });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = s.nom.trim();
    const validation: Resultat<Record<string, unknown>, "nom"> = n === "" || n.length > 200
      ? { ok: false, erreurs: { nom: "Saisissez un nom de 200 caractères au plus." } }
      : {
          ok: true,
          charge: {
            nom: n,
            reference: s.reference.trim() === "" ? undefined : s.reference.trim(),
            garanti: s.garanti,
            actif: s.actif,
          },
        };
    await f.envoyer(
      validation,
      (charge) => api.patch<RedCreancierVue>(cheminCreancier(creancierId), charge),
      {
        succes: "Créancier modifié.",
        messageSpecifique: messageRedressement,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Modifier le créancier"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Modification refusée"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Nom du créancier"
          required
          maxLength={200}
          autoComplete="off"
          value={s.nom}
          onChange={(e) => setS((x) => ({ ...x, nom: e.target.value }))}
          erreur={f.erreurs.nom}
        />
        <Champ
          libelle="Référence"
          maxLength={120}
          autoComplete="off"
          value={s.reference}
          onChange={(e) => setS((x) => ({ ...x, reference: e.target.value }))}
        />
      </div>
      <CaseACocher
        libelle="Créance garantie"
        checked={s.garanti}
        onChange={(e) => setS((x) => ({ ...x, garanti: e.target.checked }))}
      />
      <CaseACocher
        libelle="Créancier actif"
        aide="Un créancier inactif sort des totaux ; son historique est conservé."
        checked={s.actif}
        onChange={(e) => setS((x) => ({ ...x, actif: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}
