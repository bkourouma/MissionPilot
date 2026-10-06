"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { Tableau } from "../../../../components/ui/Tableau";
import { api } from "../../../../lib/api";
import type { TypeDocument } from "@missionpilot/shared";
import { formaterDateHeure } from "../../../../lib/format";
import {
  OPTIONS_TYPES_DOCUMENT,
  TYPE_DOCUMENT_LIBELLES,
  validerDocument,
  type DocumentMission,
  type SaisieDocument,
} from "../../../../lib/missions";

export interface DocumentsMissionProps {
  missionId: string;
  documents: DocumentMission[];
  /** Types que l'utilisateur peut déposer ; vide : pas de dépôt. */
  typesPermis: TypeDocument[];
}

const VIDE: SaisieDocument = { type: "livrable", nom: "", chemin_stockage: "" };

/** Documents de mission (SOC-05) : dernière version de chacun ; même nom → version suivante. */
export function DocumentsMission({ missionId, documents, typesPermis }: DocumentsMissionProps) {
  const peutDeposer = typesPermis.length > 0;
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieDocument>(VIDE);
  const f = useFormulaire<keyof SaisieDocument>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerDocument(s, typesPermis),
      (c) => api.post(`/api/missions/${encodeURIComponent(missionId)}/documents`, c),
      {
        succes: "Document enregistré.",
        apres: () => {
          setS(VIDE);
          setOuvert(false);
        },
      },
    );
  }

  return (
    <Carte
      titre="Documents"
      actions={
        peutDeposer && !ouvert ? (
          <Bouton variante="secondaire" icone="plus" onClick={() => setOuvert(true)}>
            Ajouter un document
          </Bouton>
        ) : null
      }
    >
      <div className="mp-pile">
        <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
        <Tableau
          legende="Documents de la mission"
          lignes={documents}
          cleLigne={(d) => d.id}
          messageVide="Aucun document. La lettre de mission est enregistrée automatiquement à la signature."
          colonnes={[
            {
              cle: "nom",
              entete: "Nom",
              rendu: (d) => <span className="mp-coupure">{d.nom}</span>,
            },
            { cle: "type", entete: "Type", rendu: (d) => TYPE_DOCUMENT_LIBELLES[d.type] },
            {
              cle: "version",
              entete: "Version",
              alignement: "droite",
              rendu: (d) => `v${d.version}`,
            },
            { cle: "auteur", entete: "Auteur", rendu: (d) => d.auteur_nom ?? "—" },
            { cle: "date", entete: "Déposé le", rendu: (d) => formaterDateHeure(d.cree_le) },
          ]}
        />
        {ouvert ? (
          <form
            ref={f.refFormulaire}
            className="mp-formulaire mp-sous-formulaire"
            noValidate
            onSubmit={soumettre}
            aria-label="Ajouter un document"
          >
            <p className="mp-sous-formulaire__titre">Ajouter un document</p>
            <p className="mp-texte-doux">
              Référence du document (le dépôt de fichier arrive dans une prochaine version). Un
              document de même type et de même nom devient sa version suivante.
            </p>
            <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
            <div className="mp-grille-champs">
              <Select
                libelle="Type"
                required
                options={OPTIONS_TYPES_DOCUMENT.filter((o) => typesPermis.includes(o.valeur))}
                value={s.type}
                onChange={(e) => setS((x) => ({ ...x, type: e.target.value }))}
                erreur={f.erreurs.type}
              />
              <Champ
                libelle="Nom"
                required
                maxLength={200}
                value={s.nom}
                onChange={(e) => setS((x) => ({ ...x, nom: e.target.value }))}
                erreur={f.erreurs.nom}
              />
              <Champ
                libelle="Emplacement (facultatif)"
                maxLength={500}
                value={s.chemin_stockage}
                onChange={(e) => setS((x) => ({ ...x, chemin_stockage: e.target.value }))}
                erreur={f.erreurs.chemin_stockage}
                aide="Chemin relatif dans l'espace documentaire (ex. livrables/rapport-v2.pdf)."
              />
            </div>
            <div className="mp-actions-formulaire">
              <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
                Enregistrer
              </Bouton>
              <Bouton variante="discret" onClick={() => setOuvert(false)}>
                Annuler
              </Bouton>
            </div>
          </form>
        ) : null}
      </div>
    </Carte>
  );
}
