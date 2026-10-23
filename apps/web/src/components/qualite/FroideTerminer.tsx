"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { cheminTerminer, messageFroide } from "../../lib/qualite-froide";
import {
  erreurChampAffichee,
  erreurGlobaleAffichee,
  validerTerminaison,
} from "../../lib/qualite-froide-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Fin de la revue : synthèse obligatoire, puis confirmation. Une revue terminée est figée ; le
 * score et la conclusion sont fixés par le moteur à cet instant, pas par le relecteur.
 */
export function FroideTerminer({ echantillonId }: { echantillonId: string }) {
  const f = useFormulaire<"synthese">();
  const [synthese, setSynthese] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  // L'erreur du champ vient du dernier envoi : elle ne vaut plus dès que la synthèse change ou
  // que le panneau de confirmation s'ouvre.
  const [erreurPerimee, setErreurPerimee] = useState(false);
  // Idem pour le bandeau d'erreur de l'API (ex. « grille incomplète ») : périmé dès que la synthèse
  // change ou que la confirmation s'ouvre ; remis à faux avant chaque nouvel envoi.
  const [globalePerimee, setGlobalePerimee] = useState(false);
  const validation = validerTerminaison(synthese);

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!confirmation) {
          if (validation.ok) {
            setErreurPerimee(true);
            setGlobalePerimee(true);
            setConfirmation(true);
          } else {
            setErreurPerimee(false);
            setGlobalePerimee(false);
            await f.envoyer(validation, async () => undefined);
          }
          return;
        }
        setErreurPerimee(false);
        setGlobalePerimee(false);
        const fait = await f.envoyer(
          validation,
          (charge) => api.post(cheminTerminer(echantillonId), charge),
          { succes: "Revue terminée et figée.", messageSpecifique: messageFroide },
        );
        if (!fait) setConfirmation(false);
      }}
    >
      <RetourFormulaire
        erreur={erreurGlobaleAffichee(f.erreurGlobale, globalePerimee)}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="La revue n'a pas pu être terminée"
      />
      <ZoneTexte
        libelle="Synthèse de la revue"
        required
        rows={5}
        maxLength={4000}
        value={synthese}
        onChange={(e) => {
          setSynthese(e.target.value);
          setErreurPerimee(true);
          setGlobalePerimee(true);
          setConfirmation(false);
        }}
        erreur={erreurChampAffichee(f.erreurs.synthese, erreurPerimee)}
        aide="Votre appréciation d'ensemble, à l'attention de l'associé. Elle sera figée avec la revue."
      />
      {confirmation ? (
        <Alerte tonalite="attention" titre="Terminer et figer cette revue ?" annonce="status">
          <p>
            Après confirmation, les notes, les constats et la synthèse ne pourront plus être
            modifiés. Le score et la conclusion seront calculés par le moteur.
          </p>
        </Alerte>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante={confirmation ? "danger" : "primaire"}
          chargement={f.enCours}
          texteChargement="Clôture de la revue…"
        >
          {confirmation ? "Oui, terminer la revue" : "Terminer la revue"}
        </Bouton>
        {confirmation ? (
          <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setConfirmation(false)}>
            Annuler
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}
