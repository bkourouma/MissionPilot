"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ErreurApi } from "../../lib/api";
import { erreurReprenable, type FichierTeleverse } from "../../lib/fichiers";
import { televerser } from "../../lib/televersement";
import {
  AVERTISSEMENT_TRANSCRIPTION,
  cheminApiAudioTranscription,
  cheminApiTranscriptions,
  hrefTranscription,
  messageErreurTranscription,
  OPTIONS_LANGUE_TRANSCRIPTION,
  validerTranscription,
  type ChampTranscription,
  type ChargeTranscription,
} from "../../lib/transcriptions";
import { BandeauSimule } from "../canaux/BandeauSimule";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChoixAudio } from "./ChoixAudio";
import "../canaux/canaux.css";

export interface NouvelleTranscriptionProps {
  missionId: string;
}

/** Retire sans attendre un audio téléversé resté sans rattachement (quota d'attente). */
function retirerOrphelin(id: string | null) {
  if (id) void api.supprimer(`/api/fichiers/${encodeURIComponent(id)}`).catch(() => undefined);
}

/**
 * Envoi d'un audio à transcrire (AGT-11) : l'enregistrement est téléversé (POST /api/fichiers),
 * puis la transcription est demandée avec le consentement DÉCLARÉ de la personne enregistrée et sa
 * référence. Le résultat est un brouillon à relire. Fournisseur simulé : aucun vrai audio décodé.
 */
export function NouvelleTranscription({ missionId }: NouvelleTranscriptionProps) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [langue, setLangue] = useState("fr");
  const [consenti, setConsenti] = useState(false);
  const [reference, setReference] = useState("");
  const [duree, setDuree] = useState("");
  const [progression, setProgression] = useState<number | null>(null);
  const [erreurFichier, setErreurFichier] = useState<string | null>(null);
  const f = useFormulaire<ChampTranscription>();
  // Audio déjà téléversé mais pas encore rattaché (reprise après coupure).
  const enAttente = useRef<{ fichier: File; id: string } | null>(null);

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="envoyer" onClick={() => setOuvert(true)}>
          Transcrire un enregistrement
        </Bouton>
      </div>
    );
  }

  async function transcrire(charge: ChargeTranscription, audio: File): Promise<{ id?: string }> {
    let fichierId = enAttente.current?.fichier === audio ? enAttente.current.id : null;
    if (!fichierId) {
      retirerOrphelin(enAttente.current?.id ?? null);
      enAttente.current = null;
      setProgression(0);
      try {
        const t = await televerser<FichierTeleverse>(
          cheminApiAudioTranscription(missionId),
          audio,
          audio.name,
          {
            onProgression: setProgression,
          },
        );
        fichierId = t.id;
        enAttente.current = { fichier: audio, id: t.id };
      } finally {
        setProgression(null);
      }
    }
    try {
      const r = await api.post<{ id?: string }>(
        cheminApiTranscriptions(missionId),
        { ...charge, fichier_id: fichierId },
        { redirigerSi401: false },
      );
      enAttente.current = null;
      return r;
    } catch (e) {
      if (!erreurReprenable(e)) {
        retirerOrphelin(fichierId);
        enAttente.current = null;
      }
      throw e;
    }
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreurFichier(null);
    const v = validerTranscription({ langue, consenti, reference, dureeMinutes: duree });
    if (!fichier) {
      // Le champ audio n'a pas de clé de validation : message sous le sélecteur.
      setErreurFichier("Choisissez l'enregistrement à transcrire.");
      if (v.ok) return;
    }
    await f.envoyer(v, (c) => transcrire(c, fichier as File), {
      rafraichir: false,
      succes: "Enregistrement envoyé : la transcription est en cours.",
      messageSpecifique: (e) => {
        if (e instanceof ErreurApi && e.code === "TYPE_FICHIER_REFUSE") {
          setErreurFichier("Enregistrement refusé : en mode simulé, seul un audio de test passe.");
        }
        return messageErreurTranscription(e);
      },
      apres: (r) => {
        if (r && typeof r.id === "string") router.push(hrefTranscription(missionId, r.id));
        else router.refresh();
      },
    });
  }

  const reprise = enAttente.current !== null && enAttente.current.fichier === fichier;
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Transcrire un enregistrement"
    >
      <p className="mp-sous-formulaire__titre">Transcrire un enregistrement</p>
      <BandeauSimule>
        <p>
          Le service de transcription est simulé : il ne décode que des enregistrements de test.
        </p>
      </BandeauSimule>
      <p className="mp-texte-doux">{AVERTISSEMENT_TRANSCRIPTION}</p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Transcription impossible"
      />
      <ChoixAudio
        fichier={fichier}
        onChoix={(x) => {
          setErreurFichier(null);
          setFichier(x);
        }}
        erreur={erreurFichier ?? undefined}
        progression={progression}
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Langue de l'enregistrement"
          required
          value={langue}
          onChange={(e) => setLangue(e.target.value)}
          options={OPTIONS_LANGUE_TRANSCRIPTION}
          erreur={f.erreurs.langue}
        />
        <Champ
          libelle="Durée annoncée (minutes, facultatif)"
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          value={duree}
          onChange={(e) => setDuree(e.target.value)}
          erreur={f.erreurs.dureeMinutes}
          aide="Sans elle, le plafond mensuel compte 30 minutes."
        />
      </div>
      <CaseACocher
        libelle="La personne enregistrée a consenti à l'enregistrement et à sa transcription"
        checked={consenti}
        onChange={(e) => setConsenti(e.target.checked)}
      />
      {f.erreurs.consenti ? <p className="mp-champ__erreur">{f.erreurs.consenti}</p> : null}
      <ZoneTexte
        libelle="Référence du consentement"
        required
        maxLength={500}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        erreur={f.erreurs.reference}
        aide="Comment et quand le consentement a été recueilli (10 caractères au moins)."
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={reprise ? "nuage" : "envoyer"}
          chargement={f.enCours}
          texteChargement={progression !== null ? "Envoi de l'enregistrement…" : "Création…"}
        >
          {reprise ? "Réessayer" : "Envoyer et transcrire"}
        </Bouton>
        <Bouton variante="discret" onClick={() => setOuvert(false)} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
