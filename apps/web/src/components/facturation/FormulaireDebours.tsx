"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api, appelerApi } from "../../lib/api";
import { OPTIONS_DEVISES } from "../../lib/cabinet";
import {
  OPTIONS_CATEGORIES,
  validerDebours,
  type ChampDebours,
  type Debours,
  type SaisieDebours,
} from "../../lib/debours";
import {
  erreurReprenable,
  messageTeleversement,
  TYPES_JUSTIFICATIF,
  type FichierMeta,
} from "../../lib/fichiers";
import { DEVISES, type Devise } from "../../lib/format";
import { aideMontant } from "../../lib/saisie";
import { televerser } from "../../lib/televersement";
import { ChoixFichier } from "../fichiers/ChoixFichier";
import { FichierJoint } from "../fichiers/FichierJoint";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
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
  /** Justificatif déjà rattaché (modification). */
  justificatif?: FichierMeta | null;
  /** Ancienne référence texte (débours antérieurs au téléversement). */
  ancienneReference?: string | null;
  onFin: () => void;
  /** Après enregistrement (sinon `onFin`) : fermeture différée jusqu'au rafraîchissement. */
  onEnregistre?: () => void;
}

/** Échec du seul envoi du justificatif : le débours, lui, est enregistré. */
class EchecJustificatif extends Error {
  constructor(readonly origine: unknown) {
    super("Justificatif non envoyé");
  }
}

/**
 * Saisie d'un débours sur téléphone (FIN-05, parcours B) : date, catégorie, montant,
 * refacturable et photo ou scan du justificatif. Le débours est enregistré en brouillon (JSON),
 * puis le justificatif est téléversé à part. Après une coupure pendant l'envoi du fichier, le
 * formulaire reste ouvert avec ses saisies : « Réessayer l'envoi » reprend sans recréer le
 * débours.
 */
