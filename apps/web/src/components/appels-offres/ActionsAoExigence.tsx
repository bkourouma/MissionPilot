"use client";

import { seg } from "./ActionsAoBouton";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CATEGORIE_EXIGENCE_AO_LIBELLES,
  CATEGORIES_EXIGENCE_AO,
  STATUT_CONFORMITE_AO_LIBELLES,
  STATUTS_CONFORMITE_AO,
  type StatutConformiteAo,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  messageAo,
  validerExigence,
  type ExigenceAo,
  type SaisieExigence,
} from "../../lib/appels-offres";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/** Ajout manuel d'une exigence à la matrice. */
export function FormulaireExigenceAo({ id }: { id: string }) {
  const f = useFormulaire<keyof SaisieExigence>();
  const vide: SaisieExigence = {
    libelle: "",
    categorie: "administrative",
    obligatoire: true,
    reference: "",
  };
  const [s, setS] = useState<SaisieExigence>(vide);
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.envoyer(
          validerExigence(s),
          (c) => api.post(`/api/appels-offres/${seg(id)}/exigences`, c),
          { messageSpecifique: messageAo },
        );
        if (ok) setS(vide);
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Ajout impossible"
      />
      <ZoneTexte
        libelle="Exigence"
        required
        maxLength={1000}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Catégorie"
          value={s.categorie}
          onChange={(e) => setS((x) => ({ ...x, categorie: e.target.value }))}
          options={CATEGORIES_EXIGENCE_AO.map((c) => ({
            valeur: c,
            libelle: CATEGORIE_EXIGENCE_AO_LIBELLES[c],
          }))}
          erreur={f.erreurs.categorie}
        />
        <Champ
          libelle="Référence (clause)"
          maxLength={60}
          value={s.reference}
          onChange={(e) => setS((x) => ({ ...x, reference: e.target.value }))}
          erreur={f.erreurs.reference}
        />
      </div>
      <CaseACocher
        libelle="Exigence obligatoire"
        checked={s.obligatoire}
        onChange={(e) => setS((x) => ({ ...x, obligatoire: e.target.checked }))}
      />
      <Bouton type="submit" variante="secondaire" chargement={f.enCours}>
        Ajouter l&apos;exigence
      </Bouton>
    </form>
  );
}

/** Suivi d'une ligne de la matrice : statut, commentaire, pièce justificative. */
export function SuiviExigenceAo({ exigence }: { exigence: ExigenceAo }) {
  const router = useRouter();
  const [statut, setStatut] = useState<StatutConformiteAo>(exigence.statut);
  const [commentaire, setCommentaire] = useState(exigence.commentaire ?? "");
  const [piece, setPiece] = useState(exigence.piece ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  return (
    <div className="mp-pile">
      <div className="mp-grille-champs">
        <Select
          libelle="Statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value as StatutConformiteAo)}
          options={STATUTS_CONFORMITE_AO.map((x) => ({
            valeur: x,
            libelle: STATUT_CONFORMITE_AO_LIBELLES[x],
          }))}
        />
        <Champ
          libelle="Pièce"
          maxLength={300}
          value={piece}
          onChange={(e) => setPiece(e.target.value)}
        />
      </div>
      <Champ
        libelle="Commentaire"
        maxLength={2000}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        aide={
          exigence.obligatoire && statut === "sans_objet"
            ? "Obligatoire : motivez l'écart."
            : undefined
        }
      />
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <Bouton
        variante="secondaire"
        chargement={enCours}
        onClick={async () => {
          setEnCours(true);
          setErreur(null);
          try {
            await api.patch(`/api/appels-offres/exigences/${seg(exigence.id)}`, {
              statut,
              commentaire: commentaire.trim() === "" ? null : commentaire,
              piece: piece.trim() === "" ? null : piece,
            });
            router.refresh();
          } catch (e) {
            setErreur(messageAo(e));
          } finally {
            setEnCours(false);
          }
        }}
      >
        Enregistrer
      </Bouton>
    </div>
  );
}
