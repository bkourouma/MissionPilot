"use client";

import { useState, type FormEvent } from "react";
import {
  RED_POSTES,
  RED_POSTE_LIBELLES,
  type RedCorrespondanceVue,
  type RedPostesVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  AVERTISSEMENT_CORRESPONDANCE,
  cheminCorrespondances,
  messageRedressement,
} from "../../lib/redressement";
import {
  corpsCorrespondanceDepuisFormulaire,
  saisieCorrespondanceDepuis,
  type ChampCorrespondance,
  type SaisieCorrespondance,
} from "../../lib/redressement-saisie";
import { formaterMontantMineur, type Devise } from "../../lib/format";
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
      ),
      (charge) => api.post<RedCorrespondanceVue>(cheminCorrespondances(dossierId), charge),
      {
        succes: "Correspondance enregistrée : les ratios sont recalculés avec cette version.",
        messageSpecifique: messageRedressement,
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
      aria-label="Correspondance de postes"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
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
          Proposer la correspondance SYSCOHADA indicative
        </Bouton>
      </div>
      {proposee ? (
        <Alerte tonalite="attention" titre="Proposition non enregistrée" annonce="status">
          <p>{AVERTISSEMENT_CORRESPONDANCE}</p>
          <p>Relisez chaque poste, puis enregistrez.</p>
        </Alerte>
      ) : null}

      <div className="mp-red-seuils">
        {RED_POSTES.map((p) => (
          <div key={p} className="mp-red-seuil">
            <p className="mp-red-seuil__titre">{RED_POSTE_LIBELLES[p]}</p>
            <Champ
              libelle="Codes de lignes"
              autoComplete="off"
              spellCheck={false}
              value={saisie[p].codes}
              disabled={saisie[p].sans_objet}
              onChange={(e) => maj(p, { codes: e.target.value })}
              erreur={f.erreurs[`poste.${p}`]}
              aide="Séparés par des virgules (ex. BB, BC)."
            />
            <CaseACocher
              libelle="Sans objet"
              aide="Ce poste n'existe pas dans l'entreprise."
              checked={saisie[p].sans_objet}
              onChange={(e) => maj(p, { sans_objet: e.target.checked })}
            />
          </div>
        ))}
      </div>

      <ZoneTexte
        libelle="Motif (facultatif)"
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />

      {lignesEtat.length > 0 ? (
        <details className="mp-details">
          <summary>Codes et libellés du dernier état accepté ({lignesEtat.length} lignes)</summary>
          <Tableau
            legende="Lignes du dernier état financier accepté"
            colonnes={[
              { cle: "code", entete: "Code" },
              { cle: "libelle", entete: "Libellé" },
              { cle: "section", entete: "Section" },
              {
                cle: "montant",
                entete: "Montant",
                alignement: "droite",
                rendu: (l: LigneEtatAide) => (
                  <span className="mp-red-valeur">{formaterMontantMineur(l.montant, devise)}</span>
                ),
              },
            ]}
            lignes={lignesEtat}
            cleLigne={(l) => String(l.rang)}
          />
        </details>
      ) : null}

      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la correspondance
        </Bouton>
      </div>
    </form>
  );
}
