"use client";

import { BoutonActionAo, seg } from "./ActionsAoBouton";
import { useState } from "react";
import { api } from "../../lib/api";
import {
  libelleCategorie,
  messageAo,
  validerTexteDossier,
  type ExtractionAo,
} from "../../lib/appels-offres";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { ZoneTexte } from "../ui/ZoneTexte";

/** Dépôt du texte du dossier d'appel d'offres (contenu non fiable, jamais suivi). */
export function FormulaireDossierAo({ id }: { id: string }) {
  const f = useFormulaire<"texte">();
  const [texte, setTexte] = useState("");
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.envoyer(
          validerTexteDossier(texte),
          (t) => api.post(`/api/appels-offres/${seg(id)}/dossiers`, { texte: t }),
          { messageSpecifique: messageAo, succes: "Dossier enregistré." },
        );
        if (ok) setTexte("");
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Dossier refusé"
      />
      <ZoneTexte
        libelle="Texte du dossier (règlement, termes de référence)"
        rows={8}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={f.erreurs.texte}
        aide="Collez le texte (200 000 caractères au plus). Il est traité comme une donnée : aucune consigne qu'il contient n'est suivie."
      />
      <Bouton type="submit" chargement={f.enCours}>
        Enregistrer le dossier
      </Bouton>
    </form>
  );
}

/** Extraction des exigences d'un dossier : IA (brouillon) ou découpage déterministe. */
export function LancerExtractionAo({
  id,
  dossierId,
  ia,
}: {
  id: string;
  dossierId: string;
  ia: boolean;
}) {
  return (
    <div className="mp-ao__actions">
      {ia ? (
        <BoutonActionAo
          variante="primaire"
          action={() =>
            api.post(`/api/appels-offres/${seg(id)}/extractions`, {
              dossier_id: dossierId,
              mode: "ia",
            })
          }
        >
          Extraire avec l&apos;IA
        </BoutonActionAo>
      ) : null}
      <BoutonActionAo
        action={() =>
          api.post(`/api/appels-offres/${seg(id)}/extractions`, {
            dossier_id: dossierId,
            mode: "deterministe",
          })
        }
      >
        Découpage automatique
      </BoutonActionAo>
    </div>
  );
}

/** Validation humaine d'un brouillon d'extraction : les propositions cochées entrent dans la matrice. */
export function ValidationExtractionAo({ extraction }: { extraction: ExtractionAo }) {
  const [retenues, setRetenues] = useState<number[]>(extraction.propositions.map((_, i) => i));
  const [acquitte, setAcquitte] = useState(false);
  const url = `/api/appels-offres/extractions/${seg(extraction.id)}/decision`;
  return (
    <div className="mp-pile">
      <ul className="mp-liste-lignes">
        {extraction.propositions.map((p, i) => (
          <li key={i} className="mp-liste-lignes__ligne">
            <CaseACocher
              libelle={`${p.reference ? `[${p.reference}] ` : ""}${p.libelle}`}
              aide={`${libelleCategorie(p.categorie)} · ${p.obligatoire ? "obligatoire" : "facultative"}`}
              checked={retenues.includes(i)}
              onChange={(e) =>
                setRetenues((r) =>
                  e.target.checked ? [...r, i].sort((a, b) => a - b) : r.filter((x) => x !== i),
                )
              }
            />
          </li>
        ))}
      </ul>
      {extraction.chiffres_non_verifies ? (
        <CaseACocher
          libelle="J'ai relu les nombres cités par le brouillon et je les assume"
          aide="Le brouillon IA contient des nombres que le contrôle n'a pas pu vérifier."
          checked={acquitte}
          onChange={(e) => setAcquitte(e.target.checked)}
        />
      ) : null}
      <div className="mp-ao__actions">
        <BoutonActionAo
          variante="primaire"
          action={() =>
            api.post(url, {
              decision: "validee",
              retenues,
              ...(extraction.chiffres_non_verifies ? { acquitte_chiffres: acquitte } : {}),
            })
          }
        >
          Valider {retenues.length} exigence(s)
        </BoutonActionAo>
        <BoutonActionAo variante="danger" action={() => api.post(url, { decision: "rejetee" })}>
          Rejeter le brouillon
        </BoutonActionAo>
      </div>
    </div>
  );
}
