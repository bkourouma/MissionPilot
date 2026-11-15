"use client";

import { useRouter } from "next/navigation";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { api, ErreurApi, messageErreur } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  cheminModeles,
  cheminSalle,
  corpsDemande,
  ECHEANCE_MAX,
  erreurEcheanceApi,
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
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
      setErreurModeles(messageErreur(e, langue));
    }
  }

  const tries = modelesTries(modeles ?? [], methodes);
  const options: OptionSelect[] = [
    ...tries.suggeres.map((m) => ({
      valeur: m.id,
      libelle: `${m.nom} ${t("(méthode de la mission)", "(engagement method)")}`,
    })),
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
    const e = validerDemande(saisie, aujourdhui, langue);
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
      rafraichir();
    } catch (err) {
      // Échéance refusée par le schéma : message sous le champ, pas une erreur générale.
      const champ = erreurEcheanceApi(err, langue);
      if (champ) setErreurs({ echeance: champ });
      else {
        setErreurServeur(
          (err instanceof ErreurApi ? messageSalle(err.code, langue) : null) ??
            messageErreur(err, langue),
        );
      }
      setEnvoi(false);
    }
  }

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="plus" onClick={() => void ouvrir()}>
          {t("Nouvelle demande de documents", "New document request")}
        </Bouton>
      </div>
    );
  }

  return (
    <form className="mp-formulaire mp-pile" onSubmit={(e) => void soumettre(e)} noValidate>
      <h2 className="mp-section__titre">
        {t("Nouvelle demande de documents", "New document request")}
      </h2>
      {erreurServeur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreurServeur}</p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Champ
          libelle={t("Titre", "Title")}
          value={saisie.titre}
          onChange={(e) => changer("titre", e.target.value)}
          erreur={erreurs.titre}
          maxLength={200}
          required
          aide={t(
            "Visible du client, par exemple « Pièces du diagnostic financier ».",
            'Visible to the client, for example "Financial diagnostic documents".',
          )}
        />
        <Champ
          libelle={t("Échéance", "Due date")}
          type="date"
          value={saisie.echeance}
          min={aujourdhui}
          max={ECHEANCE_MAX}
          onChange={(e) => changer("echeance", e.target.value)}
          erreur={erreurs.echeance}
          aide={t(
            "Obligatoire pour envoyer ; vous pourrez la repousser ensuite.",
            "Required to send; you can postpone it afterwards.",
          )}
        />
      </div>
      <ZoneTexte
        libelle={t("Message au client", "Message to the client")}
        value={saisie.message}
        onChange={(e) => changer("message", e.target.value)}
        maxLength={4000}
        rows={3}
        aide={t(
          "Facultatif. Le client le lit en tête de la demande.",
          "Optional. The client reads it at the top of the request.",
        )}
      />
      {erreurModeles ? (
        <Alerte tonalite="attention" annonce="status">
          <p>
            {t("Les modèles n'ont pas pu être chargés", "The templates could not be loaded")} :{" "}
            {erreurModeles}
          </p>
        </Alerte>
      ) : null}
      <Select
        libelle={t("Modèle du cabinet", "Firm template")}
        options={options}
        invite={
          modeles === null
            ? t("Chargement des modèles…", "Loading templates…")
            : t("Aucun modèle (pièces saisies)", "No template (documents entered manually)")
        }
        value={saisie.modeleId}
        onChange={(e) => changer("modeleId", e.target.value)}
        disabled={modeles === null}
        aide={
          modeleChoisi
            ? t(
                `${modeleChoisi.pieces.length} pièce(s) reprise(s) : ${modeleChoisi.pieces.map((p) => p.libelle).join(", ")}.`,
                `${modeleChoisi.pieces.length} document(s) carried over: ${modeleChoisi.pieces.map((p) => p.libelle).join(", ")}.`,
              )
            : t(
                "Les pièces du modèle sont copiées dans la demande ; vous pouvez en ajouter.",
                "The template's documents are copied into the request; you can add more.",
              )
        }
      />
      <fieldset className="mp-pile">
        <legend className="mp-champ__libelle">
          {t("Pièces supplémentaires", "Additional documents")}
        </legend>
        {erreurs.pieces ? (
          <p className="mp-champ__erreur" role="alert">
            {erreurs.pieces}
          </p>
        ) : null}
        {saisie.pieces.map((p, i) => (
          <div className="mp-salle__ligne-piece" key={i}>
            <Champ
              libelle={t(`Pièce ${i + 1}`, `Document ${i + 1}`)}
              value={p.libelle}
              maxLength={200}
              onChange={(e) => changerPiece(i, { libelle: e.target.value })}
            />
            <Champ
              libelle={t("Précision pour le client", "Note for the client")}
              value={p.description}
              maxLength={2000}
              onChange={(e) => changerPiece(i, { description: e.target.value })}
            />
            <CaseACocher
              libelle={t("Obligatoire", "Required")}
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
              {t("Retirer", "Remove")}
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
            {t("Ajouter une pièce", "Add a document")}
          </Bouton>
        </div>
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={envoi} texteChargement={t("Création…", "Creating…")}>
          {t("Créer le brouillon", "Create the draft")}
        </Bouton>
        <Bouton type="button" variante="discret" onClick={() => setOuvert(false)} disabled={envoi}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
