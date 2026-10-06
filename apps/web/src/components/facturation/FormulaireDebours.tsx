"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { OPTIONS_DEVISES } from "../../lib/cabinet";
import {
  OPTIONS_CATEGORIES,
  validerDebours,
  type ChampDebours,
  type SaisieDebours,
} from "../../lib/debours";
import { DEVISES, type Devise } from "../../lib/format";
import { aideMontant } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

/** Mission proposée à la saisie ; `devise` nulle quand le rôle ne lit pas la fiche mission. */
export interface MissionDebours {
  id: string;
  intitule: string;
  devise: Devise | null;
}

export interface FormulaireDeboursProps {
  titre: string;
  initial: SaisieDebours;
  /** Création : missions proposées (une seule = mission imposée). Modification : la mission du débours. */
  missions: readonly MissionDebours[];
  /** Modification d'un débours existant (PATCH), sinon création (POST). */
  deboursId?: string;
  onFin: () => void;
  /** Après enregistrement (sinon `onFin`) : fermeture différée jusqu'au rafraîchissement. */
  onEnregistre?: () => void;
}

/**
 * Saisie d'un débours sur téléphone (FIN-05) : date, catégorie, montant, refacturable et
 * référence du justificatif (l'API ne stocke pas de fichier). Enregistré en brouillon.
 */
export function FormulaireDebours({
  titre,
  initial,
  missions,
  deboursId,
  onFin,
  onEnregistre,
}: FormulaireDeboursProps) {
  const [s, setS] = useState<SaisieDebours>(initial);
  const [missionId, setMissionId] = useState(missions.length === 1 ? missions[0]!.id : "");
  const mission = missions.find((m) => m.id === missionId);
  const [devise, setDevise] = useState<Devise>(mission?.devise ?? "XOF");
  const deviseEffective = mission?.devise ?? devise;
  const f = useFormulaire<ChampDebours | "mission">();
  const maj = <K extends keyof SaisieDebours>(champ: K, v: SaisieDebours[K]) =>
    setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerDebours(s, deviseEffective);
    const validation =
      !deboursId && !mission
        ? {
            ok: false as const,
            erreurs: { ...(v.ok ? {} : v.erreurs), mission: "Choisissez la mission." },
          }
        : v;
    await f.envoyer(
      validation,
      (c) =>
        deboursId
          ? api.patch(`/api/debours/${encodeURIComponent(deboursId)}`, c)
          : api.post(`/api/missions/${encodeURIComponent(missionId)}/debours`, c),
      {
        apres: onEnregistre ?? onFin,
        succes: deboursId ? undefined : "Débours enregistré en brouillon.",
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire mp-pleine-largeur"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        {!deboursId && missions.length > 1 ? (
          <Select
            libelle="Mission"
            options={missions.map((m) => ({ valeur: m.id, libelle: m.intitule }))}
            invite="Choisir la mission…"
            required
            value={missionId}
            onChange={(e) => setMissionId(e.target.value)}
            erreur={f.erreurs.mission}
          />
        ) : null}
        <Champ
          libelle="Date de la dépense"
          type="date"
          required
          value={s.date}
          onChange={(e) => maj("date", e.target.value)}
          erreur={f.erreurs.date}
        />
        <Select
          libelle="Catégorie"
          options={OPTIONS_CATEGORIES}
          invite="Choisir…"
          required
          value={s.categorie}
          onChange={(e) => maj("categorie", e.target.value)}
          erreur={f.erreurs.categorie}
        />
        <Champ
          libelle="Description"
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => maj("libelle", e.target.value)}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle={`Montant (${deviseEffective})`}
          aide={aideMontant(deviseEffective)}
          required
          inputMode="decimal"
          value={s.montant}
          onChange={(e) => maj("montant", e.target.value)}
          erreur={f.erreurs.montant}
        />
        {mission && mission.devise === null ? (
          <Select
            libelle="Devise de la mission"
            options={OPTIONS_DEVISES}
            value={devise}
            onChange={(e) =>
              setDevise(
                (DEVISES as readonly string[]).includes(e.target.value)
                  ? (e.target.value as Devise)
                  : "XOF",
              )
            }
          />
        ) : null}
        <Champ
          libelle="Référence du justificatif"
          aide="Emplacement de la photo ou du scan dans le classement du cabinet (ex. notes-de-frais/2026-10/taxi-12.jpg)."
          maxLength={500}
          autoCapitalize="none"
          spellCheck={false}
          value={s.justificatif}
          onChange={(e) => maj("justificatif", e.target.value)}
          erreur={f.erreurs.justificatif}
        />
      </div>
      <CaseACocher
        libelle="Refacturable au client"
        aide="Un débours refacturable validé peut être ajouté à une facture de la mission."
        checked={s.refacturable}
        onChange={(e) => maj("refacturable", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
