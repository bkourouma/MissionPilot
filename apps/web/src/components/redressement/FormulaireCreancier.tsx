"use client";

import { useState, type FormEvent } from "react";
import {
  RED_CATEGORIES_CREANCIER,
  type RedCategorieCreancier,
  type RedCreancierVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import {
  cheminCreancier,
  cheminCreances,
  cheminCreanciers,
  libelleCategorieCreancier,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

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
  const t = useT();
  const langue = useLangue();
  const OPTIONS_CATEGORIES = RED_CATEGORIES_CREANCIER.map((c) => ({
    valeur: c,
    libelle: libelleCategorieCreancier(c, langue),
  }));
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
      corpsCreancierDepuisFormulaire(s, devise, langue),
      (charge) => api.post<RedCreancierVue>(cheminCreanciers(dossierId), charge),
      {
        succes: t("Créancier ajouté.", "Creditor added."),
        messageSpecifique: (e) => messageRedressement(e, langue),
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
      aria-label={t("Ajouter un créancier", "Add a creditor")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Ajout impossible", "Could not add")}
      />
      <p className="mp-texte-doux">{aideMontant(devise, langue)}</p>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Nom du créancier", "Creditor name")}
          required
          maxLength={200}
          autoComplete="off"
          value={s.nom}
          onChange={(e) => setS((x) => ({ ...x, nom: e.target.value }))}
          erreur={f.erreurs.nom}
        />
        <Select
          libelle={t("Catégorie", "Category")}
          value={s.categorie}
          onChange={(e) =>
            setS((x) => ({ ...x, categorie: e.target.value as RedCategorieCreancier }))
          }
          options={OPTIONS_CATEGORIES}
        />
        <Champ
          libelle={t("Référence (facultatif)", "Reference (optional)")}
          maxLength={120}
          autoComplete="off"
          value={s.reference}
          onChange={(e) => setS((x) => ({ ...x, reference: e.target.value }))}
          erreur={f.erreurs.reference}
        />
        <Champ
          libelle={t("Principal dû", "Principal due")}
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.principal}
          onChange={(e) => setS((x) => ({ ...x, principal: e.target.value }))}
          erreur={f.erreurs.principal}
        />
        <Champ
          libelle={t("Intérêts et pénalités", "Interest and penalties")}
          inputMode="decimal"
          autoComplete="off"
          value={s.interets}
          onChange={(e) => setS((x) => ({ ...x, interets: e.target.value }))}
          erreur={f.erreurs.interets}
        />
        <Champ
          libelle={t("Date d'arrêté de la créance", "Claim cut-off date")}
          type="date"
          required
          value={s.date_arrete}
          onChange={(e) => setS((x) => ({ ...x, date_arrete: e.target.value }))}
          erreur={f.erreurs.date_arrete}
        />
        <Champ
          libelle={t("Échéance initiale (facultative)", "Initial due date (optional)")}
          type="date"
          value={s.echeance_initiale}
          onChange={(e) => setS((x) => ({ ...x, echeance_initiale: e.target.value }))}
          erreur={f.erreurs.echeance_initiale}
        />
        <Champ
          libelle={t("Nature de la créance (facultatif)", "Nature of the claim (optional)")}
          maxLength={200}
          autoComplete="off"
          value={s.nature}
          onChange={(e) => setS((x) => ({ ...x, nature: e.target.value }))}
          erreur={f.erreurs.nature}
        />
      </div>
      <CaseACocher
        libelle={t(
          "Créance garantie (sûreté, hypothèque, caution…)",
          "Secured claim (security, mortgage, guarantee…)",
        )}
        checked={s.garanti}
        onChange={(e) => setS((x) => ({ ...x, garanti: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Ajout…", "Adding…")}>
          {t("Ajouter le créancier", "Add the creditor")}
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
  const t = useT();
  const langue = useLangue();
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
      corpsCreanceDepuisFormulaire(s, devise, langue),
      (charge) => api.post<RedCreancierVue>(cheminCreances(creancierId), charge),
      {
        succes: t(
          "Créance mise à jour : l'ancienne version reste dans l'historique.",
          "Claim updated: the previous version stays in the history.",
        ),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Mettre à jour la créance", "Update the claim")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Mise à jour impossible", "Could not update")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Principal dû", "Principal due")}
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.principal}
          onChange={(e) => setS((x) => ({ ...x, principal: e.target.value }))}
          erreur={f.erreurs.principal}
          aide={aideMontant(devise, langue)}
        />
        <Champ
          libelle={t("Intérêts et pénalités", "Interest and penalties")}
          inputMode="decimal"
          autoComplete="off"
          value={s.interets}
          onChange={(e) => setS((x) => ({ ...x, interets: e.target.value }))}
          erreur={f.erreurs.interets}
        />
        <Champ
          libelle={t("Date d'arrêté", "Cut-off date")}
          type="date"
          required
          value={s.date_arrete}
          onChange={(e) => setS((x) => ({ ...x, date_arrete: e.target.value }))}
          erreur={f.erreurs.date_arrete}
        />
        <Champ
          libelle={t("Échéance initiale", "Initial due date")}
          type="date"
          value={s.echeance_initiale}
          onChange={(e) => setS((x) => ({ ...x, echeance_initiale: e.target.value }))}
          erreur={f.erreurs.echeance_initiale}
        />
        <Champ
          libelle={t("Nature", "Nature")}
          maxLength={200}
          autoComplete="off"
          value={s.nature}
          onChange={(e) => setS((x) => ({ ...x, nature: e.target.value }))}
          erreur={f.erreurs.nature}
        />
      </div>
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
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
          texteChargement={t("Mise à jour…", "Updating…")}
        >
          {t("Mettre à jour la créance", "Update the claim")}
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"nom">();
  const [s, setS] = useState({ nom, reference: reference ?? "", garanti, actif });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = s.nom.trim();
    const validation: Resultat<Record<string, unknown>, "nom"> = n === "" || n.length > 200
      ? {
          ok: false,
          erreurs: {
            nom: t(
              "Saisissez un nom de 200 caractères au plus.",
              "Enter a name of 200 characters at most.",
            ),
          },
        }
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
        succes: t("Créancier modifié.", "Creditor updated."),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Modifier le créancier", "Edit the creditor")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Modification refusée", "Edit refused")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Nom du créancier", "Creditor name")}
          required
          maxLength={200}
          autoComplete="off"
          value={s.nom}
          onChange={(e) => setS((x) => ({ ...x, nom: e.target.value }))}
          erreur={f.erreurs.nom}
        />
        <Champ
          libelle={t("Référence", "Reference")}
          maxLength={120}
          autoComplete="off"
          value={s.reference}
          onChange={(e) => setS((x) => ({ ...x, reference: e.target.value }))}
        />
      </div>
      <CaseACocher
        libelle={t("Créance garantie", "Secured claim")}
        checked={s.garanti}
        onChange={(e) => setS((x) => ({ ...x, garanti: e.target.checked }))}
      />
      <CaseACocher
        libelle={t("Créancier actif", "Active creditor")}
        aide={t(
          "Un créancier inactif sort des totaux ; son historique est conservé.",
          "An inactive creditor is left out of the totals; its history is kept.",
        )}
        checked={s.actif}
        onChange={(e) => setS((x) => ({ ...x, actif: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
      </div>
    </form>
  );
}
