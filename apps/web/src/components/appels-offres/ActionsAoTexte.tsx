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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { ZoneTexte } from "../ui/ZoneTexte";

/** Dépôt du texte du dossier d'appel d'offres (contenu non fiable, jamais suivi). */
export function FormulaireDossierAo({ id }: { id: string }) {
  const t = useT();
  const langue = useLangue();
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
          validerTexteDossier(texte, langue),
          (valide) => api.post(`/api/appels-offres/${seg(id)}/dossiers`, { texte: valide }),
          {
            messageSpecifique: (err) => messageAo(err, langue),
            succes: t("Dossier enregistré.", "Document saved."),
          },
        );
        if (ok) setTexte("");
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Dossier refusé", "Document rejected")}
      />
      <ZoneTexte
        libelle={t(
          "Texte du dossier (règlement, termes de référence)",
          "Tender document text (rules, terms of reference)",
        )}
        rows={8}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={f.erreurs.texte}
        aide={t(
          "Collez le texte (200 000 caractères au plus). Il est traité comme une donnée : aucune consigne qu'il contient n'est suivie.",
          "Paste the text (200,000 characters at most). It is treated as data: no instruction it contains is followed.",
        )}
      />
      <Bouton type="submit" chargement={f.enCours}>
        {t("Enregistrer le dossier", "Save the document")}
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
  const t = useT();
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
          {t("Extraire avec l'IA", "Extract with AI")}
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
        {t("Découpage automatique", "Automatic split")}
      </BoutonActionAo>
    </div>
  );
}

/** Validation humaine d'un brouillon d'extraction : les propositions cochées entrent dans la matrice. */
export function ValidationExtractionAo({ extraction }: { extraction: ExtractionAo }) {
  const t = useT();
  const langue = useLangue();
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
              aide={`${libelleCategorie(p.categorie, langue)} · ${
                p.obligatoire ? t("obligatoire", "mandatory") : t("facultative", "optional")
              }`}
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
          libelle={t(
            "J'ai relu les nombres cités par le brouillon et je les assume",
            "I have reviewed the numbers cited by the draft and I stand by them",
          )}
          aide={t(
            "Le brouillon IA contient des nombres que le contrôle n'a pas pu vérifier.",
            "The AI draft contains numbers that the check could not verify.",
          )}
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
          {t(`Valider ${retenues.length} exigence(s)`, `Approve ${retenues.length} requirement(s)`)}
        </BoutonActionAo>
        <BoutonActionAo variante="danger" action={() => api.post(url, { decision: "rejetee" })}>
          {t("Rejeter le brouillon", "Reject the draft")}
        </BoutonActionAo>
      </div>
    </div>
  );
}
