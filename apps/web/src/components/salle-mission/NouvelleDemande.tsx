"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ErreurApi, messageErreur } from "../../lib/api";
import {
  cheminModeles,
  cheminSalle,
  corpsDemande,
  hrefDemande,
  messageSalle,
  modelesTries,
  SAISIE_DEMANDE_VIDE,
  validerDemande,
  type DemandeDetail,
  type ErreursDemande,
  type ModeleSalle,
  type SaisieDemande,
} from "../../lib/salle-mission";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select, type OptionSelect } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import "./salle.css";

export interface NouvelleDemandeProps {
  missionId: string;
  /** Méthode courante de la mission (et son parent du standard) : modèles suggérés d'abord. */
  methodes: readonly string[];
  aujourdhui: string;
}

/**
 * Préparation d'une demande documentaire (brouillon) : titre, message au client, échéance,
 * modèle du cabinet et pièces saisies. Les modèles sont chargés à l'ouverture du formulaire.
 */
export function NouvelleDemande({ missionId, methodes, aujourdhui }: NouvelleDemandeProps) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState<SaisieDemande>(SAISIE_DEMANDE_VIDE);
  const [erreurs, setErreurs] = useState<ErreursDemande>({});
  const [erreurServeur, setErreurServeur] = useState<string | null>(null);
  const [modeles, setModeles] = useState<ModeleSalle[] | null>(null);
  const [erreurModeles, setErreurModeles] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function ouvrir() {
    setOuvert(true);
    if (modeles !== null) return;
    try {
      const r = await api.get<{ elements: ModeleSalle[] }>(cheminModeles());
      setModeles(r.elements);
    } catch (e) {
      setModeles([]);
      setErreurModeles(messageErreur(e));
    }
  }

  const tries = modelesTries(modeles ?? [], methodes);
  const options: OptionSelect[] = [
    ...tries.suggeres.map((m) => ({ valeur: m.id, libelle: `${m.nom} (méthode de la mission)` })),
    ...tries.autres.map((m) => ({ valeur: m.id, libelle: m.nom })),
  ];
  const modeleChoisi = (modeles ?? []).find((m) => m.id === saisie.modeleId);

  const changer = (champ: keyof SaisieDemande, valeur: string) =>
    setSaisie((s) => ({ ...s, [champ]: valeur }));
  const changerPiece = (i: number, modif: Partial<SaisieDemande["pieces"][number]>) =>
    setSaisie((s) => ({
      ...s,
      pieces: s.pieces.map((p, j) => (j === i ? { ...p, ...modif } : p)),
    }));

  async function soumettre(ev: FormEvent) {
    ev.preventDefault();
    const e = validerDemande(saisie, aujourdhui);
    setErreurs(e);
    setErreurServeur(null);
    if (Object.keys(e).length > 0) return;
    setEnvoi(true);
    try {
      const d = await api.post<DemandeDetail>(
        `${cheminSalle(missionId)}/demandes`,
        corpsDemande(saisie),
      );
      router.push(hrefDemande(missionId, d.id));
      router.refresh();
    } catch (err) {
      setErreurServeur(
        (err instanceof ErreurApi ? messageSalle(err.code) : null) ?? messageErreur(err),
      );
      setEnvoi(false);
    }
  }

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="plus" onClick={() => void ouvrir()}>
          Nouvelle demande de documents
        </Bouton>
      </div>
    );
  }

  return (
    <form className="mp-formulaire mp-pile" onSubmit={(e) => void soumettre(e)} noValidate>
      <h2 className="mp-section__titre">Nouvelle demande de documents</h2>
      {erreurServeur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreurServeur}</p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Champ
          libelle="Titre"
          value={saisie.titre}
          onChange={(e) => changer("titre", e.target.value)}
          erreur={erreurs.titre}
          maxLength={200}
          required
          aide="Visible du client, par exemple « Pièces du diagnostic financier »."
        />
        <Champ
          libelle="Échéance"
          type="date"
          value={saisie.echeance}
          min={aujourdhui}
          onChange={(e) => changer("echeance", e.target.value)}
          erreur={erreurs.echeance}
          aide="Obligatoire pour envoyer ; vous pourrez la repousser ensuite."
        />
      </div>
      <ZoneTexte
        libelle="Message au client"
        value={saisie.message}
        onChange={(e) => changer("message", e.target.value)}
        maxLength={4000}
        rows={3}
        aide="Facultatif. Le client le lit en tête de la demande."
      />
      {erreurModeles ? (
        <Alerte tonalite="attention" annonce="status">
          <p>Les modèles n&apos;ont pas pu être chargés : {erreurModeles}</p>
        </Alerte>
      ) : null}
      <Select
        libelle="Modèle du cabinet"
        options={options}
        invite={modeles === null ? "Chargement des modèles…" : "Aucun modèle (pièces saisies)"}
        value={saisie.modeleId}
        onChange={(e) => changer("modeleId", e.target.value)}
        disabled={modeles === null}
        aide={
          modeleChoisi
            ? `${modeleChoisi.pieces.length} pièce(s) reprise(s) : ${modeleChoisi.pieces.map((p) => p.libelle).join(", ")}.`
            : "Les pièces du modèle sont copiées dans la demande ; vous pouvez en ajouter."
        }
      />
      <fieldset className="mp-pile">
        <legend className="mp-champ__libelle">Pièces supplémentaires</legend>
        {erreurs.pieces ? (
          <p className="mp-champ__erreur" role="alert">
            {erreurs.pieces}
          </p>
        ) : null}
        {saisie.pieces.map((p, i) => (
          <div className="mp-salle__ligne-piece" key={i}>
            <Champ
              libelle={`Pièce ${i + 1}`}
              value={p.libelle}
              maxLength={200}
              onChange={(e) => changerPiece(i, { libelle: e.target.value })}
            />
            <Champ
              libelle="Précision pour le client"
              value={p.description}
              maxLength={2000}
              onChange={(e) => changerPiece(i, { description: e.target.value })}
            />
            <CaseACocher
              libelle="Obligatoire"
              checked={p.obligatoire}
              onChange={(e) => changerPiece(i, { obligatoire: e.target.checked })}
            />
            <Bouton
              type="button"
              variante="discret"
              icone="corbeille"
              onClick={() =>
                setSaisie((s) => ({ ...s, pieces: s.pieces.filter((_, j) => j !== i) }))
              }
            >
              Retirer
            </Bouton>
          </div>
        ))}
        <div>
          <Bouton
            type="button"
            variante="secondaire"
            icone="plus"
            onClick={() =>
              setSaisie((s) => ({
                ...s,
                pieces: [...s.pieces, { libelle: "", description: "", obligatoire: true }],
              }))
            }
          >
            Ajouter une pièce
          </Bouton>
        </div>
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={envoi} texteChargement="Création…">
          Créer le brouillon
        </Bouton>
        <Bouton type="button" variante="discret" onClick={() => setOuvert(false)} disabled={envoi}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
