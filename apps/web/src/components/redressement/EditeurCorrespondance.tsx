"use client";

import { useState, type FormEvent } from "react";
import { RED_POSTES, type RedCorrespondanceVue, type RedPostesVue } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  AVERTISSEMENT_CORRESPONDANCE,
  AVERTISSEMENT_CORRESPONDANCE_EN,
  cheminCorrespondances,
  libellePoste,
  messageRedressement,
} from "../../lib/redressement";
import {
  corpsCorrespondanceDepuisFormulaire,
  saisieCorrespondanceDepuis,
  type ChampCorrespondance,
  type SaisieCorrespondance,
} from "../../lib/redressement-saisie";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Tableau } from "../ui/Tableau";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface LigneEtatAide {
  rang: number;
  code: string;
  libelle: string;
  section: string;
  montant: number;
}

/**
 * Correspondance de postes (RED-02) : « poste de ratio ← codes de lignes de l'état du client ».
 * Une version par enregistrement (ajout seul). « Proposer la correspondance SYSCOHADA
 * indicative » remplit le formulaire SANS enregistrer. Un poste laissé vide reste « à renseigner »
 * (jamais compté comme zéro) ; « Sans objet » le déclare absent de l'entreprise.
 */
export function EditeurCorrespondance({
  dossierId,
  courante,
  indicative,
  lignesEtat,
  devise,
}: {
  dossierId: string;
  courante: RedPostesVue | null;
  indicative: RedPostesVue;
  lignesEtat: LigneEtatAide[];
  devise: Devise;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampCorrespondance>();
  const [saisie, setSaisie] = useState<SaisieCorrespondance>(() =>
    saisieCorrespondanceDepuis(courante),
  );
  const [motif, setMotif] = useState("");
  const [proposee, setProposee] = useState(false);

  const maj = (
    poste: (typeof RED_POSTES)[number],
    valeur: Partial<SaisieCorrespondance[typeof poste]>,
  ) => {
    setProposee(false);
    setSaisie((s) => ({ ...s, [poste]: { ...s[poste], ...valeur } }));
  };

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsCorrespondanceDepuisFormulaire(
        saisie,
        motif,
        lignesEtat.map((l) => l.code),
        langue,
      ),
      (charge) => api.post<RedCorrespondanceVue>(cheminCorrespondances(dossierId), charge),
      {
        succes: t(
          "Correspondance enregistrée : les ratios sont recalculés avec cette version.",
          "Mapping saved: the ratios are recomputed with this version.",
        ),
        messageSpecifique: (e) => messageRedressement(e, langue),
        apres: () => setProposee(false),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Correspondance de postes", "Item mapping")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Could not save")}
      />
      {f.erreurs.postes ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{f.erreurs.postes}</p>
        </Alerte>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          onClick={() => {
            setSaisie(saisieCorrespondanceDepuis(indicative));
            setProposee(true);
          }}
        >
          {t(
            "Proposer la correspondance SYSCOHADA indicative",
            "Suggest the indicative SYSCOHADA mapping",
          )}
        </Bouton>
      </div>
      {proposee ? (
        <Alerte
          tonalite="attention"
          titre={t("Proposition non enregistrée", "Suggestion not saved")}
          annonce="status"
        >
          <p>{t(AVERTISSEMENT_CORRESPONDANCE, AVERTISSEMENT_CORRESPONDANCE_EN)}</p>
          <p>{t("Relisez chaque poste, puis enregistrez.", "Review each item, then save.")}</p>
        </Alerte>
      ) : null}

      <div className="mp-red-seuils">
        {RED_POSTES.map((p) => (
          <div key={p} className="mp-red-seuil">
            <p className="mp-red-seuil__titre">{libellePoste(p, langue)}</p>
            <Champ
              libelle={t("Codes de lignes", "Line codes")}
              autoComplete="off"
              spellCheck={false}
              value={saisie[p].codes}
              disabled={saisie[p].sans_objet}
              onChange={(e) => maj(p, { codes: e.target.value })}
              erreur={f.erreurs[`poste.${p}`]}
              aide={t(
                "Séparés par des virgules (ex. BB, BC).",
                "Separated by commas (e.g. BB, BC).",
              )}
            />
            <CaseACocher
              libelle={t("Sans objet", "Not applicable")}
              aide={t(
                "Ce poste n'existe pas dans l'entreprise.",
                "This item does not exist in the company.",
              )}
              checked={saisie[p].sans_objet}
              onChange={(e) => maj(p, { sans_objet: e.target.checked })}
            />
          </div>
        ))}
      </div>

      <ZoneTexte
        libelle={t("Motif (facultatif)", "Reason (optional)")}
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />

      {lignesEtat.length > 0 ? (
        <details className="mp-details">
          <summary>
            {t(
              `Codes et libellés du dernier état accepté (${lignesEtat.length} lignes)`,
              `Codes and labels of the latest accepted statement (${lignesEtat.length} lines)`,
            )}
          </summary>
          <Tableau
            legende={t(
              "Lignes du dernier état financier accepté",
              "Lines of the latest accepted financial statement",
            )}
            colonnes={[
              { cle: "code", entete: "Code" },
              { cle: "libelle", entete: t("Libellé", "Label") },
              { cle: "section", entete: "Section" },
              {
                cle: "montant",
                entete: t("Montant", "Amount"),
                alignement: "droite",
                rendu: (l: LigneEtatAide) => (
                  <span className="mp-red-valeur">
                    {formaterMontantMineur(l.montant, devise, langue)}
                  </span>
                ),
              },
            ]}
            lignes={lignesEtat}
            cleLigne={(l) => String(l.rang)}
          />
        </details>
      ) : null}

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la correspondance", "Save the mapping")}
        </Bouton>
      </div>
    </form>
  );
}