export function FormulaireDebours({
  titre,
  initial,
  missions,
  deboursId,
  justificatif,
  ancienneReference,
  onFin,
  onEnregistre,
}: FormulaireDeboursProps) {
  const router = useRouter();
  const [s, setS] = useState<SaisieDebours>(initial);
  const [missionId, setMissionId] = useState(missions.length === 1 ? missions[0]!.id : "");
  const mission = missions.find((m) => m.id === missionId);
  const [devise, setDevise] = useState<Devise>(mission?.devise ?? "XOF");
  const deviseEffective = mission?.devise ?? devise;
  const f = useFormulaire<ChampDebours | "mission">();
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreurFichier, setErreurFichier] = useState<string | undefined>();
  const [progression, setProgression] = useState<number | null>(null);
  const [joint, setJoint] = useState<FichierMeta | null>(justificatif ?? null);
  const [reference, setReference] = useState(ancienneReference ?? null);
  // Débours créé lors d'un essai précédent dont seul le justificatif a échoué.
  const [idCree, setIdCree] = useState<string | null>(null);
  const dernierEnvoi = useRef<string | null>(null);
  const [changeSurServeur, setChangeSurServeur] = useState(false);
  const [echecJustificatif, setEchecJustificatif] = useState(false);
  const [annonce, setAnnonce] = useState("");
  const idDebours = deboursId ?? idCree;
  const maj = <K extends keyof SaisieDebours>(champ: K, v: SaisieDebours[K]) =>
    setS((x) => ({ ...x, [champ]: v }));

  async function enregistrer(c: unknown): Promise<string> {
    const corps = JSON.stringify(c);
    if (idDebours) {
      if (dernierEnvoi.current !== corps) {
        await api.patch(`/api/debours/${encodeURIComponent(idDebours)}`, c);
        dernierEnvoi.current = corps;
      }
      return idDebours;
    }
    const cree = await api.post<Debours>(
      `/api/missions/${encodeURIComponent(missionId)}/debours`,
      c,
    );
    dernierEnvoi.current = corps;
    setIdCree(cree.id);
    setChangeSurServeur(true);
    return cree.id;
  }

  async function envoyerJustificatif(id: string, f0: File): Promise<void> {
    setProgression(0);
    try {
      const d = await televerser<Debours>(
        `/api/debours/${encodeURIComponent(id)}/justificatif`,
        f0,
        f0.name,
        { onProgression: setProgression },
      );
      setJoint(d.justificatif_fichier);
      setReference(null);
      setFichier(null);
    } catch (e) {
      throw new EchecJustificatif(e);
    } finally {
      setProgression(null);
    }
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreurFichier(undefined);
    setEchecJustificatif(false);
    const v = validerDebours(s, deviseEffective);
    const validation =
      !idDebours && !mission
        ? {
            ok: false as const,
            erreurs: { ...(v.ok ? {} : v.erreurs), mission: "Choisissez la mission." },
          }
        : v;
    await f.envoyer(
      validation,
      async (c) => {
        const id = await enregistrer(c);
        if (fichier) await envoyerJustificatif(id, fichier);
      },
      {
        apres: onEnregistre ?? onFin,
        succes: deboursId ? undefined : "Débours enregistré en brouillon.",
        messageSpecifique: (e) => {
          if (!(e instanceof EchecJustificatif)) return null;
          setEchecJustificatif(true);
          const raison = messageTeleversement(e.origine);
          if (!erreurReprenable(e.origine)) setErreurFichier(raison);
          return `Le débours est enregistré en brouillon, mais le justificatif n'a pas été envoyé. ${raison}`;
        },
      },
    );
  }

  function annuler() {
    // Un débours créé (ou un justificatif retiré) pendant la saisie doit apparaître dans la liste.
    if (changeSurServeur) router.refresh();
    onFin();
  }

  async function retirerJustificatif(): Promise<boolean> {
    if (!idDebours) return false;
    try {
      await appelerApi<Debours>(`/api/debours/${encodeURIComponent(idDebours)}/justificatif`, {
        methode: "DELETE",
      });
      setJoint(null);
      setReference(null);
      setChangeSurServeur(true);
      setAnnonce("Justificatif retiré du débours.");
      return true;
    } catch (e) {
      setErreurFichier(messageTeleversement(e));
      return false;
    }
  }

  const reprise = idCree !== null && fichier !== null && !deboursId;
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire mp-pleine-largeur"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={echecJustificatif ? "Justificatif non envoyé" : undefined}
      />
      <span className="mp-visuellement-cache" role="status">
        {annonce}
      </span>
      <div className="mp-grille-champs">
        {!idDebours && missions.length > 1 ? (
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
      </div>
      <CaseACocher
        libelle="Refacturable au client"
        aide="Un débours refacturable validé peut être ajouté à une facture de la mission."
        checked={s.refacturable}
        onChange={(e) => maj("refacturable", e.target.checked)}
      />
      <div className="mp-pile">
        {joint ? (
          <div className="mp-justificatif-actuel">
            <FichierJoint fichier={joint} prefixe="Justificatif joint" />
            {fichier ? null : (
              <div>
                <BoutonConfirmation
                  libelle="Retirer le justificatif"
                  variante="discret"
                  icone="corbeille"
                  question="Retirer le justificatif de ce débours ?"
                  libelleConfirmation="Oui, retirer"
                  texteChargement="Retrait…"
                  action={retirerJustificatif}
                />
              </div>
            )}
          </div>
        ) : reference ? (
          <p className="mp-texte-petit mp-coupure">
            {`Ancienne référence saisie : ${reference}. Joignez la photo ou le scan pour la remplacer.`}
          </p>
        ) : null}
        <ChoixFichier
          libelle={joint ? "Remplacer le justificatif" : "Justificatif (photo ou scan)"}
          aide="Photo du reçu ou scan : PDF, PNG, JPG ou WebP, 15 Mo au plus. Facultatif à l'enregistrement, attendu par le valideur."
          types={TYPES_JUSTIFICATIF}
          photo
          fichier={fichier}
          onChoix={(x) => {
            setErreurFichier(undefined);
            setFichier(x);
          }}
          erreur={erreurFichier}
          progression={progression}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={reprise ? "nuage" : undefined}
          chargement={f.enCours}
          texteChargement={progression !== null ? "Envoi du justificatif…" : "Enregistrement…"}
        >
          {reprise ? "Réessayer l'envoi" : "Enregistrer"}
        </Bouton>
        <Bouton variante="discret" onClick={annuler} disabled={f.enCours}>
          {idCree && !deboursId ? "Fermer" : "Annuler"}
        </Bouton>
      </div>
    </form>
  );
}
