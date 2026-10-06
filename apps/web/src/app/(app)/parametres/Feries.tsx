"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../components/ui/Alerte";
import { Bouton } from "../../../components/ui/Bouton";
import { CaseACocher } from "../../../components/ui/CaseACocher";
import { Champ } from "../../../components/ui/Champ";
import { api, messageErreur } from "../../../lib/api";
import { validerFerie, type Ferie, type SaisieFerie } from "../../../lib/cabinet";
import { formaterDate } from "../../../lib/format";

export function AjoutFerie({ annee }: { annee: number }) {
  const vide: SaisieFerie = { date: "", libelle: "", nationale: true };
  const [saisie, setSaisie] = useState<SaisieFerie>(vide);
  const f = useFormulaire<"date" | "libelle" | "nationale">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerFerie(saisie), (c) => api.post("/api/cabinet/feries", c), {
      succes: `Jour férié « ${saisie.libelle.trim()} » ajouté.`,
      apres: () => setSaisie(vide),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-labelledby="titre-ajout-ferie"
    >
      <h3 id="titre-ajout-ferie" className="mp-sous-formulaire__titre">
        Ajouter un jour férié
      </h3>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Ajout impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Date"
          type="date"
          name="date"
          required
          min={`${annee - 1}-01-01`}
          max={`${annee + 1}-12-31`}
          value={saisie.date}
          onChange={(e) => setSaisie((s) => ({ ...s, date: e.target.value }))}
          erreur={f.erreurs.date}
        />
        <Champ
          libelle="Nom du jour férié"
          name="libelle"
          required
          maxLength={120}
          value={saisie.libelle}
          onChange={(e) => setSaisie((s) => ({ ...s, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
          aide="Ex. Tabaski, Fête de l'Indépendance."
        />
      </div>
      <CaseACocher
        libelle="Fête nationale"
        aide="Décochez pour un jour chômé propre au cabinet (pont, fermeture annuelle)."
        checked={saisie.nationale}
        onChange={(e) => setSaisie((s) => ({ ...s, nationale: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter le jour férié
        </Bouton>
      </div>
    </form>
  );
}

export function SuppressionFerie({ ferie }: { ferie: Ferie }) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <div className="mp-liste-lignes__actions">
      <BoutonConfirmation
        libelle="Supprimer"
        ariaLabel={`Supprimer ${ferie.libelle} du ${formaterDate(ferie.date)}`}
        icone="corbeille"
        question={`Supprimer « ${ferie.libelle} » ?`}
        libelleConfirmation="Oui, supprimer"
        texteChargement="Suppression…"
        action={async () => {
          setErreur(null);
          try {
            await api.supprimer(`/api/cabinet/feries/${encodeURIComponent(ferie.id)}`);
            router.refresh();
          } catch (e) {
            setErreur(messageErreur(e));
            return false;
          }
        }}
      />
      {erreur ? (
        <Alerte tonalite="danger" titre="Suppression impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
