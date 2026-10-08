"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { messageMethodes } from "../../lib/methodes";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

/** Notes de version d'un brouillon (exigées à la publication dès la version 2). */
export function NotesVersion({ versionId, notes }: { versionId: string; notes: string | null }) {
  const f = useFormulaire<"notes">();
  const [texte, setTexte] = useState(notes ?? "");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      { ok: true, charge: { notes_version: texte.trim() || null } },
      (charge) => api.patch(`/api/methodes/versions/${versionId}`, charge),
      { succes: "Notes de version enregistrées.", messageSpecifique: messageMethodes },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle="Notes de version"
        rows={3}
        maxLength={4000}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        aide="Ce qui change et pourquoi : lues par le cabinet avant d'adopter la version."
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer les notes
        </Bouton>
      </div>
    </form>
  );
}
